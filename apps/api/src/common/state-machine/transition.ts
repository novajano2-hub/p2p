import { AppError } from "@/common/errors/app-error";

/*
  A state machine is a table, and a transition not in the table does not
  exist (docs/architecture/state-machines.md). Every service that moves
  money asks this before it writes, so that the illegal pairs - crediting an
  orphaned deposit, refunding a broadcast withdrawal - fail here, by name,
  rather than somewhere down the line. AT-17 walks every pair of every table
  through this.
*/

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export class IllegalTransitionError extends AppError {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super("CONFLICT", 409, `A ${machine} cannot go from ${from} to ${to}.`);
  }
}

export function canTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}

export function assertTransition<S extends string>(
  machine: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) throw new IllegalTransitionError(machine, from, to);
}

/** The states with no way out. */
export function terminalStates<S extends string>(table: TransitionTable<S>): S[] {
  return (Object.keys(table) as S[]).filter((state) => table[state].length === 0);
}
