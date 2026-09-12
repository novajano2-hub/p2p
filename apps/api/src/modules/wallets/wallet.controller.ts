import { type DepositAddressResponse } from "@abay/contracts";
import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { AddressService } from "@/modules/wallets/address.service";

/** The customer's own wallet. Their address, and nothing about anyone else's. */
@Controller("wallet")
@UseGuards(SessionGuard)
export class WalletController {
  private readonly chain: ChainConfig;

  constructor(
    private readonly addresses: AddressService,
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
}
