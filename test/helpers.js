const Enum = (...options) => Object.fromEntries(options.map((key, i) => [key, i]));
const toHexString = (i) => '0x' + i.toString(16).padStart(64, 0);
const toMask = (i) => toHexString(1n << BigInt(i));
const combine = (...masks) => toHexString(masks.reduce((acc, m) => acc | BigInt(m), 0n));

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

const getDomain = async (contract) => {
  const { fields, name, version, chainId, verifyingContract, salt, extensions } = await contract.eip712Domain();
  if (extensions.length > 0) {
    throw Error('Extensions not implemented');
  }
  const domain = { name, version, chainId, verifyingContract, salt };
  for (const [i, { name }] of EIP712Domain.entries()) {
    if (!(fields & (1 << i))) {
      delete domain[name];
    }
  }
  return domain;
};

module.exports = {
  Enum,
  toHexString,
  toMask,
  combine,
  getDomain,
};
