// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/utils/ShortStrings.sol";

import "../interfaces/IAuthority.sol";

/// @custom:security-contact TODO
contract PermissionedOracle is AggregatorV3Interface, Multicall
{
    // TODO: use Trace208
    using Checkpoints  for Checkpoints.Trace224;
    using ShortStrings for *;
    using SafeCast     for *;

    IAuthority           public  immutable authority;
    IERC20Metadata       public  immutable token;
    uint256              private immutable _version;
    uint8                private immutable _decimals;
    ShortString          private immutable _description;
    Checkpoints.Trace224 private           _history;

    modifier restricted() {
        require(authority.canCall(msg.sender, address(this), msg.sig), "Restricted access");
        _;
    }

    constructor(IAuthority _authority, IERC20Metadata _token) {
        authority    = _authority;
        token        = _token;
        _version     = 0;                                                        // TODO: confirm
        _decimals    = 18;                                                       // TODO: confirm
        _description = string.concat(_token.symbol(), " / USD").toShortString(); // TODO: confirm
    }

    /****************************************************************************************************************
     *                                               Publish & Lookup                                               *
     ****************************************************************************************************************/
    function getLatestPrice() public view returns (int256) {
        return _history.latest().toInt256();
    }

    function getHistoricalPrice(uint32 _timepoint) public view returns (int256) {
        return _history.upperLookup(_timepoint).toInt256();
    }

    function publishPrice(uint224 price, uint32 timepoint) public restricted() {
        _history.push(timepoint, price);

        // TODO: emit event?
    }

    /****************************************************************************************************************
     *                                            AggregatorV3Interface                                             *
     ****************************************************************************************************************/
    function version()     public view returns (uint256)       { return _version;                }
    function decimals()    public view returns (uint8)         { return _decimals;               }
    function description() public view returns (string memory) { return _description.toString(); }

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
        Checkpoints.Checkpoint224 memory ckpt = _history._checkpoints[_roundId];

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
}
