import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockPrismaService } from './mock-prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Bulk Orders API (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrismaService;

  beforeAll(async () => {
    mockPrisma = new MockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const generateBulkOrder = (id: string, courier: string) => ({
    order_id: id,
    courier_partner: courier,
    shipper: {
      name: 'Bulk Shipper',
      phone: '9876543210',
      email: 'bulk@shipper.com',
      address: 'Hub 1',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001',
      country: 'India',
    },
    consignee: {
      name: 'Bulk Consignee',
      phone: '9123456780',
      email: 'bulk@consignee.com',
      address: 'Hub 2',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India',
    },
    package: {
      weight_kg: 0.5,
      dimensions_cm: { length: 10, breadth: 10, height: 10 },
      item_description: 'Bulk Item',
      declared_value: 300,
    },
    payment: {
      type: 'PREPAID',
      collectable_amount: 0,
    },
  });

  describe('POST /api/v1/orders/bulk', () => {
    it('should ingest bulk batch and return 202 Accepted with batch_id', async () => {
      const payload = {
        orders: [
          generateBulkOrder('E2E-BULK-1', 'mock_courier'),
          generateBulkOrder('E2E-BULK-2', 'mock_courier'),
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/bulk')
        .send(payload)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.batch_id).toBeDefined();
      expect(response.body.data.status).toBe('PROCESSING');
      expect(response.body.data.total_orders).toBe(2);
      expect(response.body.data.poll_url).toContain('/api/v1/orders/bulk/');
    });

    it('should reject bulk submission when orders array exceeds 100 with 400 Bad Request', async () => {
      const tooManyOrders = Array.from({ length: 101 }, (_, i) =>
        generateBulkOrder(`OVERFLOW-${i}`, 'mock_courier'),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/bulk')
        .send({ orders: tooManyOrders })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject bulk submission when orders array is empty with 400 Bad Request', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/bulk')
        .send({ orders: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/orders/bulk/:batch_id', () => {
    it('should fetch status and progress of an existing batch', async () => {
      // First submit
      const postRes = await request(app.getHttpServer())
        .post('/api/v1/orders/bulk')
        .send({
          orders: [generateBulkOrder('POLL-ORD-1', 'mock_courier')],
        })
        .expect(202);

      const batchId = postRes.body.data.batch_id;

      // Allow background tick
      await new Promise((r) => setTimeout(r, 100));

      const pollRes = await request(app.getHttpServer())
        .get(`/api/v1/orders/bulk/${batchId}`)
        .expect(200);

      expect(pollRes.body.success).toBe(true);
      expect(pollRes.body.data.batch_id).toBe(batchId);
      expect(pollRes.body.data.total_orders).toBe(1);
      expect(Array.isArray(pollRes.body.data.results)).toBe(true);
    });

    it('should return 404 Not Found for non-existent batch_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/orders/bulk/non-existent-batch-id')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
