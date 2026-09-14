import { type DepositAddressResponse, type WalletBalanceResponse } from "@abay/contracts";
import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { TradeService } from "@/modules/trades/trade.service";
import { AddressService } from "@/modules/wallets/address.service";

/** The customer's own wallet. Their address, and nothing about anyone else's. */
@Controller("wallet")
@UseGuards(SessionGuard)
export class WalletController {
  private readonly chain: ChainConfig;

  constructor(
    private readonly addresses: AddressService,
    private readonly ledger: LedgerService,
    private readonly trades: TradeService,
    @Inject(ENV) env: Env,
  ) {
    this.chain = chainConfig(env);
  }

  /*
    The first call may ask the custody provider for an address; every later
    one reads the row. Limited because the first call is the expensive one
    and a script could make every call look like a first one.
  */
  @Get("deposit-address")
  @RateLimit(perSession(60, minutes(5)))
  async depositAddress(
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<DepositAddressResponse> {
    const address = await this.addresses.getOrCreate(session.user.id);
    return {
      network: this.chain.network,
      standard: this.chain.token.standard,
      asset: this.chain.token.symbol,
      address: address.address,
      confirmationsRequired: this.chain.finality.confirmations,
      minimumDeposit: this.chain.deposit.dust.toString(),
    };
  }

  /*
    The three figures the wallet is made of, read from the ledger rather than
    from any cached column: the ledger is the only thing that knows, and a
    balance that agrees with it by construction cannot drift from it.

    Escrow is the sum of the per-trade escrow accounts of this customer's
    open trades as the seller (ledger-taxonomy.md 3.1): money that is still
    theirs, committed to a trade, and not spendable until it closes.
  */
  @Get("balance")
  async balance(@CurrentSession() session: AuthenticatedSession): Promise<WalletBalanceResponse> {
    const [available, pendingWithdrawal, escrowed] = await Promise.all([
      this.ledger.balance(accounts.userAvailable(session.user.id)),
      this.ledger.balance(accounts.userPendingWithdrawal(session.user.id)),
      this.trades.escrowedFor(session.user.id),
    ]);
    return {
      asset: this.chain.token.symbol,
      available: available.toString(),
      escrowed: escrowed.toString(),
      pendingWithdrawal: pendingWithdrawal.toString(),
      total: (available + escrowed + pendingWithdrawal).toString(),
    };
  }
}
