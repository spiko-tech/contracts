// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority        } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20            } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC20Metadata    } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { ERC2771Context    } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { SafeERC20         } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math              } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast          } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
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

/// @custom:security-contact security@spiko.tech
contract ATM is ERC2771Context, PermissionManaged, Multicall
{
    using Math     for *;
    using SafeCast for *;

    IERC20  immutable public token;
    IERC20  immutable public stable;
    Oracle  immutable public oracle;
    uint256 immutable private numerator;
    uint256 immutable private denominator;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(Oracle _oracle, IERC20 _stable, IAuthority _authority, address _trustedForwarder)
        PermissionManaged(_authority)
        ERC2771Context(_trustedForwarder)
    {
        token             = _oracle.token();
        stable            = _stable;
        oracle            = _oracle;

        // rate correction
        uint256 x = tryFetchDecimals(token) + oracle.decimals();
        uint256 y = tryFetchDecimals(stable);
        numerator   = x < y ? 10 ** (y - x) : 1;
        denominator = x > y ? 10 ** (x - y) : 1;
    }

    function previewBuy(IERC20 input, uint256 inputAmount) public view virtual returns (uint256 tokenAmount, uint256 stableAmount) {
        int256 price = oracle.getHistoricalPrice(block.timestamp.toUint48());
        if (input == token) {
            return (inputAmount, _convertToStable(inputAmount, price, Math.Rounding.Ceil));
        } else if (input == stable) {
            return (_convertToToken(inputAmount, price, Math.Rounding.Floor), inputAmount);
        } else {
            revert("invalid input token");
        }
    }

    function previewSell(IERC20 input, uint256 inputAmount) public view virtual returns (uint256 tokenAmount, uint256 stableAmount) {
        int256 price = oracle.getHistoricalPrice(block.timestamp.toUint48());
        if (input == token) {
            return (inputAmount, _convertToStable(inputAmount, price, Math.Rounding.Floor));
        } else if (input == stable) {
            return (_convertToToken(inputAmount, price, Math.Rounding.Ceil), inputAmount);
        } else {
            revert("invalid input token");
        }
    }

    function buy(IERC20 input, uint256 inputAmount, address to) public virtual returns (uint256, uint256) {
        (uint256 tokenAmount, uint256 stableAmount) = previewBuy(input, inputAmount);
        SafeERC20.safeTransferFrom(stable, _msgSender(), address(this), stableAmount);
        SafeERC20.safeTransfer(token, to, tokenAmount);
        return (tokenAmount, stableAmount);
    }

    function sell(IERC20 input, uint256 inputAmount, address to) public virtual returns (uint256, uint256) {
        (uint256 tokenAmount, uint256 stableAmount) = previewSell(input, inputAmount);
        SafeERC20.safeTransferFrom(token, _msgSender(), address(this), tokenAmount);
        SafeERC20.safeTransfer(stable, to, stableAmount);
        return (tokenAmount, stableAmount);
    }

    function _convertToStable(uint256 tokenAmount, int256 price, Math.Rounding rounding) internal view virtual returns (uint256) {
        return tokenAmount.mulDiv(numerator * price.toUint256(), denominator, rounding);
    }

    function _convertToToken(uint256 stableAmount, int256 price, Math.Rounding rounding) internal view virtual returns (uint256) {
        return stableAmount.mulDiv(denominator, numerator * price.toUint256(), rounding);
    }

    /****************************************************************************************************************
     *                                                 Admin drain                                                  *
     ****************************************************************************************************************/
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
