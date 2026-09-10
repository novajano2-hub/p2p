import { sniffImageType } from "./image-type";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const webp = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

describe("sniffImageType", () => {
  it("recognises the three formats by their first bytes", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("rejects anything else, including text that claims to be an image", () => {
    expect(sniffImageType(Buffer.from("<html>hello</html>"))).toBeNull();
    expect(sniffImageType(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    // RIFF is also what a WAV file starts with; only a WEBP tag makes it an image.
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"))).toBeNull();
  });

  it("does not read past the end of a short buffer", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.from("RIFF", "latin1"))).toBeNull();
  });
});
