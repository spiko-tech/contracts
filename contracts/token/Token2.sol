// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority       } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC1363Receiver } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { Token            } from "./Token.sol";

/// @custom:security-contact security@spiko.tech
contract Token2 is Token
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority, address _trustedForwarder) Token(_authority, _trustedForwarder) {}

    function mintAndCall(address to, uint256 amount, bytes memory data) public restrictedCustom(this.mint.selector) {
        _mint(to, amount);

        try IERC1363Receiver(to).onTransferReceived(_msgSender(), address(0), amount, data) returns (bytes4 selector) {
            require(selector == IERC1363Receiver(to).onTransferReceived.selector, "ERC1363: onTransferReceived invalid result");
        } catch (bytes memory reason) {
            if (reason.length == 0) {
                revert("ERC1363: onTransferReceived reverted without reason");
            } else {
                /// @solidity memory-safe-assembly
                assembly {
                    revert(add(32, reason), mload(reason))
                }
            }
        }
    }
}
