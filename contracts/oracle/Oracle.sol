// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IAuthority            } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20Metadata        } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { UUPSUpgradeable       } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { Initializable         } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeCast              } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Checkpoints           } from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import { Multicall             } from "@openzeppelin/contracts/utils/Multicall.sol";
import { PermissionManaged     } from "../permissions/PermissionManaged.sol";

/// @custom:security-contact security@spiko.tech
contract Oracle is
    AggregatorV3Interface,
    Initializable,
    PermissionManaged,
    UUPSUpgradeable,
    Multicall
{
    using Checkpoints  for Checkpoints.Trace208;
    using SafeCast     for *;

    IERC20Metadata       public           token;
    uint256              public constant  version  = 0;
    uint8                public constant  decimals = 18;
    string               public           description; // set per-instance at initialization
    Checkpoints.Trace208 private          _history;

    event Update(uint48 timepoint, int256 price, uint256 round);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {
        _disableInitializers();
    }

    function initialize(IERC20Metadata _token, string calldata denomination) public initializer() {
        token       = _token;
        description = string.concat(_token.symbol(), " / ", denomination);
    }

    /****************************************************************************************************************
     *                                               Publish & Lookup                                               *
     ****************************************************************************************************************/
    function getLatestPrice() public view returns (int256) {
        return _history.latest().toInt256();
    }

    function getHistoricalPrice(uint48 _timepoint) public view returns (int256) {
        return _history.upperLookup(_timepoint).toInt256();
    }

    // Note: we are not using block.timestamp for the timepoint because of the mining delay for the update transaction
    // and the fact that prices represent a value at a specific "update" time (according to regulation).
    function publishPrice(uint48 timepoint, uint208 price) public restricted() returns (uint80) {
        uint80 roundId = _history.length().toUint80();
        _history.push(timepoint, price);

        emit Update(timepoint, price.toInt256(), roundId);

        return roundId;
    }

    /****************************************************************************************************************
     *                                            AggregatorV3Interface                                             *
     ****************************************************************************************************************/
    // function version() public pure returns (uint256); -- implemented by a public variable
    // function decimals() public pure returns (uint8); -- implemented by a public variable
    // function description() public view returns (string memory); -- implemented by a public variable

    function getRoundData(uint80 _roundId)
        public
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        require(_roundId < _history.length(), "No checkpoint for roundId");
        Checkpoints.Checkpoint208 memory ckpt = _history._checkpoints[_roundId];

        return (
            _roundId,
            ckpt._value.toInt256(),
            ckpt._key,
            ckpt._key,
            _roundId // deprecated
        );
    }

    function latestRoundData()
        public
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return getRoundData(_history.length().toUint80() - 1);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
