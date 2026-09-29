import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourierRegistry } from '../couriers/courier.registry';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';
import {
  OrderNotFoundException,
  ShipmentCancellationException,
} from '../common/exceptions/courier.exceptions';

export interface OrderResponseData {
  order_id: string;
  courier_partner: string;
  courier_order_id?: string | null;
  awb_number: string;
  status: ShipmentStatus;
  created_at: Date;
}

export interface TrackingResponseData {
  order_id: string;
  courier_partner: string;
  awb_number: string;
  current_status: ShipmentStatus;
  history: any[];
}

export interface CancelResponseData {
  order_id: string;
  courier_partner: string;
  awb_number: string;
  status: ShipmentStatus;
  cancelled_at: string;
  message: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly courierRegistry: CourierRegistry,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderResponseData> {
    this.logger.log(`Processing order creation for order_id: ${dto.order_id}`);

    // 1. Idempotency Check: if order_id already exists, return existing order
    const existingOrder = await this.prisma.order.findUnique({
      where: { orderId: dto.order_id },
    });

    if (existingOrder) {
      this.logger.warn(
        `[Idempotency] Order with order_id '${dto.order_id}' already exists. Returning existing shipment.`,
      );
      return {
        order_id: existingOrder.orderId,
        courier_partner: existingOrder.courierPartner,
        courier_order_id: existingOrder.courierShipmentId,
        awb_number: existingOrder.awbNumber || 'PENDING',
        status: existingOrder.status,
        created_at: existingOrder.createdAt,
      };
    }

    // 2. Resolve adapter for the requested courier partner
    const adapter = this.courierRegistry.getAdapter(dto.courier_partner);

    // 3. Dispatch shipment creation to courier adapter
    const shipmentResult = await adapter.createShipment(dto);

    // 4. Persist Order with audit payloads
    const createdOrder = await this.prisma.order.create({
      data: {
        orderId: dto.order_id,
        courierPartner: dto.courier_partner.toLowerCase(),
        courierShipmentId: shipmentResult.courierShipmentId,
        awbNumber: shipmentResult.awbNumber,
        status: shipmentResult.status,
        clientPayload: dto as any,
        courierRawRequest: shipmentResult.rawRequest,
        courierRawResponse: shipmentResult.rawResponse,
      },
    });

    // 5. Append initial event to TrackingHistory
    await this.prisma.trackingHistory.create({
      data: {
        orderId: dto.order_id,
        awbNumber: shipmentResult.awbNumber,
        status: shipmentResult.status,
        statusDetails: 'Shipment created and manifested',
        location: dto.shipper.city,
        rawPayload: shipmentResult.rawResponse,
      },
    });

    return {
      order_id: createdOrder.orderId,
      courier_partner: createdOrder.courierPartner,
      courier_order_id: createdOrder.courierShipmentId,
      awb_number: createdOrder.awbNumber!,
      status: createdOrder.status,
      created_at: createdOrder.createdAt,
    };
  }

  async trackOrder(orderId: string): Promise<TrackingResponseData> {
    this.logger.log(`Tracking request for order_id: ${orderId}`);

    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: { trackingHistory: { orderBy: { recordedAt: 'asc' } } },
    });

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    const adapter = this.courierRegistry.getAdapter(order.courierPartner);
    const trackingResult = await adapter.trackShipment(order.awbNumber!, order.orderId);

    // Append new tracking status to append-only TrackingHistory table
    await this.prisma.trackingHistory.create({
      data: {
        orderId: order.orderId,
        awbNumber: order.awbNumber!,
        status: trackingResult.currentStatus,
        statusDetails: trackingResult.statusDetails,
        location: trackingResult.location,
        rawPayload: trackingResult.rawResponse,
      },
    });

    // Update current status on the order
    await this.prisma.order.update({
      where: { orderId },
      data: { status: trackingResult.currentStatus },
    });

    return {
      order_id: order.orderId,
      courier_partner: order.courierPartner,
      awb_number: order.awbNumber!,
      current_status: trackingResult.currentStatus,
      history: trackingResult.history,
    };
  }

  async cancelOrder(orderId: string): Promise<CancelResponseData> {
    this.logger.log(`Cancelling order_id: ${orderId}`);

    const order = await this.prisma.order.findUnique({
      where: { orderId },
    });

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    if (order.status === ShipmentStatus.DELIVERED) {
      throw new ShipmentCancellationException(
        orderId,
        `Cannot cancel order '${orderId}' because shipment is already DELIVERED.`,
      );
    }

    if (order.status === ShipmentStatus.CANCELLED) {
      return {
        order_id: order.orderId,
        courier_partner: order.courierPartner,
        awb_number: order.awbNumber!,
        status: ShipmentStatus.CANCELLED,
        cancelled_at: order.updatedAt.toISOString(),
        message: 'Order was already cancelled previously.',
      };
    }

    const adapter = this.courierRegistry.getAdapter(order.courierPartner);
    const cancelResult = await adapter.cancelShipment(order.awbNumber!, order.orderId);

    // Update order status in DB
    await this.prisma.order.update({
      where: { orderId },
      data: { status: ShipmentStatus.CANCELLED },
    });

    // Append cancellation to TrackingHistory
    await this.prisma.trackingHistory.create({
      data: {
        orderId: order.orderId,
        awbNumber: order.awbNumber!,
        status: ShipmentStatus.CANCELLED,
        statusDetails: cancelResult.message,
        rawPayload: cancelResult.rawResponse,
      },
    });

    return {
      order_id: order.orderId,
      courier_partner: order.courierPartner,
      awb_number: order.awbNumber!,
      status: ShipmentStatus.CANCELLED,
      cancelled_at: cancelResult.cancelledAt,
      message: cancelResult.message,
    };
  }
}
