// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC165          } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IERC1363         } from "@openzeppelin/contracts/interfaces/IERC1363.sol";
import { IERC1363Receiver } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { IERC1363Spender  } from "@openzeppelin/contracts/interfaces/IERC1363Spender.sol";
import { ERC165           } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @custom:security-contact security@spiko.tech
abstract contract ERC1363Upgradeable is IERC1363, ERC20Upgradeable, ERC165 {
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IERC1363).interfaceId || super.supportsInterface(interfaceId);
    }

    function transferAndCall(address to, uint256 value) public override returns (bool) {
        return transferAndCall(to, value, bytes(""));
    }

    function transferAndCall(address to, uint256 value, bytes memory data) public override returns (bool) {
        require(transfer(to, value));
        try IERC1363Receiver(to).onTransferReceived(_msgSender(), _msgSender(), value, data) returns (bytes4 selector) {
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
        return true;
    }

    function transferFromAndCall(address from, address to, uint256 value) public override returns (bool) {
        return transferFromAndCall(from, to, value, bytes(""));
    }

    function transferFromAndCall(address from, address to, uint256 value, bytes memory data) public override returns (bool) {
        require(transferFrom(from, to, value));
        try IERC1363Receiver(to).onTransferReceived(_msgSender(), from, value, data) returns (bytes4 selector) {
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
        return true;
    }

    function approveAndCall(address spender, uint256 value) public override returns (bool) {
        return approveAndCall(spender, value, bytes(""));
    }

    function approveAndCall(address spender, uint256 value, bytes memory data) public override returns (bool) {
        require(approve(spender, value));
        try IERC1363Spender(spender).onApprovalReceived(_msgSender(), value, data) returns (bytes4 selector) {
            require(selector == IERC1363Spender(spender).onApprovalReceived.selector, "ERC1363: onApprovalReceived invalid result");
        } catch (bytes memory reason) {
            if (reason.length == 0) {
                revert("ERC1363: onApprovalReceived reverted without reason");
            } else {
                /// @solidity memory-safe-assembly
                assembly {
                    revert(add(32, reason), mload(reason))
                }
            }
        }
        return true;
    }
}
