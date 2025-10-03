// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import { IAuthority        } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20            } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC20Metadata    } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { ERC2771Context    } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { SafeERC20         } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Hashes            } from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import { Math              } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast          } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath        } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { Context           } from "@openzeppelin/contracts/utils/Context.sol";
import { Multicall         } from "@openzeppelin/contracts/utils/Multicall.sol";
import { Oracle            } from "../oracle/Oracle.sol";
import { PermissionManaged } from "../permissions/PermissionManaged.sol";

function tryFetchDecimals(IERC20 token) view returns (uint8) {
    try IERC20Metadata(address(token)).decimals() returns (uint8 result) {
        return result;
    } catch {
        return 18;
    }
}

contract MultiATM is ERC2771Context, PermissionManaged, Multicall
{
    using Math     for *;
    using SafeCast for *;

    uint256 private constant _BASIS_POINT_SCALE = 1e4;

    struct Pair {
        IERC20 token1;
        IERC20 token2;
        Oracle oracle;
        uint256 oracleTTL;
        uint256 numerator;
        uint256 denominator;
    }

    mapping(bytes32 id => Pair) private _pairs;
    uint256 public feeBasisPoints;

    event SwapExact(IERC20 indexed input, IERC20 indexed output, uint256 inputAmount, uint256 outputAmount, address from, address to);
    event PairUpdated(bytes32 indexed id, IERC20 indexed token1, IERC20 indexed token2, Oracle oracle, uint256 oracleTTL);
    event PairRemoved(bytes32 indexed id);
    event FeeUpdated(uint256 newFeeBasisPoints);
    error OracleValueTooOld(Oracle oracle);
    error UnknownPair(IERC20 input, IERC20 output);
    error InvalidFee(uint256 feeBasisPoints);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority, address _trustedForwarder)
        PermissionManaged(_authority)
        ERC2771Context(_trustedForwarder)
    {}

    /****************************************************************************************************************
     *                                                   Getters                                                    *
     ****************************************************************************************************************/
    function viewPairDetails(IERC20 input, IERC20 output) public view virtual returns (
        bytes32 id,
        IERC20 token1,
        IERC20 token2,
        Oracle oracle,
        uint256 oracleTTL,
        uint256 numerator,
        uint256 denominator
    ) {
        id = hashPair(input, output);
        Pair storage pair = _pairs[id];

        return (
            id,
            pair.token1,
            pair.token2,
            pair.oracle,
            pair.oracleTTL,
            pair.numerator,
            pair.denominator
        );
    }

    function hashPair(IERC20 input, IERC20 output) public view virtual returns (bytes32) {
        return Hashes.commutativeKeccak256(
            bytes32(uint256(uint160(address(input)))),
            bytes32(uint256(uint160(address(output))))
        );
    }

    /****************************************************************************************************************
     *                                             Core - preview swaps                                             *
     ****************************************************************************************************************/
    function previewExactInput(IERC20[] memory path, uint256 inputAmount) public view virtual returns (uint256 /*outputAmount*/) {
        uint256 outputAmount = inputAmount;
        for (uint256 i = 0; i < path.length - 1; ++i) {
            outputAmount = _exactInput(path[i], path[i+1], outputAmount);
        }
        return outputAmount.mulDiv(_BASIS_POINT_SCALE - feeBasisPoints, _BASIS_POINT_SCALE, Math.Rounding.Floor);
    }

    function previewExactOutput(IERC20[] memory path, uint256 outputAmount) public view virtual returns (uint256 /*inputAmount*/) {
        uint256 inputAmount = outputAmount;
        for (uint256 i = path.length - 1; i > 0; --i) {
            inputAmount = _exactOutput(path[i-1], path[i], inputAmount);
        }
        return inputAmount.mulDiv(_BASIS_POINT_SCALE, _BASIS_POINT_SCALE - feeBasisPoints, Math.Rounding.Ceil);
    }

    function previewExactInputSingle(IERC20 input, IERC20 output, uint256 inputAmount) public view virtual returns (uint256 /*outputAmount*/) {
        return _exactInput(input, output, inputAmount).mulDiv(_BASIS_POINT_SCALE - feeBasisPoints, _BASIS_POINT_SCALE, Math.Rounding.Floor);
    }

    function previewExactOutputSingle(IERC20 input, IERC20 output, uint256 outputAmount) public view virtual returns (uint256 /*inputAmount*/) {
        return _exactOutput(input, output, outputAmount).mulDiv(_BASIS_POINT_SCALE, _BASIS_POINT_SCALE - feeBasisPoints, Math.Rounding.Ceil);
    }

    function _exactInput(IERC20 input, IERC20 output, uint256 inputAmount) internal view virtual returns (uint256 /*outputAmount*/) {
        (
            ,
            IERC20 token1,
            ,
            Oracle oracle,
            uint256 oracleTTL,
            uint256 numerator,
            uint256 denominator
        ) = viewPairDetails(input, output);

        require(address(oracle) != address(0), UnknownPair(input, output));

        (int256 minPrice, int256 maxPrice) = _getPrices(oracle, oracleTTL);
        return inputAmount.mulDiv(
            Math.ternary(input == token1, numerator * minPrice.toUint256(), denominator),
            Math.ternary(input == token1, denominator, numerator * maxPrice.toUint256()),
            Math.Rounding.Floor
        );
    }

    function _exactOutput(IERC20 input, IERC20 output, uint256 outputAmount) internal view virtual returns (uint256 /*inputAmount*/) {
        (
            ,
            IERC20 token1,
            ,
            Oracle oracle,
            uint256 oracleTTL,
            uint256 numerator,
            uint256 denominator
        ) = viewPairDetails(input, output);

        require(address(oracle) != address(0), UnknownPair(input, output));

        (int256 minPrice, int256 maxPrice) = _getPrices(oracle, oracleTTL);
        return outputAmount.mulDiv(
            Math.ternary(input == token1, denominator, numerator * maxPrice.toUint256()),
            Math.ternary(input == token1, numerator * minPrice.toUint256(), denominator),
            Math.Rounding.Ceil
        );
    }

    /****************************************************************************************************************
     *                                             Core - execute swaps                                             *
     ****************************************************************************************************************/
    function swapExactInput(IERC20[] memory path, uint256 inputAmount, address recipient) public virtual restricted() returns (uint256 /*outputAmount*/) {
        uint256 outputAmount = previewExactInput(path, inputAmount);
        _swapExact(path[0], path[path.length - 1], inputAmount, outputAmount, _msgSender(), recipient);
        return outputAmount;
    }

    function swapExactInputSingle(IERC20 input, IERC20 output, uint256 inputAmount, address recipient) public virtual restricted() returns (uint256 /*outputAmount*/) {
        uint256 outputAmount = previewExactInputSingle(input, output, inputAmount);
        _swapExact(input, output, inputAmount, outputAmount, _msgSender(), recipient);
        return outputAmount;
    }

    function swapExactOutput(IERC20[] memory path, uint256 outputAmount, address recipient) public virtual restricted() returns (uint256 /*inputAmount*/) {
        uint256 inputAmount = previewExactOutput(path, outputAmount);
        _swapExact(path[0], path[path.length - 1], inputAmount, outputAmount, _msgSender(), recipient);
        return inputAmount;
    }

    function swapExactOutputSingle(IERC20 input, IERC20 output, uint256 outputAmount, address recipient) public virtual restricted() returns (uint256 /*inputAmount*/) {
        uint256 inputAmount = previewExactOutputSingle(input, output, outputAmount);
        _swapExact(input, output, inputAmount, outputAmount, _msgSender(), recipient);
        return inputAmount;
    }

    function _swapExact(IERC20 input, IERC20 output, uint256 inputAmount, uint256 outputAmount, address from, address to) private {
        SafeERC20.safeTransferFrom(input, from, address(this), inputAmount);
        SafeERC20.safeTransfer(output, to, outputAmount);
        emit SwapExact(input, output, inputAmount, outputAmount, from, to);
    }

    function _getPrices(Oracle oracle, uint256 oracleTTL) internal view virtual returns (int256 min, int256 max) {
        (uint80 roundId, int256 latest,,,) = oracle.latestRoundData();
        (, int256 previous,,uint256 updatedAt,) = oracle.getRoundData(roundId - 1);
        require(block.timestamp < updatedAt + oracleTTL, OracleValueTooOld(oracle));
        min = SignedMath.min(latest, previous);
        max = SignedMath.max(latest, previous);
    }

    /****************************************************************************************************************
     *                                                 Admin drain                                                  *
     ****************************************************************************************************************/
    function setPair(IERC20 token1, IERC20 token2, Oracle oracle, uint256 oracleTTL) public virtual restricted() {
        bytes32 id = hashPair(token1, token2);
        // Numerator and denomiator account for the difference in decimals between the two tokens AND for the decimals
        // of the oracle. The are used to scale the conversion rate between the two tokens.
        //
        // For example, if token A has 18 decimals and token B has 6 decimals, and the oracle has 8 decimals, then
        // - 1 token A correspond to 10**18 units (wei),
        // - 1 token B correspond to 10**6 units (wei),
        // - the rate provided by the oracle must be divided by 10**8.
        //
        // Therefore:
        // (<Amount of token A> / 10**18) * (rate / 10**8) = (<Amount of token B> / 10**6)
        // i.e. <Amount of token A> * 10**6 = <Amount of token B> * 10**(18 + 8)
        //
        // Which gives us the following conversion rate:
        // * <Amount of token A> * <numerator> / <denominator> = <Amount of token B>
        // * <Amount of token B> / <numerator> * <denominator> = <Amount of token A>
        //
        // with:
        // * numerator = 10**<decimals of token B>
        // * denominator = 10**(<decimals of token A> + <decimals of oracle>).
        _pairs[id] = Pair({
            token1: token1,
            token2: token2,
            oracle: oracle,
            oracleTTL: oracleTTL,
            numerator: 10 ** tryFetchDecimals(token2),
            denominator: 10 ** (tryFetchDecimals(token1) + oracle.decimals())
        });

        emit PairUpdated(id, token1, token2, oracle, oracleTTL);
    }

    function removePair(IERC20 token1, IERC20 token2) public virtual restricted() {
        bytes32 id = hashPair(token1, token2);
        delete _pairs[id];

        emit PairRemoved(id);
    }

    function setFee(uint256 newFeeBasisPoints) public virtual restricted() {
        require(newFeeBasisPoints <= 50, InvalidFee(newFeeBasisPoints)); // Max 0.5%
        feeBasisPoints = newFeeBasisPoints;
        emit FeeUpdated(newFeeBasisPoints);
    }

    function withdraw(IERC20 _token, address _to, uint256 _amount) public virtual restricted() {
        SafeERC20.safeTransfer(
            _token,
            _to,
            _amount == type(uint256).max
                ? _token.balanceOf(address(this))
                : _amount
        );
    }

    /****************************************************************************************************************
     *                                              Context overrides                                               *
     ****************************************************************************************************************/
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return super._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return super._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return super._contextSuffixLength();
    }
}