const Enum        = (...options) => Object.fromEntries(options.map((key, i) => [key, i]));
const toHexString = i => '0x' + i.toString(16).padStart(64, 0);
const toMask      = i => toHexString(1n << BigInt(i));
const combine     = (...masks) => toHexString(masks.reduce((acc, m) => acc | BigInt(m), 0n));

module.exports = {
    Enum,
    toHexString,
    toMask,
    combine,
}