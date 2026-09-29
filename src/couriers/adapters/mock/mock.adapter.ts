import { Injectable, Logger } from '@nestjs/common';
import {
  ICourierAdapter,
  NormalizedShipmentResult,
  NormalizedTrackingResult,
  NormalizedCancelResult,
  TrackingEvent,
} from '../../interfaces/courier-adapter.interface';
import { CreateOrderDto } from '../../../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';

@Injectable()
export class MockCourierAdapter implements ICourierAdapter {
  readonly courierPartnerId = 'mock_courier';
  private readonly logger = new Logger(MockCourierAdapter.name);

  // In-memory tracking store for testing simulated progression
  private readonly shipments = new Map<
    string,
    {
      orderId: string;
      status: ShipmentStatus;
      events: TrackingEvent[];
    }
  >();

  async createShipment(dto: CreateOrderDto): Promise<NormalizedShipmentResult> {
    this.logger.log(`[MockCourier] Creating shipment for order: ${dto.order_id}`);

    // Deterministic AWB generation based on order_id
    const sanitizedId = dto.order_id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
    const awbNumber = `MC-${sanitizedId || '0001'}-${Math.floor(1000 + Math.random() * 9000)}`;
    const courierShipmentId = `MOCK-SHIP-${Date.now()}`;

    const initialEvent: TrackingEvent = {
      status: ShipmentStatus.CREATED,
      location: dto.shipper.city,
      timestamp: new Date().toISOString(),
      description: 'Shipment created in Mock Courier system',
    };

    this.shipments.set(awbNumber, {
      orderId: dto.order_id,
      status: ShipmentStatus.CREATED,
      events: [initialEvent],
    });

    const rawResponse = {
      mock_tracking_code: awbNumber,
      mock_shipment_id: courierShipmentId,
      accepted: true,
      service_tier: 'EXPRESS_MOCK',
    };

    return {
      orderId: dto.order_id,
      courierPartner: this.courierPartnerId,
      courierShipmentId,
      awbNumber,
      status: ShipmentStatus.CREATED,
      rawRequest: dto,
      rawResponse,
    };
  }

  async trackShipment(awbNumber: string, orderId: string): Promise<NormalizedTrackingResult> {
    this.logger.log(`[MockCourier] Tracking AWB: ${awbNumber}`);

    const existing = this.shipments.get(awbNumber);
    const now = new Date().toISOString();

    const history: TrackingEvent[] = existing?.events || [
      {
        status: ShipmentStatus.CREATED,
        location: 'Origin Facility',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        description: 'Shipment Manifested',
      },
      {
        status: ShipmentStatus.IN_TRANSIT,
        location: 'Hub Facility',
        timestamp: now,
        description: 'Package in sorting facility',
      },
    ];

    const currentStatus = existing?.status || ShipmentStatus.IN_TRANSIT;

    return {
      orderId,
      courierPartner: this.courierPartnerId,
      awbNumber,
      currentStatus,
      statusDetails: 'Package is progressing smoothly through mock network',
      location: history[history.length - 1]?.location,
      history,
      rawResponse: {
        awb: awbNumber,
        state: currentStatus,
        checkpoints: history,
      },
    };
  }

  async cancelShipment(awbNumber: string, orderId: string): Promise<NormalizedCancelResult> {
    this.logger.log(`[MockCourier] Cancelling shipment with AWB: ${awbNumber}`);

    const existing = this.shipments.get(awbNumber);
    if (existing) {
      existing.status = ShipmentStatus.CANCELLED;
      existing.events.push({
        status: ShipmentStatus.CANCELLED,
        location: 'Customer Service',
        timestamp: new Date().toISOString(),
        description: 'Shipment cancelled by sender',
      });
    }

    return {
      orderId,
      courierPartner: this.courierPartnerId,
      awbNumber,
      status: ShipmentStatus.CANCELLED,
      cancelledAt: new Date().toISOString(),
      message: `Shipment ${awbNumber} successfully cancelled with MockCourier`,
      rawResponse: {
        awb: awbNumber,
        cancelled: true,
        refundEligible: true,
      },
    };
  }
}
