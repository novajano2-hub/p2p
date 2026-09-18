import { IMAGE_LIMITS, imageRefusal } from "@/lib/image";

/*
  The rules every picker in the app applies before an image is sent. Preparing
  the image needs a canvas and is exercised in the browser; the judgement on
  what came out of it is pure, and is pinned here.
*/

const MB = 1024 * 1024;

describe("imageRefusal", () => {
  it("accepts the three formats the API reads, up to each place's limit", () => {
    expect(imageRefusal({ type: "image/jpeg", size: 2 * MB }, "chat")).toBeNull();
    expect(imageRefusal({ type: "image/png", size: 5 * MB }, "evidence")).toBeNull();
    expect(imageRefusal({ type: "image/webp", size: 10 * MB }, "kyc")).toBeNull();
  });

  it("holds each place to its own limit", () => {
    expect(imageRefusal({ type: "image/jpeg", size: 5 * MB + 1 }, "chat")).toBe(
      "That image is over 5 MB. Choose a smaller one.",
    );
    expect(imageRefusal({ type: "image/jpeg", size: 5 * MB + 1 }, "kyc")).toBeNull();
    expect(imageRefusal({ type: "image/jpeg", size: IMAGE_LIMITS.kyc + 1 }, "kyc")).toBe(
      "That image is over 10 MB. Choose a smaller one.",
    );
  });

  it("names an image format the browser could not read", () => {
    expect(imageRefusal({ type: "image/heic", size: MB }, "kyc")).toBe(
      "This browser cannot read HEIC images. Choose a JPEG, PNG or WebP.",
    );
    // Windows reports no type at all for a HEIC it has no codec for.
    expect(imageRefusal({ type: "", size: MB, name: "IMG_0412.HEIC" }, "chat")).toBe(
      "This browser cannot read HEIC images. Choose a JPEG, PNG or WebP.",
    );
  });

  it("tells a picture from something that is not one", () => {
    const notAPicture = "That file is not a picture. Choose a JPEG, PNG or WebP image.";
    expect(imageRefusal({ type: "application/pdf", size: MB, name: "receipt.pdf" }, "chat")).toBe(
      notAPicture,
    );
    expect(imageRefusal({ type: "", size: MB, name: "notes" }, "evidence")).toBe(notAPicture);
  });

  it("refuses an empty file before anything else", () => {
    expect(imageRefusal({ type: "image/png", size: 0 }, "chat")).toBe(
      "That file is empty. Choose the picture again.",
    );
  });
});
