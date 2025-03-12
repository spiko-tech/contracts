// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20     } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { Math       } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { SafeCast   } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Oracle     } from "../oracle/Oracle.sol";
import { ATM        } from "./ATM.sol";

/// @custom:security-contact security@spiko.tech
contract ATM2 is ATM
{
    using Math     for *;
    using SafeCast for *;

    constructor(Oracle _oracle, IERC20 _stable, IAuthority _authority, address _trustedForwarder)
        ATM(_oracle, _stable, _authority, _trustedForwarder)
    {}

    function previewBuy(IERC20 input, uint256 inputAmount) public view virtual override returns (uint256 tokenAmount, uint256 stableAmount) {
        (,int256 price) = _getPrices(); // max
        if (input == token) {
            return (inputAmount, _convertToStable(inputAmount, price, Math.Rounding.Ceil));
        } else if (input == stable) {
            return (_convertToToken(inputAmount, price, Math.Rounding.Floor), inputAmount);
        } else {
            revert("invalid input token");
        }
    }

    function previewSell(IERC20 input, uint256 inputAmount) public view virtual override returns (uint256 tokenAmount, uint256 stableAmount) {
        (int256 price,) = _getPrices(); // min
        if (input == token) {
            return (inputAmount, _convertToStable(inputAmount, price, Math.Rounding.Floor));
        } else if (input == stable) {
            return (_convertToToken(inputAmount, price, Math.Rounding.Ceil), inputAmount);
        } else {
            revert("invalid input token");
        }
    }

    function _getPrices() internal view virtual returns (int256 min, int256 max) {
        (uint80 roundId, int256 latest,,,) = oracle.latestRoundData();
        (, int256 previous,,,) = oracle.getRoundData(roundId - 1);
        min = SignedMath.min(latest, previous);
        max = SignedMath.max(latest, previous);
    }
}
