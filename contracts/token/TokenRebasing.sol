// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority                } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20                    } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC20Metadata            } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IERC1363Receiver          } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { IERC4626                  } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC5313                  } from "@openzeppelin/contracts/interfaces/IERC5313.sol";
import { SafeERC20                 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math                      } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast                  } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { UUPSUpgradeable           } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ERC20Upgradeable          } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PausableUpgradeable  } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import { ERC20PermitUpgradeable    } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { ERC4626Upgradeable        } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { ContextUpgradeable        } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { MulticallUpgradeable      } from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import { Token                     } from "./Token.sol";
import { ERC1363Upgradeable        } from "./extensions/ERC1363Upgradeable.sol";
import { Oracle                    } from "../oracle/Oracle.sol";
import { PermissionManaged         } from "../permissions/PermissionManaged.sol";

/// @custom:security-contact security@spiko.tech
contract TokenRebasing is
    IERC1363Receiver,
    IERC5313,
    ERC2771ContextUpgradeable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ERC1363Upgradeable,
    ERC4626Upgradeable,
    PermissionManaged,
    UUPSUpgradeable,
    MulticallUpgradeable
{
    using Math     for uint256;
    using SafeCast for int256;

    Oracle  public oracle;
    uint256 private oracleDemoninator;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority, address _trustedForwarder)
        PermissionManaged(_authority)
        ERC2771ContextUpgradeable(_trustedForwarder)
    {
        _disableInitializers();
    }

    function initialize(Oracle _oracle) public initializer() {
        IERC20Metadata _token = _oracle.token();
        string memory _name = string.concat(_token.name()," (rebasing)");
        string memory _symbol = string.concat(_token.symbol(), "-R");

        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __ERC4626_init(_token);

        oracle = _oracle;
        oracleDemoninator = 10 ** _oracle.decimals();
    }

    /****************************************************************************************************************
     *                                        Copy underlying token settings                                        *
     ****************************************************************************************************************/
    function decimals() public view virtual override(ERC20Upgradeable, ERC4626Upgradeable) returns (uint8) {
        return Token(asset()).decimals();
    }

    function owner() public view virtual override returns (address) {
        return Token(asset()).owner();
    }

    function paused() public view virtual override returns (bool) {
        return Token(asset()).paused();
    }

    function onTransferReceived(
        address, /*operator*/
        address from,
        uint256 assets, /*amount*/
        bytes memory data
    ) external virtual returns (bytes4) {
        require(msg.sender == asset());

        // decode data
        (address receiver) = data.length < 0x20 ? (from) : abi.decode(data, (address));

        // check max deposit
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }
        // compute shares (rebasing), mint and emit event.
        // cannot use `_deposit` here because `_deposit` handles the transfer of underlying assets.
        uint256 shares = previewDeposit(assets);
        _mint(receiver, shares);
        emit Deposit(from, receiver, assets, shares);

        return IERC1363Receiver.onTransferReceived.selector;
    }

    /****************************************************************************************************************
     *                                        ERC-20 Overrides for rebasing                                         *
     ****************************************************************************************************************/
    // Rebase ERC20 balances and supply (stored in underlying)
    function totalSupply() public view virtual override(IERC20, ERC20Upgradeable) returns (uint256) {
        return _convertToShares(super.totalSupply(), Math.Rounding.Floor);
    }

    function balanceOf(address account) public view virtual override(IERC20, ERC20Upgradeable) returns (uint256) {
        return _convertToShares(super.balanceOf(account), Math.Rounding.Floor);
    }

    // Update ERC20 movements (labeled in rebasing, executed in underlying)
    function _update(address from, address to, uint256 value) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // sender must be whitelisted, unless its a mint (sender is 0) or its a burn (admin can burn from non-whitelisted account)
        if (from != address(0) && to != address(0) && !authority.canCall(from, asset(), IERC20.transfer.selector)) {
            revert Token.UnauthorizedFrom(address(this), from);
        }

        // receiver must be whitelisted, unless its a burn (receiver is 0)
        if (to != address(0) && !authority.canCall(to, asset(), IERC20.transfer.selector)) {
            revert Token.UnauthorizedTo(address(this), to);
        }

        super._update(
            from,
            to,
            _convertToAssets(
                value,
                (
                    msg.sig == IERC4626.deposit.selector ||
                    msg.sig == IERC4626.redeem.selector ||
                    msg.sig == IERC1363Receiver.onTransferReceived.selector
                )
                    ? Math.Rounding.Floor
                    : Math.Rounding.Ceil
            )
        );
    }

    /****************************************************************************************************************
     *                                          ERC-4626 Conversion rates                                           *
     ****************************************************************************************************************/
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        // underlying to rebasing
        return assets.mulDiv(oracle.getLatestPrice().toUint256(), oracleDemoninator, rounding);
    }
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        // rebasing to underlying
        return shares.mulDiv(oracleDemoninator, oracle.getLatestPrice().toUint256(), rounding);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(asset(), UUPSUpgradeable.upgradeToAndCall.selector);
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