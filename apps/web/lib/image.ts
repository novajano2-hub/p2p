/*
  Gets a photograph ready to upload, in the browser, before a byte leaves the
  phone.

  A phone camera produces a 3-8 MB JPEG with a location stamp in it. A
  reviewer needs neither the size nor the stamp: the picture is redrawn at a
  size that still shows every letter on an ID card, encoded once as JPEG, and
  in the process everything that was not pixels - the GPS position, the
  device model, the original orientation tag - is left behind. Smaller is
  also kinder to a mobile connection, which is where most of these will be
  taken.

  Anything the browser cannot decode (a HEIC the camera saved, say) is sent
  as it came. The server checks the bytes either way.
*/

/** Longest edge, in pixels. An ID card at this size is comfortably legible. */
const MAX_EDGE = 2_000;
const JPEG_QUALITY = 0.85;

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
