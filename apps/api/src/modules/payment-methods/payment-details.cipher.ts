import { type PaymentInstructions, type PaymentMethodKind } from "@abay/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

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

/**
 * What is on disk: the two lines a buyer needs. Whatever else an older
 * document carried - a bank code, a bank name, a branch - is read past.
 */
const storedDocument = z.object({ accountHolder: z.string(), accountNumber: z.string() });

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
   * The instructions back, validated: a document missing either line is
   * refused loudly here rather than shown to a buyer half-formed. The kind
   * is the row's, not the document's: a document written before the banks
   * became kinds of their own still says "BANK_TRANSFER" inside, and the
   * column beside it is what the migration corrected.
   */
  decrypt(stored: string, purpose: string, kind: PaymentMethodKind): PaymentInstructions {
    const document = storedDocument.parse(JSON.parse(decryptField(stored, this.key, purpose)));
    return { kind, accountHolder: document.accountHolder, accountNumber: document.accountNumber };
  }
}
