import {
  adminRole,
  disputeOutcome,
  disputeReason,
  disputeStatus,
  ledgerAccountScope,
  ledgerAccountType,
  ledgerActorType,
  ledgerAsset,
  ledgerDirection,
  ledgerReason,
  offerSide,
  offerStatus,
  paymentMethodKind,
  paymentMethodStatus,
  tradeEventKind,
  tradeMessageKind,
  tradeStatus,
} from "@abay/contracts";
import { $Enums } from "@abay/database";

/*
  @abay/contracts writes every enumeration by hand, because it must never
  import the database layer. This is the price of that rule, paid once: if
  a value is added to the schema and not to the contract, or the other way
  round, this fails before a client ever sees a value it cannot parse.
*/
const mirrors: [string, readonly string[], Record<string, string>][] = [
  ["adminRole", adminRole.options, $Enums.AdminRole],
  ["ledgerAsset", ledgerAsset.options, $Enums.LedgerAsset],
  ["ledgerAccountType", ledgerAccountType.options, $Enums.LedgerAccountType],
  ["ledgerAccountScope", ledgerAccountScope.options, $Enums.LedgerAccountScope],
  ["ledgerDirection", ledgerDirection.options, $Enums.LedgerDirection],
  ["ledgerActorType", ledgerActorType.options, $Enums.LedgerActorType],
  ["ledgerReason", ledgerReason.options, $Enums.LedgerReason],
  ["paymentMethodKind", paymentMethodKind.options, $Enums.PaymentMethodKind],
  ["paymentMethodStatus", paymentMethodStatus.options, $Enums.PaymentMethodStatus],
  ["offerSide", offerSide.options, $Enums.OfferSide],
  ["offerStatus", offerStatus.options, $Enums.OfferStatus],
  ["tradeStatus", tradeStatus.options, $Enums.TradeStatus],
  ["tradeEventKind", tradeEventKind.options, $Enums.TradeEventKind],
  ["tradeMessageKind", tradeMessageKind.options, $Enums.TradeMessageKind],
  ["disputeStatus", disputeStatus.options, $Enums.DisputeStatus],
  ["disputeReason", disputeReason.options, $Enums.DisputeReason],
  ["disputeOutcome", disputeOutcome.options, $Enums.DisputeOutcome],
];

describe("contract enumerations mirror the schema's", () => {
  it.each(mirrors)("%s", (_name, contract, schema) => {
    expect([...contract].sort()).toEqual(Object.values(schema).sort());
  });
});
