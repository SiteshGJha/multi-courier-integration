import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockPrismaService } from './mock-prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Orders API (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrismaService;

  const validPayload = {
    order_id: 'E2E-ORD-1001',
    courier_partner: 'mock_courier',
    shipper: {
      name: 'Alpha Warehouse',
      phone: '9876543210',
      email: 'alpha@warehouse.com',
      address: 'Plot 10 Industrial Zone',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
      country: 'India',
    },
    consignee: {
      name: 'Beta Buyer',
      phone: '9123456780',
      email: 'beta@buyer.com',
      address: 'House 5 Green Valley',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      country: 'India',
    },
    package: {
      weight_kg: 0.8,
      dimensions_cm: { length: 15, breadth: 10, height: 8 },
      item_description: 'Electronic Gadget',
      declared_value: 1200,
    },
    payment: {
      type: 'PREPAID',
      collectable_amount: 0,
    },
  };

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

  describe('POST /api/v1/orders', () => {
    it('should create order and return standard envelope with 201 Created', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(validPayload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.order_id).toBe('E2E-ORD-1001');
      expect(response.body.data.courier_partner).toBe('mock_courier');
      expect(response.body.data.status).toBe('CREATED');
      expect(response.body.data.awb_number).toMatch(/^MC-/);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should be idempotent: duplicate order_id returns existing order without creating new shipment', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(validPayload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe('E2E-ORD-1001');
      expect(response.body.data.awb_number).toMatch(/^MC-/);
    });

    it('should return 400 Bad Request with field-level errors when required payload fields are missing', async () => {
      const invalidPayload = {
        order_id: 'BAD-ORDER',
        // missing courier_partner, shipper, etc.
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(invalidPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.body.error.details)).toBe(true);
      expect(response.body.error.request_id).toBeDefined();
    });

    it('should return 400 Bad Request with supported couriers list when courier_partner is unknown', async () => {
      const unknownCourierPayload = {
        ...validPayload,
        order_id: 'E2E-ORD-UNKNOWN',
        courier_partner: 'fedex_unknown',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(unknownCourierPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNKNOWN_COURIER');
      expect(response.body.error.message).toContain("Courier partner 'fedex_unknown' is not supported.");
      expect(response.body.error.details.supported_couriers).toContain('mock_courier');
      expect(response.body.error.details.supported_couriers).toContain('urbanebolt');
    });
  });

  describe('GET /api/v1/orders/:order_id/track', () => {
    it('should return current status and travel history for existing order', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/orders/E2E-ORD-1001/track')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe('E2E-ORD-1001');
      expect(response.body.data.current_status).toBeDefined();
      expect(Array.isArray(response.body.data.history)).toBe(true);
    });

    it('should return 404 Not Found for non-existent order', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/orders/NON-EXISTENT-ORDER/track')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
    });
  });

  describe('POST /api/v1/orders/:order_id/cancel', () => {
    it('should cancel existing order and update status to CANCELLED', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/E2E-ORD-1001/cancel')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe('E2E-ORD-1001');
      expect(response.body.data.status).toBe('CANCELLED');
    });

    it('should return 404 Not Found when trying to cancel non-existent order', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/NON-EXISTENT-ORDER/cancel')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
    });
  });
});
