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

  The scope also carries the work that must wait for the commit: a socket
  frame saying a row now exists must not go out while the row could still
  roll back, and must not go out from inside the transaction either. Such
  work registers itself with afterCommit() and runs, in order, once the
  transaction has returned - outside the scope, with no lock held.
*/

export type AfterCommitHook = () => Promise<void> | void;

interface OpenTransaction {
  /** What opened it, for the error message: "ledger:post", "kyc:submit". */
  name: string;
  openedAt: number;
  /** Runs after the commit, in the order registered. */
  afterCommit: AfterCommitHook[];
}

const openTransaction = new AsyncLocalStorage<OpenTransaction>();

/**
 * Runs `work` with the current context marked as inside a transaction named
 * `name`, then runs whatever the work registered with afterCommit(). A hook
 * that throws is reported to `onHookError` and does not fail the result: the
 * transaction is already durable, and what a hook does is best effort by
 * nature - a frame, a cache, a metric.
 */
export async function withTransactionScope<T>(
  name: string,
  work: () => Promise<T>,
  onHookError: (error: unknown) => void = () => undefined,
): Promise<T> {
  const scope: OpenTransaction = { name, openedAt: Date.now(), afterCommit: [] };
  const result = await openTransaction.run(scope, work);
  for (const hook of scope.afterCommit) {
    try {
      await hook();
    } catch (error) {
      onHookError(error);
    }
  }
  return result;
}

/** The transaction the current context is inside, or undefined. For tests and diagnostics. */
export function currentTransaction(): OpenTransaction | undefined {
  return openTransaction.getStore();
}

/**
 * Runs `hook` once the transaction the current context is inside has
 * committed - or right away, when there is none. For the things that must
 * not happen inside a transaction (AT-19) and must not happen unless it
 * commits either. Inside a transaction the returned promise resolves at
 * once; outside, it is the hook's own.
 */
export function afterCommit(hook: AfterCommitHook): Promise<void> {
  const open = openTransaction.getStore();
  if (open) {
    open.afterCommit.push(hook);
    return Promise.resolve();
  }
  return Promise.resolve().then(hook);
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
