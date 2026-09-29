import { Module } from '@nestjs/common';
import { CourierRegistry } from './courier.registry';

@Module({
  providers: [CourierRegistry],
  exports: [CourierRegistry],
})
export class CouriersModule {}
