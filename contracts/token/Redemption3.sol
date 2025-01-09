// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority  } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { SafeERC20   } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Token       } from "./Token.sol";
import { Redemption2 } from "./Redemption2.sol";

/// @custom:security-contact security@spiko.tech
contract Redemption3 is Redemption2
{
    using SafeERC20 for Token;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) Redemption2(_authority) {}

    /// @dev relax timing requirement. Authorized accounts can cancel at any time
    function cancelRedemption(
        address user,
        Token   input,
        address output,
        uint256 inputValue,
        bytes32 salt
    ) external override {
        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, inputValue, salt);

        // Check that operation exist and deadline is passed (or caller is authorized)
        require(details[id].status == Status.PENDING, "Operation is not pending");
        require(details[id].deadline <= block.timestamp || authority.canCall(msg.sender, address(this), msg.sig), "Deadline not passed");

        // Mark operation as canceled
        details[id].status = Status.CANCELED;

        // Refund user
        input.safeTransfer(user, inputValue);

        // Emit event
        emit RedemptionCanceled(id);
    }
}
