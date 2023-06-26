// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

library Masks {
    using Masks for *;

    type Mask is bytes32;

    function toMask(uint8 group) internal pure returns (Mask) {
        return Mask.wrap(bytes32(1 << group));
    }

    function toMask(uint8[] memory groups) internal pure returns (Mask) {
        Masks.Mask set = Mask.wrap(0);
        for (uint256 i = 0; i < groups.length; ++i) {
            set = groups[i].toMask().add(set);
        }
        return set;
    }

    function get(Mask self, uint8 group) internal pure returns (bool) {
        return !group.toMask().intersect(self).isEmpty();
    }

    function isEmpty(Mask self) internal pure returns (bool) {
        return Mask.unwrap(self) == bytes32(0);
    }

    function add(Mask m1, Mask m2) internal pure returns (Mask) {
        return Mask.wrap(Mask.unwrap(m1) | Mask.unwrap(m2));
    }

    function rem(Mask m1, Mask m2) internal pure returns (Mask) {
        return Mask.wrap(Mask.unwrap(m1) & ~Mask.unwrap(m2));
    }

    function intersect(Mask m1, Mask m2) internal pure returns (Mask) {
        return Mask.wrap(Mask.unwrap(m1) & Mask.unwrap(m2));
    }
}
