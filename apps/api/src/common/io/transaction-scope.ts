import { AsyncLocalStorage } from "node:async_hooks";

/*
  Knows whether the current async context is inside a database transaction,
  so that slow external work can refuse to happen there.

  The outage this prevents (acceptance test AT-19): a financial flow opens a
  transaction, takes a row lock on a customer's balance, and then - while
  holding it - waits on an email provider, a storage bucket, or a chain RPC.
  A provider that takes thirty seconds to answer now holds every other
  request that wanted that row for thirty seconds too, and a provider that is
  down takes the ledger down with it. Row locks are for the microseconds a
  posting needs, never for the round trip to somebody else's server.

  So the rule is a guard rather than a code-review note. Anything that opens
  a transaction enters a scope here; anything that talks to the network asks
  first, and throws if it finds itself inside one. The scope rides on
  AsyncLocalStorage, which follows the awaits - a call three services deep
  is still "inside" the transaction that started at the top.
*/

interface OpenTransaction {
  /** What opened it, for the error message: "ledger:post", "kyc:submit". */
  name: string;
  openedAt: number;
}

const openTransaction = new AsyncLocalStorage<OpenTransaction>();

/** Runs `work` with the current context marked as inside a transaction named `name`. */
export function withTransactionScope<T>(name: string, work: () => Promise<T>): Promise<T> {
  return openTransaction.run({ name, openedAt: Date.now() }, work);
}

/** The transaction the current context is inside, or undefined. For tests and diagnostics. */
export function currentTransaction(): OpenTransaction | undefined {
  return openTransaction.getStore();
}

export class IoInsideTransactionError extends Error {
  constructor(
    readonly operation: string,
    readonly transaction: string,
  ) {
    super(
      `${operation} was attempted inside database transaction "${transaction}". ` +
        "External I/O must never run while row locks are held; move it before the transaction opens or after it commits.",
    );
    this.name = "IoInsideTransactionError";
  }
}

/**
 * Called at the top of every method that leaves the process: an HTTP call, a
 * bucket write, a queue publish. Throws if a transaction is open in this
 * context. The throw is the point: the alternative is a lock held across a
 * network round trip, which is worse than a failed request.
 */
export function assertNoOpenTransaction(operation: string): void {
  const open = openTransaction.getStore();
  if (open) throw new IoInsideTransactionError(operation, open.name);
}
