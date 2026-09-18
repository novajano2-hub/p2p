import { CHAT_IMAGE_MAX_BYTES } from "../../../packages/contracts/src/chat";
import { DISPUTE_EVIDENCE_MAX_BYTES } from "../../../packages/contracts/src/disputes";
import { KYC_IMAGE_MAX_BYTES, KYC_IMAGE_TYPES } from "../../../packages/contracts/src/kyc";
import { notificationType } from "../../../packages/contracts/src/notifications";
import { IMAGE_LIMITS, IMAGE_TYPES } from "@/lib/image";
import { NOTIFICATION_TONES } from "@/lib/notifications";

/*
  The browser mirrors a few of the API's rules rather than importing
  @abay/contracts, so its bundle stays independent of the API's build. A
  mirror drifts silently, so the ones whose drift a person would feel are
  held to the source here: the test reads the contracts' source files, which
  the bundle never does.

  An image limit here that is higher than the server's is an upload that is
  let through and then dropped mid-way, reported as a network failure; a
  notification type the browser does not know is one the bell cannot draw.
*/

describe("what the browser mirrors from @abay/contracts", () => {
  it("takes the images the API takes, at the sizes it takes them", () => {
    expect([...IMAGE_TYPES]).toEqual([...KYC_IMAGE_TYPES]);
    expect(IMAGE_LIMITS).toEqual({
      kyc: KYC_IMAGE_MAX_BYTES,
      chat: CHAT_IMAGE_MAX_BYTES,
      evidence: DISPUTE_EVIDENCE_MAX_BYTES,
    });
  });

  it("knows every kind of notification the API can send", () => {
    expect(Object.keys(NOTIFICATION_TONES).sort()).toEqual([...notificationType.options].sort());
  });
});
