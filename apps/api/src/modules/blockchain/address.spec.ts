import { InvalidAddressError, isEvmAddress, normalizeAddress, sameAddress } from "./address";

describe("addresses", () => {
  const usdt = "0x55d398326f99059fF775485246999027B3197955";

  it("accepts the shape and canonicalises the case", () => {
    expect(isEvmAddress(usdt)).toBe(true);
    expect(normalizeAddress(`  ${usdt} `)).toBe(usdt.toLowerCase());
    expect(sameAddress(usdt, usdt.toLowerCase())).toBe(true);
  });

  it("refuses anything that is not forty hex digits behind 0x", () => {
    for (const bad of ["", "0x", usdt.slice(0, -1), `${usdt}0`, usdt.replace("0x", ""), "0xZZ"]) {
      expect(isEvmAddress(bad)).toBe(false);
      expect(() => normalizeAddress(bad)).toThrow(InvalidAddressError);
    }
  });
});
