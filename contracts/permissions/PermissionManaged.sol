// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority } from "@openzeppelin/contracts/access/manager/IAuthority.sol";

/// @custom:security-contact security@spiko.tech
/// @custom:oz-upgrades-unsafe-allow state-variable-immutable
abstract contract PermissionManaged {
    IAuthority public immutable authority;

    error RestrictedAccess(address caller, address target, bytes4 selector);

    modifier restricted() {
        _checkRestricted(msg.sig);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) {
        authority = _authority;
    }

    function _checkRestricted(bytes4 selector) internal view {
        _checkRestricted(address(this), selector);
    }

    function _checkRestricted(address target, bytes4 selector) internal view {
        if (!authority.canCall(msg.sender, target, selector)) {
            revert RestrictedAccess(msg.sender, target, selector);
        }
    }
}
