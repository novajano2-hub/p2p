import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { PaymentDetailsCipher } from "@/modules/payment-methods/payment-details.cipher";
import { PaymentMethodService } from "@/modules/payment-methods/payment-method.service";
import { PaymentMethodsController } from "@/modules/payment-methods/payment-methods.controller";

/*
  Where a seller is paid. The service and the cipher are exported for offers
  (which name methods) and trades (which snapshot them); the controller is
  the owner's own view and nothing else's.
*/
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentDetailsCipher, PaymentMethodService],
  exports: [PaymentDetailsCipher, PaymentMethodService],
})
export class PaymentMethodsModule {}
