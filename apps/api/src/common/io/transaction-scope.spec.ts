import {
  assertNoOpenTransaction,
  currentTransaction,
  IoInsideTransactionError,
  withTransactionScope,
} from "./transaction-scope";

describe("transaction scope", () => {
  it("is empty outside a transaction, so ordinary I/O is untouched", () => {
    expect(currentTransaction()).toBeUndefined();
    expect(() => {
      assertNoOpenTransaction("sending email");
    }).not.toThrow();
  });

  it("refuses I/O inside a transaction, naming both", async () => {
    await withTransactionScope("ledger:post", async () => {
      expect(currentTransaction()?.name).toBe("ledger:post");
      expect(() => {
        assertNoOpenTransaction("sending email");
      }).toThrow(IoInsideTransactionError);
      expect(() => {
        assertNoOpenTransaction("sending email");
      }).toThrow(/sending email was attempted inside database transaction "ledger:post"/);
      await Promise.resolve();
    });
  });

  /*
    The point of AsyncLocalStorage: the guard has to follow the awaits, so a
    call three services deep is still "inside" the transaction that opened at
    the top, whatever promises were crossed on the way there.
  */
  it("follows the awaits down the call chain", async () => {
    const deep = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      assertNoOpenTransaction("calling a provider");
    };
    await expect(withTransactionScope("kyc:submit", deep)).rejects.toThrow(
      IoInsideTransactionError,
    );
  });

  it("closes when the transaction does", async () => {
    await withTransactionScope("ledger:post", () => Promise.resolve());
    expect(currentTransaction()).toBeUndefined();
    expect(() => {
      assertNoOpenTransaction("sending email");
    }).not.toThrow();
  });
});
