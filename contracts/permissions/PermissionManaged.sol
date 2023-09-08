// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "../interfaces/IAuthority.sol";

/// @custom:security-contact TODO
/// @custom:oz-upgrades-unsafe-allow state-variable-immutable state-variable-assignment
abstract contract PermissionManaged {
    IAuthority public immutable authority;

    modifier restricted() {
        require(authority.canCall(msg.sender, address(this), msg.sig), "Restricted access");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) {
        authority = _authority;
    }
}
