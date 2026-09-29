import { Test, TestingModule } from '@nestjs/testing';
import { BulkOrdersService } from './bulk-orders.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BulkCreateOrderDto } from '../common/dto/bulk-order.dto';
import { PaymentType } from '../common/dto/create-order.dto';
import { BatchStatus, ShipmentStatus } from '@prisma/client';

describe('BulkOrdersService', () => {
  let service: BulkOrdersService;
  let mockOrdersService: any;
  let mockPrisma: any;

  const sampleBulkDto: BulkCreateOrderDto = {
    orders: [
      {
        order_id: 'BULK-1',
        courier_partner: 'mock_courier',
        shipper: {
          name: 'Shipper 1',
          phone: '9876543210',
          email: 's1@example.com',
          address: 'Addr 1',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
        },
        consignee: {
          name: 'Consignee 1',
          phone: '9123456780',
          email: 'c1@example.com',
          address: 'Addr 1',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          country: 'India',
        },
        package: {
          weight_kg: 0.5,
          dimensions_cm: { length: 10, breadth: 10, height: 10 },
          item_description: 'Item 1',
          declared_value: 100,
        },
        payment: { type: PaymentType.PREPAID, collectable_amount: 0 },
      },
      {
        order_id: 'BULK-2',
        courier_partner: 'urbanebolt',
        shipper: {
          name: 'Shipper 2',
          phone: '9876543210',
          email: 's2@example.com',
          address: 'Addr 2',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
        },
        consignee: {
          name: 'Consignee 2',
          phone: '9123456780',
          email: 'c2@example.com',
          address: 'Addr 2',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          country: 'India',
        },
        package: {
          weight_kg: 0.8,
          dimensions_cm: { length: 12, breadth: 10, height: 8 },
          item_description: 'Item 2',
          declared_value: 200,
        },
        payment: { type: PaymentType.PREPAID, collectable_amount: 0 },
      },
    ],
  };

  beforeEach(async () => {
    mockOrdersService = {
      createOrder: jest.fn(),
    };

    mockPrisma = {
      bulkBatch: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      bulkBatchItem: {
        createMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkOrdersService,
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'bulk.concurrencyLimit') return 5;
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BulkOrdersService>(BulkOrdersService);
  });

  it('should submit bulk orders and return 202 payload with batch_id immediately', async () => {
    mockPrisma.bulkBatch.create.mockResolvedValueOnce({
      id: 'batch-uuid-1',
      totalOrders: 2,
      status: BatchStatus.PROCESSING,
      createdAt: new Date(),
    });
    mockPrisma.bulkBatchItem.createMany.mockResolvedValueOnce({ count: 2 });

    const result = await service.submitBulkOrders(sampleBulkDto);

    expect(result.batch_id).toBe('batch-uuid-1');
    expect(result.status).toBe('PROCESSING');
    expect(result.total_orders).toBe(2);
    expect(result.poll_url).toBe('/api/v1/orders/bulk/batch-uuid-1');
  });

  it('should process batch items concurrently with partial success handling', async () => {
    mockOrdersService.createOrder
      .mockResolvedValueOnce({
        order_id: 'BULK-1',
        courier_partner: 'mock_courier',
        awb_number: 'MC-111111',
        status: ShipmentStatus.CREATED,
        created_at: new Date(),
      })
      .mockRejectedValueOnce(new Error('Courier API rate limit exceeded'));

    await service.processBatchInBackground('batch-uuid-1', sampleBulkDto.orders);

    expect(mockOrdersService.createOrder).toHaveBeenCalledTimes(2);

    expect(mockPrisma.bulkBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-uuid-1' },
        data: expect.objectContaining({
          succeededCount: 1,
          failedCount: 1,
          status: BatchStatus.COMPLETED,
        }),
      }),
    );
  });

  it('should fetch batch status and detailed results', async () => {
    mockPrisma.bulkBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-uuid-1',
      totalOrders: 2,
      succeededCount: 1,
      failedCount: 1,
      status: BatchStatus.COMPLETED,
      createdAt: new Date(),
      completedAt: new Date(),
      items: [
        {
          orderId: 'BULK-1',
          courierPartner: 'mock_courier',
          status: 'SUCCESS',
          awbNumber: 'MC-111111',
          errorReason: null,
        },
        {
          orderId: 'BULK-2',
          courierPartner: 'urbanebolt',
          status: 'FAILED',
          awbNumber: null,
          errorReason: 'Courier API rate limit exceeded',
        },
      ],
    });

    const status = await service.getBatchStatus('batch-uuid-1');

    expect(status.batch_id).toBe('batch-uuid-1');
    expect(status.status).toBe(BatchStatus.COMPLETED);
    expect(status.succeeded_count).toBe(1);
    expect(status.failed_count).toBe(1);
    expect(status.results.length).toBe(2);
  });
});
