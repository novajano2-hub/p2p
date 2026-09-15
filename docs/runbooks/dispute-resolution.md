# Runbook — resolving a dispute

For whoever holds `DISPUTE_RESOLVER` and is about to decide where somebody's money goes.

Written with the screen it describes (Phase 4, stage 6). If the screen and this document
disagree, the screen is what runs and this document is wrong — say so and fix it.

## When this applies

A trade reaches you only if all of these happened: the buyer pressed **I have paid**, ten
minutes passed, and one of the two parties opened a dispute. Until a dispute exists there
is nothing for you to decide and no way for you to see the trade.

While the dispute is open the USDT sits in that trade's own escrow account. Nobody's
balance holds it. It moves the moment you decide, and not before.

## What you are deciding, and what you are not

One question: **did the birr reach the seller's account?**

- Yes → release the USDT to the buyer.
- No → return the USDT to the seller.

You are not deciding who behaved better, whether either of them was rude in the chat, or
whether the price was fair. You are not setting a balance, moving a fee, or splitting the
difference — none of those exist, deliberately (ADR-0009: there is no admin "set balance"
function). Two outcomes, and one of them is always somebody's loss.

## Who may do it

`DISPUTE_RESOLVER`, and it is granted per person by somebody with database access:

```bash
npm run admin -w @abay/database -- roles someone@example.com DISPUTE_RESOLVER
```

It is deliberately not the same capability as approving a withdrawal or posting a
correction (threat model B7.1). A resolver cannot be a party to a trade: administrators
are a separate realm with no customer account, so there is no way to be both.

If you hold a customer account on this platform in your own name, you still cannot be a
party to a dispute you decide — but say so to whoever issued your role anyway, and let
them decide whether that is a conflict worth avoiding.

## Before you open one

Opening a dispute writes `dispute.viewed` against your name, the dispute and the request
id, because the page decrypts the seller's payment details. That record exists whether or
not you decide anything. Do not browse the queue to see what is in it; open the one you
are going to work.

## The queue — `/admin/disputes`

Two lists. **Waiting for a decision** is oldest first: the party at the top has been
without their money longest. **Recently decided** is the last twenty, and it is there so
you can see how cases like the one in front of you went before you add another.

Each row is the amount, the birr, what is claimed, who claimed it, both parties and how
many files are attached.

## Reading one dispute

The page holds everything; you should not need another tab.

1. **The claim**, in the words of whoever opened it, and which side that was.
2. **The trade**: the amount, the birr, the price, when it opened, when the buyer said
   they paid, and the deadline they had.
3. **Where the buyer was told to pay** — the seller's own account details as they were
   snapshotted onto the trade. This is the number the birr should have reached. It cannot
   have changed since: editing a payment method never touches a trade already running.
4. **Both parties' records**: how many trades each has finished and how many failed. A
   pattern is evidence. One failed trade is not.
5. **Evidence** from each side, with whatever they wrote about it.
6. **The chat**, the whole of it, with the sides named.
7. **What the trade did**, with times.

## Weighing evidence

Nothing scans these files and nothing verifies them (threat model B5.1, B8.5). A
screenshot is a claim, not a fact — a receipt is trivially edited, and the account name in
one is easy to miss.

Read them against the things that are hard to forge:

- Does the receipt name **the account on this trade**, digit for digit?
- Does the amount match the trade's birr exactly?
- Is the timestamp inside the payment window, or at least before the dispute?
- Does the reference in the receipt appear anywhere the seller can check?
- Does the chat support the story either side is telling now?
- Has either party a record of trades that end this way?

If a file will not open, the page says so. That is not evidence of anything; ask for it
again through the chat if the dispute is still open, or decide without it.

**Third-party payments.** If the birr came from an account in a different name, that is a
laundering control failing, not a payment (threat model B8.4). The seller is entitled to
refuse it, and the buyer is owed an explanation rather than the USDT.

## Deciding

Choose the outcome, then write what you decided and why, in words the two people will
read. The note is mandatory, it is sent to both of them exactly as you type it, and it is
kept against your name permanently. Write the reason, not the conclusion: "the receipt
names 0911223344, which is the number on this trade, for 3,170 birr at 07:41" beats "buyer
wins".

The button asks once more, naming the person who will be paid and the amount. There is no
undo — not on this screen and not anywhere else.

## What happens when you press it

- The escrow settles through the same code path a normal release or refund uses. The
  ledger cannot tell that a person was involved; only the reason code and the actor
  differ (JE-6 for a release, the refund shape for a return).
- The trade closes as `COMPLETED` or `REFUNDED`.
- Both parties are notified, with your note.
- An audit event records you, the request id, the state before and after, and the ids of
  the evidence that was on the dispute when you decided.
- A refund puts the unsold amount back on the seller's offer and counts against the
  buyer's record; a release counts as a completed trade for both.

## Cases that are not yours to decide

- **The seller releases while you are looking.** The dispute closes itself as decided for
  the buyer with no administrator named. Your resolve will be refused with a conflict.
  That is the right outcome: most appeals end with the seller finally seeing the money.
- **The party who opened it withdraws it.** The trade goes back to waiting for the seller
  to release, and it leaves your queue.
- **The trade already settled.** A second decision is refused and moves nothing.

## What to do when you cannot tell

There is no rule that makes an unclear case clear, and there is no third button. What
there is:

- Ask for more, if the dispute is still open — either party can attach up to five files.
- Look at both parties' histories rather than at this trade alone.
- Escalate to whoever issued your role. A decision made under pressure of a queue is the
  one an insider-abuse review will read first (threat model B7.1).

**Nothing in the system counts how one resolver decides.** Pattern detection is named in
the threat model as the control against a resolver deciding for an accomplice, and it is
not built. Until it is, that safeguard is people reading each other's notes.

## Not covered here, and owed

- **A response-time target.** The owner has not set one (CLAUDE.md lists
  dispute-service targets among the figures still to be provided). Do not invent one in a
  reply to a customer.
- **Dual control on large amounts.** Withdrawals require a second approver above a
  threshold; dispute resolution does not, at any size. Worth deciding before real money.
- **A way to talk to the parties.** A resolver cannot write in the trade's chat. The note
  on the decision is the only thing either of them hears from you.
