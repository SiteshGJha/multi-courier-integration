import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourierRegistry } from '../couriers/courier.registry';
import { CreateOrderDto, PaymentType } from '../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';
import {
  OrderNotFoundException,
  ShipmentCancellationException,
} from '../common/exceptions/courier.exceptions';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockPrisma: any;
  let mockRegistry: any;
  let mockAdapter: any;

  const validDto: CreateOrderDto = {
    order_id: 'ORD-TEST-100',
    courier_partner: 'mock_courier',
    shipper: {
      name: 'Acme Shipper',
      phone: '9876543210',
      email: 'acme@example.com',
      address: 'Plot 10',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001',
      country: 'India',
    },
    consignee: {
      name: 'Bob Consignee',
      phone: '9123456780',
      email: 'bob@example.com',
      address: 'Road 5',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India',
    },
    package: {
      weight_kg: 1.0,
      dimensions_cm: { length: 10, breadth: 10, height: 10 },
      item_description: 'Widget',
      declared_value: 500,
    },
    payment: {
      type: PaymentType.PREPAID,
      collectable_amount: 0,
    },
  };

  beforeEach(async () => {
    mockAdapter = {
      courierPartnerId: 'mock_courier',
      createShipment: jest.fn().mockResolvedValue({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        courierShipmentId: 'SHIP-123',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.CREATED,
        rawRequest: validDto,
        rawResponse: { ok: true },
      }),
      trackShipment: jest.fn().mockResolvedValue({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        awbNumber: 'MC-123456',
        currentStatus: ShipmentStatus.IN_TRANSIT,
        history: [
          {
            status: ShipmentStatus.CREATED,
            location: 'Delhi',
            timestamp: new Date().toISOString(),
            description: 'Created',
          },
          {
            status: ShipmentStatus.IN_TRANSIT,
            location: 'Hub',
            timestamp: new Date().toISOString(),
            description: 'In transit',
          },
        ],
        rawResponse: { scans: [] },
      }),
      cancelShipment: jest.fn().mockResolvedValue({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.CANCELLED,
        cancelledAt: new Date().toISOString(),
        message: 'Cancelled',
        rawResponse: { cancelled: true },
      }),
    };

    mockRegistry = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getSupportedCouriers: jest.fn().mockReturnValue(['mock_courier', 'urbanebolt']),
    };

    mockPrisma = {
      order: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      trackingHistory: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CourierRegistry, useValue: mockRegistry },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('createOrder', () => {
    it('should create order, call courier, save audit payloads, and return created order', async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(null);
      mockPrisma.order.create.mockResolvedValueOnce({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        courierShipmentId: 'SHIP-123',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.CREATED,
        createdAt: new Date(),
      });

      const result = await service.createOrder(validDto);

      expect(mockRegistry.getAdapter).toHaveBeenCalledWith('mock_courier');
      expect(mockAdapter.createShipment).toHaveBeenCalledWith(validDto);
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'ORD-TEST-100',
            courierPartner: 'mock_courier',
            awbNumber: 'MC-123456',
            status: ShipmentStatus.CREATED,
          }),
        }),
      );
      expect(result.order_id).toBe('ORD-TEST-100');
      expect(result.awb_number).toBe('MC-123456');
    });

    it('should be idempotent: return existing order without calling courier when order_id exists', async () => {
      const existingOrder = {
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        courierShipmentId: 'EXISTING-SHIP-1',
        awbNumber: 'MC-EXISTING-1',
        status: ShipmentStatus.CREATED,
        createdAt: new Date(),
      };
      mockPrisma.order.findUnique.mockResolvedValueOnce(existingOrder);

      const result = await service.createOrder(validDto);

      expect(mockAdapter.createShipment).not.toHaveBeenCalled();
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
      expect(result.order_id).toBe('ORD-TEST-100');
      expect(result.awb_number).toBe('MC-EXISTING-1');
    });
  });

  describe('trackOrder', () => {
    it('should query courier, append to TrackingHistory, update order status, and return tracking', async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.CREATED,
        trackingHistory: [],
      });

      mockPrisma.order.update.mockResolvedValueOnce({});
      mockPrisma.trackingHistory.create.mockResolvedValueOnce({});

      const result = await service.trackOrder('ORD-TEST-100');

      expect(mockAdapter.trackShipment).toHaveBeenCalledWith('MC-123456', 'ORD-TEST-100');
      expect(mockPrisma.trackingHistory.create).toHaveBeenCalled();
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'ORD-TEST-100' },
          data: { status: ShipmentStatus.IN_TRANSIT },
        }),
      );
      expect(result.current_status).toBe(ShipmentStatus.IN_TRANSIT);
    });

    it('should throw OrderNotFoundException when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(null);

      await expect(service.trackOrder('NONEXISTENT')).rejects.toThrow(OrderNotFoundException);
    });
  });

  describe('cancelOrder', () => {
    it('should cancel shipment with courier and update order status to CANCELLED', async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.CREATED,
      });

      mockPrisma.order.update.mockResolvedValueOnce({});
      mockPrisma.trackingHistory.create.mockResolvedValueOnce({});

      const result = await service.cancelOrder('ORD-TEST-100');

      expect(mockAdapter.cancelShipment).toHaveBeenCalledWith('MC-123456', 'ORD-TEST-100');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'ORD-TEST-100' },
          data: { status: ShipmentStatus.CANCELLED },
        }),
      );
      expect(result.status).toBe(ShipmentStatus.CANCELLED);
    });

    it('should reject cancellation if order is already DELIVERED', async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        orderId: 'ORD-TEST-100',
        courierPartner: 'mock_courier',
        awbNumber: 'MC-123456',
        status: ShipmentStatus.DELIVERED,
      });

      await expect(service.cancelOrder('ORD-TEST-100')).rejects.toThrow(
        ShipmentCancellationException,
      );
    });
  });
});
