import { Contract } from "ethers";

export const Enum = (...options: string[]) =>
  Object.fromEntries(options.map((key, i) => [key, i]));
export const toHexString = (i: bigint) =>
  "0x" + i.toString(16).padStart(64, "0");
export const toMask = (i: number) => toHexString(1n << BigInt(i));
export const combine = (...masks: any[]) =>
  toHexString(masks.reduce((acc, m) => acc | BigInt(m), 0n));

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

export const getDomain = async (contract: Contract) => {
  const {
    fields,
    name,
    version,
    chainId,
    verifyingContract,
    salt,
    extensions,
  } = await contract.eip712Domain();
  if (extensions.length > 0) {
    throw Error("Extensions not implemented");
  }
  const domain = { name, version, chainId, verifyingContract, salt };
  for (const [i, { name }] of EIP712Domain.entries()) {
    if (!(fields & (1 << i))) {
      delete domain[name];
    }
  }
  return domain;
};
