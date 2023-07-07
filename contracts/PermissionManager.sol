// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "./interfaces/IAuthority.sol";
import "./utils/Mask.sol";

// @Amxx do you think we should make the PermissionManager contract upgradeable, at least at first? 
contract PermissionManager is IAuthority, Multicall {
    using Masks for *;

    Masks.Mask public immutable ADMIN  = 0x00.toMask();
    Masks.Mask public immutable PUBLIC = 0xFF.toMask();

    mapping(address =>                   Masks.Mask ) private _permissions;
    mapping(address => mapping(bytes4 => Masks.Mask)) private _restrictions;
    mapping(uint8   =>                   Masks.Mask ) private _admin;

    event GroupAdded(address indexed user, uint8 indexed group);
    event GroupRemoved(address indexed user, uint8 indexed group);
    event GroupAdmins(uint8 indexed group, Masks.Mask admins);
    event Requirements(address indexed target, bytes4 indexed selector, Masks.Mask groups);

    modifier onlyRole(Masks.Mask groups) {
        require(!getGroups(msg.sender).intersection(groups).isEmpty(), "Missing permissions");
        _;
    }

    constructor(address admin) {
        _setGroupAdmins(0, ADMIN);
        _addGroup(admin, 0);
    }

    // Getters
    function canCall(address caller, address target, bytes4 selector) public view returns (bool) {
        return !getGroups(caller).intersection(getRequirements(target, selector)).isEmpty();
    }

    function getGroups(address user) public view returns (Masks.Mask) {
        return _permissions[user].union(PUBLIC);
    }

    function getRequirements(address target, bytes4 selector) public view returns (Masks.Mask) {
        return _restrictions[target][selector];
    }

    // Group management

    // It's very likely we'll need to whitelist addresses in batch - would it be possible / more 
    // gas-efficient - to allow here to whitelist an address[]? Same question for the removal
    function addGroup(address user, uint8 group) public onlyRole(_admin[group]) {
        _addGroup(user, group);
    }

    function remGroup(address user, uint8 group) public onlyRole(_admin[group]) {
        _remGroup(user, group);
    }

    function _addGroup(address user, uint8 group) internal {
        _permissions[user] = _permissions[user].union(group.toMask());
        emit GroupAdded(user, group);
    }

    function _remGroup(address user, uint8 group) internal {
        _permissions[user] = _permissions[user].difference(group.toMask());
        emit GroupRemoved(user, group);
    }

    // Group admin management
    function setGroupAdmins(uint8 group, uint8[] calldata admins) public onlyRole(ADMIN) {
        _setGroupAdmins(group, admins.toMask());
    }

    function _setGroupAdmins(uint8 group, Masks.Mask admins) internal {
        _admin[group] = admins;
        emit GroupAdmins(group, admins);
    }

    // Requirement management
    function setRequirements(address target, bytes4[] calldata selectors, uint8[] calldata groups) public onlyRole(ADMIN) {
        Masks.Mask mask = groups.toMask();
        for (uint256 i = 0; i < selectors.length; ++i) {
            _setRequirements(target, selectors[i], mask);
        }
    }

    function _setRequirements(address target, bytes4 selector, Masks.Mask groups) internal {
        _restrictions[target][selector] = groups;
        emit Requirements(target, selector, groups);
    }
}
