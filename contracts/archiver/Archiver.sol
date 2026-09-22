// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { IAuthority, PermissionManaged } from "../permissions/PermissionManaged.sol";
import { EventArchive } from "@spiko/erc-cross-chain-event-archive/src/EventArchive.sol";
import { IEventArchive } from "@spiko/erc-cross-chain-event-archive/src/interfaces/IEventArchive.sol";
import { IEventArchiveWriter } from "@spiko/erc-cross-chain-event-archive/src/interfaces/IEventArchiveWriter.sol";

/// @title Archiver
/// @dev Cross-Chain Event Archive with permissioned write access. Each call to {archiveEvent} for
/// the same (sourceChainId, sourceTxHash, sourceLogIndex) appends a new version: the first call
/// records the original event, subsequent calls are amendments.
contract Archiver is EventArchive, IEventArchiveWriter, IERC165, PermissionManaged, UUPSUpgradeable, Multicall {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {}

    /// @inheritdoc IEventArchiveWriter
    function archiveEvent(
        uint256 sourceChainId,
        bytes32 sourceTxHash,
        address sourceAddress,
        uint256 sourceLogIndex,
        uint256 sourceBlockNumber,
        bytes calldata payload
    ) external restricted {
        _archiveEvent(sourceChainId, sourceTxHash, sourceAddress, sourceLogIndex, sourceBlockNumber, payload);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return
            interfaceId == type(IEventArchive).interfaceId ||
            interfaceId == type(IEventArchiveWriter).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
