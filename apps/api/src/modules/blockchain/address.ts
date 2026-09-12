/*
  An address as this application handles it: shape-checked and lower-cased.

  Lower-casing is the comparison rule. A chain address is case-insensitive
  (EIP-55 uses case only as a checksum), and two spellings of one address
  must never look like two addresses to a lookup. The EIP-55 checksum itself
  needs keccak-256, which nothing here depends on yet; validating it belongs
  to the real adapter in Phase 6, where a mistyped destination should be
  refused before anything is signed.
*/

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class InvalidAddressError extends Error {
  constructor(message = "That is not a valid address for this network.") {
    super(message);
    this.name = "InvalidAddressError";
  }
}

export const isEvmAddress = (value: string): boolean => EVM_ADDRESS.test(value);

/** The canonical spelling: lower-cased. Throws for anything that is not an address. */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!isEvmAddress(trimmed)) throw new InvalidAddressError();
  return trimmed.toLowerCase();
}

export const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
