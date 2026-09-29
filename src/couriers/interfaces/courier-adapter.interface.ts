import { ShipmentStatus } from '@prisma/client';
import { CreateOrderDto } from '../../common/dto/create-order.dto';

export interface NormalizedShipmentResult {
  orderId: string;
  courierPartner: string;
  courierShipmentId: string;
  awbNumber: string;
  status: ShipmentStatus;
  rawRequest: any;
  rawResponse: any;
}

export interface TrackingEvent {
  status: ShipmentStatus;
  location?: string;
  timestamp: string;
  description: string;
}

export interface NormalizedTrackingResult {
  orderId: string;
  courierPartner: string;
  awbNumber: string;
  currentStatus: ShipmentStatus;
  statusDetails?: string;
  location?: string;
  history: TrackingEvent[];
  rawResponse: any;
}

export interface NormalizedCancelResult {
  orderId: string;
  courierPartner: string;
  awbNumber: string;
  status: ShipmentStatus;
  cancelledAt: string;
  message: string;
  rawResponse: any;
}

export interface ICourierAdapter {
  readonly courierPartnerId: string;

  createShipment(dto: CreateOrderDto): Promise<NormalizedShipmentResult>;
  trackShipment(awbNumber: string, orderId: string): Promise<NormalizedTrackingResult>;
  cancelShipment(awbNumber: string, orderId: string): Promise<NormalizedCancelResult>;
}
