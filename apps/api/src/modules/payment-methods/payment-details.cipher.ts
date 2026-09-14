import { paymentInstructions, type PaymentInstructions } from "@abay/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { decryptField, encryptField, fieldEncryptionKey } from "@/common/security/field-encryption";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

/*
  Payment instructions at rest.

  The brief asks for exactly this - "encrypt sensitive payment information at
  field or storage level" - and data-classification.md rates these details
  RESTRICTED, above a customer's email. The whole document is one AES-256-GCM
  value under FIELD_ENCRYPTION_KEY (common/security/field-encryption.ts), so a
  copy of the database yields no account numbers.

  Two purposes, deliberately distinct: a method as its owner keeps it, and
  the snapshot a trade takes of it when it opens. A ciphertext lifted from one
  column cannot be replayed into the other and quietly decrypt there.
*/

export const PAYMENT_METHOD_PURPOSE = "payment-method";
export const TRADE_SNAPSHOT_PURPOSE = "trade-payment-snapshot";

@Injectable()
export class PaymentDetailsCipher {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = fieldEncryptionKey(env.FIELD_ENCRYPTION_KEY);
  }

  encrypt(instructions: PaymentInstructions, purpose: string): string {
    return encryptField(JSON.stringify(instructions), this.key, purpose);
  }

  /**
   * The instructions back, validated: a row written by an older shape of the
   * code is refused loudly here rather than shown to a buyer half-formed.
   */
  decrypt(stored: string, purpose: string): PaymentInstructions {
    return paymentInstructions.parse(JSON.parse(decryptField(stored, this.key, purpose)));
  }
}
