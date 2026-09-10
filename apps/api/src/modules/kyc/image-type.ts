import { type KycImageType } from "@abay/contracts";

/*
  What an image is, read from its first bytes rather than from what the
  request said. A browser fills Content-Type in from the file's name, and a
  file can be called anything; the bytes are what a reviewer will open.
*/

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWith(buffer: Buffer, magic: readonly number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

/** The image format the bytes actually are, or null for anything that is not one of ours. */
export function sniffImageType(buffer: Buffer): KycImageType | null {
  if (startsWith(buffer, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(buffer, PNG_MAGIC)) return "image/png";
  // "RIFF", four bytes of length, "WEBP".
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** The file extension a stored object gets, so a reviewer's tools open it without guessing. */
export const IMAGE_EXTENSIONS: Readonly<Record<KycImageType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
