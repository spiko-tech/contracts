// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { Redemption } from "./Redemption.sol";

/// @custom:security-contact security@spiko.tech
contract Redemption2 is Redemption
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) Redemption(_authority) {}

    function onTransferReceived(
        address user,
        address from,
        uint256 value,
        bytes calldata data
    ) public virtual override returns (bytes4) {
        if (data.length >= 0x60) {
            (,, user) = abi.decode(data, (address, bytes32, address));
        }

        return super.onTransferReceived(user, from, value, data);
    }
}