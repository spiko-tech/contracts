// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority                } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20                    } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { OwnableUpgradeable        } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { UUPSUpgradeable           } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ERC20Upgradeable          } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PausableUpgradeable  } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import { ERC20PermitUpgradeable    } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { ContextUpgradeable        } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { MulticallUpgradeable      } from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import { PermissionManaged         } from "../permissions/PermissionManaged.sol";
import { ERC1363Upgradeable        } from "./extensions/ERC1363Upgradeable.sol";

/// @custom:security-contact security@spiko.tech
// Note that {ERC2771ContextUpgradeable} overrides the behavior of {Ownable}, {ERC20} & {ERC1363} but does not affect
// {PermissionManaged}. Therefor, `restricted()` function cannot be called through the forwarder.
contract Token is
    ERC2771ContextUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ERC1363Upgradeable,
    PermissionManaged,
    UUPSUpgradeable,
    MulticallUpgradeable
{
    error UnauthorizedFrom(address token, address user);
    error UnauthorizedTo(address token, address user);

    uint8 private m_decimals;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority, address _trustedForwarder)
        PermissionManaged(_authority)
        ERC2771ContextUpgradeable(_trustedForwarder)
    {
        _disableInitializers();
    }

    function initialize(string calldata _name, string calldata _symbol, uint8 _decimals) public initializer() {
        // __Ownable_init(); do not initialize ownership. By default owner is 0 until an admin sets it.
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        m_decimals = _decimals;
    }

    function decimals() public view virtual override returns (uint8) {
        return m_decimals;
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    function mint(address to, uint256 amount) public restricted() {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public restricted() {
        _burn(from, amount);
    }

    function pause() public restricted() {
        _pause();
    }

    function unpause() public restricted() {
        _unpause();
    }

    // Admin has the ability to force reset ownership
    function setOwnership(address newOwner) public restricted() {
        _transferOwnership(newOwner);
    }

    /****************************************************************************************************************
     *                                           Token transfer whitelist                                           *
     ****************************************************************************************************************/
    function _update(address from, address to, uint256 amount) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // sender must be whitelisted, unless its a mint (sender is 0) or its a burn (admin can burn from non-whitelisted account)
        if (from != address(0) && to != address(0) && !authority.canCall(from, address(this), IERC20.transfer.selector)) {
            revert UnauthorizedFrom(address(this), from);
        }

        // receiver must be whitelisted, unless its a burn (receiver is 0)
        if (to != address(0) && !authority.canCall(to, address(this), IERC20.transfer.selector)) {
            revert UnauthorizedTo(address(this), to);
        }

        super._update(from, to, amount);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }

    /****************************************************************************************************************
     *                                              Context overrides                                               *
     ****************************************************************************************************************/
    function _msgSender() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address) {
        return super._msgSender();
    }

    function _msgData() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function _contextSuffixLength() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (uint256) {
        return super._contextSuffixLength();
    }
}
