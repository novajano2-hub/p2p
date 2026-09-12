import { PrismaClient } from "@prisma/client";

export { $Enums, Prisma, PrismaClient } from "@prisma/client";

// Row types, so services can be typed without importing @prisma/client directly.
export type {
  AdminRole,
  AdminSession,
  AdminStatus,
  AdminUser,
  AuditEvent,
  AuthIdentity,
  AuthProvider,
  KycDocument,
  KycDocumentKind,
  KycDocumentType,
  KycStatus,
  KycSubmission,
  KycSubmissionStatus,
  LedgerAccount,
  LedgerAccountBalance,
  LedgerAccountScope,
  LedgerAccountType,
  LedgerActorType,
  LedgerAsset,
  LedgerDirection,
  LedgerEntry,
  LedgerReason,
  LedgerTransaction,
  Notification,
  NotificationType,
  Session,
  SessionEndReason,
  User,
  UserStatus,
  VerificationPurpose,
  VerificationToken,
  AddressStatus,
  AttributionAddress,
  ChainNetwork,
  Deposit,
  DepositStatus,
  IdempotencyKey,
  MockChainHead,
  MockChainTransfer,
  MockCustodyDirective,
  MockTransferOutcome,
  OutboxEvent,
  OutboxStatus,
  Sweep,
  SweepStatus,
  Withdrawal,
  WithdrawalApproval,
  WithdrawalStatus,
  ChainObserverCursor,
} from "@prisma/client";

export type PrismaLogLevel = "query" | "info" | "warn" | "error";

/**
 * The one place a PrismaClient is constructed. The URL is passed in rather
 * than read from the environment here, so the API's validated config is the
 * only source of it and tests can point a client at a scratch database.
 */
export function createPrismaClient(
  datasourceUrl: string,
  log: PrismaLogLevel[] = ["warn", "error"],
) {
  return new PrismaClient({ datasourceUrl, log });
}
