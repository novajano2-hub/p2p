import { toast } from "@/lib/toast";

/*
  Every image a person sends goes through here: a KYC photograph, a picture in
  a trade's chat, a screenshot for a dispute. One set of rules, one way of
  saying no, and one preparation before a byte leaves the phone.

  A phone camera produces a 3-8 MB JPEG with a location stamp in it. Nobody who
  looks at these needs either: the picture is redrawn at a size that still
  shows every letter on an ID card, encoded once as JPEG, and in the process
  everything that was not pixels - the GPS position, the device model, the
  original orientation tag - is left behind. Smaller is also kinder to a mobile
  connection, which is where most of these are taken.

  The server reads the bytes and refuses anything that is not a JPEG, PNG or
  WebP, or is over its size. Saying so here first matters for size in
  particular: a body the server refuses for its size is answered by closing
  the connection mid-upload, which a browser reports as a network failure
  rather than as the refusal it was.
*/

/** The formats the API accepts. Anything else is redrawn as a JPEG first, or refused. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The largest image each place takes, in bytes. Mirrors KYC_IMAGE_MAX_BYTES,
 * CHAT_IMAGE_MAX_BYTES and DISPUTE_EVIDENCE_MAX_BYTES in @abay/contracts
 * (lib/contracts-mirror.spec.ts holds them together).
 */
export const IMAGE_LIMITS = {
  kyc: 10 * 1024 * 1024,
  chat: 5 * 1024 * 1024,
  evidence: 5 * 1024 * 1024,
} as const;
export type ImageSurface = keyof typeof IMAGE_LIMITS;

/** Longest edge, in pixels. An ID card at this size is comfortably legible. */
const MAX_EDGE = 2_000;
const JPEG_QUALITY = 0.85;

/** One refusal at a time: a second bad pick replaces the first rather than stacking. */
const REFUSED_TOAST = "image-refused";

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/** "HEIC", from the type or failing that the file's extension; null when neither says. */
function formatOf(file: { type: string; name?: string | undefined }): string | null {
  const fromType = /^image\/([a-z0-9.+-]+)$/i.exec(file.type)?.[1];
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1];
  const format = (fromType ?? fromName)?.replace(/\+xml$/i, "");
  return format ? format.toUpperCase() : null;
}

/**
 * What is wrong with an image, for one place, before it is sent - or null.
 * Asked of the file as chosen and again of what preparing it produced.
 */
export function imageRefusal(
  file: { type: string; size: number; name?: string | undefined },
  surface: ImageSurface,
): string | null {
  if (file.size === 0) return "That file is empty. Choose the picture again.";
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    const format = formatOf(file);
    const looksLikeImage =
      file.type.startsWith("image/") || /^(HEIC|HEIF|AVIF|GIF|BMP|TIFF?)$/.test(format ?? "");
    return looksLikeImage && format
      ? `This browser cannot read ${format} images. Choose a JPEG, PNG or WebP.`
      : "That file is not a picture. Choose a JPEG, PNG or WebP image.";
  }
  const limit = IMAGE_LIMITS[surface];
  if (file.size > limit) return `That image is over ${megabytes(limit)}. Choose a smaller one.`;
  return null;
}

/**
 * A chosen file, made ready to send to one place, or null when it cannot be -
 * in which case the reason has been said, as a toast, so every picker in the
 * app refuses the same way and none of them has to.
 */
export async function pickImage(
  file: File | null | undefined,
  surface: ImageSurface,
): Promise<Blob | null> {
  if (!file) return null;
  // Redrawn before it is judged: a 9 MB camera photo becomes a 1 MB JPEG rather than a refusal.
  const image = file.type.startsWith("image/") ? await prepareImage(file) : file;
  const problem = imageRefusal({ type: image.type, size: image.size, name: file.name }, surface);
  if (problem) {
    toast.error(problem, { id: REFUSED_TOAST });
    return null;
  }
  return image;
}

/**
 * The picture redrawn at most MAX_EDGE on its longest side, as a JPEG. Anything
 * the browser cannot decode (a HEIC the camera saved, say) comes back as it
 * came, for the rules above to judge.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the camera's orientation tag while decoding, so
    // a portrait photo does not come out sideways once the tag is gone.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    return encoded ?? file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
