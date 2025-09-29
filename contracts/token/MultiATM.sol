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

    struct Pair {
        IERC20 token1;
        IERC20 token2;
        Oracle oracle;
        uint256 oracleTTL;
        uint256 numerator;
        uint256 denominator;
    }

    mapping(bytes32 id => Pair) private _pairs;

    event SwapExact(IERC20 indexed input, IERC20 indexed output, uint256 inputAmount, uint256 outputAmount, address from, address to);
    event PairUpdated(bytes32 indexed id, IERC20 indexed token1, IERC20 indexed token2, Oracle oracle, uint256 oracleTTL);
    event PairRemoved(bytes32 indexed id);
    error OracleValueTooOld(Oracle oracle);
    error UnknownPair(IERC20 input, IERC20 output);

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
            outputAmount = previewExactInputSingle(path[i], path[i+1], outputAmount);
        }
        return outputAmount;
    }

    function previewExactOutput(IERC20[] memory path, uint256 outputAmount) public view virtual returns (uint256 /*inputAmount*/) {
        uint256 inputAmount = outputAmount;
        for (uint256 i = path.length - 1; i > 0; --i) {
            inputAmount = previewExactOutputSingle(path[i-1], path[i], inputAmount);
        }
        return inputAmount;
    }

    function previewExactInputSingle(IERC20 input, IERC20 output, uint256 inputAmount) public view virtual returns (uint256 /*outputAmount*/) {
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

    function previewExactOutputSingle(IERC20 input, IERC20 output, uint256 outputAmount) public view virtual returns (uint256 /*inputAmount*/) {
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
        uint256 x = tryFetchDecimals(token1) + oracle.decimals();
        uint256 y = tryFetchDecimals(token2);
        _pairs[id] = Pair({
            token1: token1,
            token2: token2,
            oracle: oracle,
            oracleTTL: oracleTTL,
            numerator: 10 ** Math.saturatingSub(y, x),
            denominator: 10 ** Math.saturatingSub(x, y)
        });

        emit PairUpdated(id, token1, token2, oracle, oracleTTL);
    }

    function removePair(IERC20 token1, IERC20 token2) public virtual restricted() {
        bytes32 id = hashPair(token1, token2);
        delete _pairs[id];

        emit PairRemoved(id);
    }

    function drain(IERC20 _token, address _to, uint256 _amount) public virtual restricted() {
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