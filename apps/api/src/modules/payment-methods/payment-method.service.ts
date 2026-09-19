import {
  PAYMENT_METHOD_KINDS,
  type CreatePaymentMethodRequest,
  type PaymentInstructions,
  type PaymentMethodDetailView,
  type PaymentMethodKind,
  type PaymentMethodView,
  type ReplacePaymentMethodRequest,
} from "@abay/contracts";
import { Prisma, type PaymentMethod } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import {
  PAYMENT_METHOD_PURPOSE,
  PaymentDetailsCipher,
} from "@/modules/payment-methods/payment-details.cipher";

/*
  A customer's ways of receiving birr.

  Four rules shape this service. The details are written once and never
  edited - a changed number is a new method, so a trade that snapshotted the
  old one still says where its buyer was told to pay. A method is archived,
  never deleted, for the same reason. There is one live method of each kind:
  an order names the kind - "Telebirr" - and its buyer is shown the account
  behind it, so that account has to be the only one; a changed number is a
  replacement, which hands the old method's place on live ads to the new one.
  And ownership is part of every lookup: somebody else's id and an id that
  never existed answer the same 404.
*/

/** Digits of the number a list shows, enough to tell two apart, too few to use. */
const HINT_DIGITS = 4;

/** A Prisma client or an open transaction. Trades pass theirs. */
type Reader = Pick<Prisma.TransactionClient, "paymentMethod">;

