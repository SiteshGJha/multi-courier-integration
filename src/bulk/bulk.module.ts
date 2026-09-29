import { Module } from '@nestjs/common';
import { BulkOrdersController } from './bulk-orders.controller';
import { BulkOrdersService } from './bulk-orders.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [BulkOrdersController],
  providers: [BulkOrdersService],
  exports: [BulkOrdersService],
})
export class BulkModule {}
