import { Injectable, Logger } from '@nestjs/common';
import { ICourierAdapter } from './interfaces/courier-adapter.interface';
import { UnknownCourierException } from '../common/exceptions/courier.exceptions';

@Injectable()
export class CourierRegistry {
  private readonly logger = new Logger(CourierRegistry.name);
  private readonly adapters = new Map<string, ICourierAdapter>();

  register(adapter: ICourierAdapter): void {
    const key = adapter.courierPartnerId.toLowerCase();
    this.adapters.set(key, adapter);
    this.logger.log(`Registered courier adapter: '${adapter.courierPartnerId}'`);
  }

  getAdapter(courierPartner: string): ICourierAdapter {
    if (!courierPartner) {
      throw new UnknownCourierException('undefined', this.getSupportedCouriers());
    }

    const key = courierPartner.toLowerCase();
    const adapter = this.adapters.get(key);

    if (!adapter) {
      throw new UnknownCourierException(courierPartner, this.getSupportedCouriers());
    }

    return adapter;
  }

  getSupportedCouriers(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }
}