@Injectable()
export class PaymentMethodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PaymentDetailsCipher,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentMethodService.name);
  }

  /** The owner's live methods, newest first. Labels and hints only. */
  async list(userId: string): Promise<PaymentMethodView[]> {
    const rows = await this.prisma.client.paymentMethod.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toView);
  }

  /** One of the owner's methods, whole - archived ones included, so history can be read. */
  async get(userId: string, id: string): Promise<PaymentMethodDetailView> {
    const row = await this.prisma.client.paymentMethod.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound("There is no such payment method.");
    return {
      ...toView(row),
      instructions: this.cipher.decrypt(row.detailsEncrypted, PAYMENT_METHOD_PURPOSE, row.kind),
    };
  }

  async create(
    userId: string,
    input: CreatePaymentMethodRequest,
  ): Promise<PaymentMethodDetailView> {
    const instructions = toInstructions(input);
    const taken = await this.prisma.client.paymentMethod.findFirst({
      where: { userId, kind: instructions.kind, status: "ACTIVE" },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(alreadyHave(instructions.kind));

    let row: PaymentMethod;
    try {
      row = await this.prisma.client.paymentMethod.create({
        data: this.rowFor(userId, instructions),
      });
    } catch (error) {
      // Two requests at once: the database's own rule - one live method of a kind - decides.
      if (isOneOfAKind(error)) throw AppError.conflict(alreadyHave(instructions.kind));
      throw error;
    }

    // The kind, and that one arrived. Never the number, never the name.
    this.logger.info(
      { event: "payment_method.added", userId, kind: row.kind },
      "payment method added",
    );
    return { ...toView(row), instructions };
  }

  /*
    Replacing: the same kind, new details. One transaction archives the old
    method, adds the new one and hands it the old one's place on every live
    ad - a taker reads the kind, never which account is behind it, so no ad
    changes version. Closed ads go on pointing at the old method, as history,
    and a trade already open keeps its own snapshot.
  */
  async replace(
    userId: string,
    id: string,
    input: ReplacePaymentMethodRequest,
  ): Promise<PaymentMethodDetailView> {
    const instructions = toInstructions(input);
    const row = await this.prisma.client.$transaction(async (tx) => {
      // Locked, so two replacements of the same method take turns.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment_methods WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
      if (!locked[0]) throw AppError.notFound("There is no such payment method.");
      const old = await tx.paymentMethod.findUniqueOrThrow({ where: { id } });
      if (old.status !== "ACTIVE") {
        throw AppError.conflict("That payment method was removed. Add a new one instead.");
      }
      if (old.kind !== instructions.kind) {
        const institution = PAYMENT_METHOD_KINDS[old.kind].label;
        throw AppError.validation([
          { path: "kind", message: `Replace it with another ${institution} account.` },
        ]);
      }

      // The old one first: the database allows one live method of a kind.
      await tx.paymentMethod.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      const created = await tx.paymentMethod.create({ data: this.rowFor(userId, instructions) });
      await tx.offerPaymentMethod.updateMany({
        where: { paymentMethodId: id, offer: { status: { in: ["ACTIVE", "PAUSED"] } } },
        data: { paymentMethodId: created.id },
      });
      return created;
    });

    this.logger.info(
      { event: "payment_method.replaced", userId, kind: row.kind },
      "payment method replaced",
    );
    return { ...toView(row), instructions };
  }

  /*
    Archiving. Refused while an offer still names the method: taking a rail
    away from a live advertisement silently would leave a buyer with nowhere
    to pay. Open trades are unaffected either way, because they carry their
    own snapshot.
  */
  async archive(userId: string, id: string): Promise<void> {
    const row = await this.prisma.client.paymentMethod.findFirst({
      where: { id, userId },
      include: {
        offers: {
          where: { offer: { status: { in: ["ACTIVE", "PAUSED"] } } },
          select: { offerId: true },
        },
      },
    });
    if (!row) throw AppError.notFound("There is no such payment method.");
    if (row.status === "ARCHIVED") return;
    if (row.offers.length > 0) {
      throw AppError.conflict(
        "This payment method is on one of your offers. Remove it there first.",
      );
    }
    await this.prisma.client.paymentMethod.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    this.logger.info(
      { event: "payment_method.archived", userId, kind: row.kind },
      "payment method archived",
    );
  }

  /**
   * The owner's live methods among a set of ids, for an offer naming them.
   * Anything not theirs or not live is simply absent from the answer.
   */
  async ownedActive(
    userId: string,
    ids: readonly string[],
    reader: Reader = this.prisma.client,
  ): Promise<PaymentMethod[]> {
    if (ids.length === 0) return [];
    return reader.paymentMethod.findMany({
      where: { id: { in: [...new Set(ids)] }, userId, status: "ACTIVE" },
    });
  }

  /**
   * The instructions behind a method, for the trade that is about to snapshot
   * them. Inside the caller's transaction, because the snapshot and the
   * trade commit together.
   */
  async instructions(
    reader: Reader,
    id: string,
  ): Promise<{ method: PaymentMethod; instructions: PaymentInstructions } | null> {
    const method = await reader.paymentMethod.findUnique({ where: { id } });
    if (!method) return null;
    return {
      method,
      instructions: this.cipher.decrypt(
        method.detailsEncrypted,
        PAYMENT_METHOD_PURPOSE,
        method.kind,
      ),
    };
  }

  /** The row a set of instructions becomes: the label and hint in the clear, the rest sealed. */
  private rowFor(userId: string, instructions: PaymentInstructions) {
    const hint = instructions.accountNumber.slice(-HINT_DIGITS);
    return {
      userId,
      kind: instructions.kind,
      label: `${PAYMENT_METHOD_KINDS[instructions.kind].label} ····${hint}`,
      hint,
      detailsEncrypted: this.cipher.encrypt(instructions, PAYMENT_METHOD_PURPOSE),
    };
  }
}

/* --------------------------------------------------------------- plumbing */

const alreadyHave = (kind: PaymentMethodKind): string =>
  `You already have a ${PAYMENT_METHOD_KINDS[kind].label} account here. Replace it, or remove it first.`;

/** The partial unique index speaking: a live method of this kind is already there. */
const isOneOfAKind = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

function toInstructions(input: CreatePaymentMethodRequest): PaymentInstructions {
  return {
    kind: input.kind,
    accountHolder: input.accountHolder,
    accountNumber: "accountNumber" in input ? input.accountNumber : input.phone,
  };
}

export function toView(row: PaymentMethod): PaymentMethodView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    hint: row.hint,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
