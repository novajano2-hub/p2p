import { type AdminCustomerSummary } from "@abay/contracts";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "@/infra/prisma/prisma.service";

/*
  Who a customer is, in the four fields an administrator deciding something
  about their money actually needs: the account number they quote to support,
  the username a counterparty sees, the email we write to, and whether the
  account is in good standing.

  Its own module rather than a method on the admin service, because deposits
  and withdrawals both need it and the admin module already imports them -
  putting it there would make the graph circular. Nothing here reads a
  password hash, a document, or a balance; those have their own screens and
  their own roles.
*/

const FIELDS = {
  id: true,
  platformId: true,
  username: true,
  email: true,
  status: true,
  kycStatus: true,
} as const;

interface Row {
  id: string;
  platformId: string;
  username: string;
  email: string;
  status: string;
  kycStatus: string;
}

/** How many matches a search will return before it asks for a narrower one. */
const LIMIT = 20;

@Injectable()
export class CustomerDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string | null): Promise<AdminCustomerSummary | null> {
    if (!userId) return null;
    const row = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: FIELDS,
    });
    return row ? toSummary(row) : null;
  }

  /**
   * The same thing for a queue, in one query rather than one per row. Ids
   * that no longer resolve are simply absent from the map; a caller renders
   * that as "no customer", which is the truth.
   */
  async summaries(userIds: readonly (string | null)[]): Promise<Map<string, AdminCustomerSummary>> {
    const wanted = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.prisma.client.user.findMany({
      where: { id: { in: wanted } },
      select: FIELDS,
    });
    return new Map(rows.map((row) => [row.id, toSummary(row)]));
  }

  /**
   * Finding somebody by what a human has to hand. An account number is
   * matched whole - "BQ-12345678", or the digits alone, because that is what
   * people read off a screen - and a username or email by what they contain.
   * Never by internal id: if you have the id you are not searching.
   */
  async search(q: string): Promise<{ customers: AdminCustomerSummary[]; truncated: boolean }> {
    const term = q.trim();
    const digits = term.replace(/^bq-?/i, "");
    const rows = await this.prisma.client.user.findMany({
      where: {
        OR: [
          { platformId: { equals: term, mode: "insensitive" } },
          ...(/^\d{1,8}$/.test(digits) ? [{ platformId: { endsWith: digits } }] : []),
          { username: { contains: term, mode: "insensitive" } },
          { email: { contains: term.toLowerCase() } },
        ],
      },
      select: FIELDS,
      // Oldest first is stable and meaningless; ordering by account number is
      // at least the thing the administrator is looking at.
      orderBy: { platformId: "asc" },
      take: LIMIT + 1,
    });
    return {
      customers: rows.slice(0, LIMIT).map(toSummary),
      truncated: rows.length > LIMIT,
    };
  }
}

const toSummary = (row: Row): AdminCustomerSummary => ({
  userId: row.id,
  platformId: row.platformId,
  username: row.username,
  email: row.email,
  status: row.status as AdminCustomerSummary["status"],
  kycStatus: row.kycStatus as AdminCustomerSummary["kycStatus"],
});
