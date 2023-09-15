// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "../interfaces/IAuthority.sol";

/// @custom:security-contact TODO
/// @custom:oz-upgrades-unsafe-allow state-variable-immutable state-variable-assignment
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
        if (!authority.canCall(msg.sender, address(this), selector)) {
            revert RestrictedAccess(msg.sender, address(this), selector);
        }
    }
}
