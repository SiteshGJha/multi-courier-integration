import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UrbaneBoltAdapter } from './urbanebolt.adapter';
import { ResilienceHttpService } from '../../http/resilience-http.service';
import { CreateOrderDto, PaymentType } from '../../../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';

describe('UrbaneBoltAdapter', () => {
  let adapter: UrbaneBoltAdapter;
  let mockHttpService: { executeRequest: jest.Mock };

  const validDto: CreateOrderDto = {
    order_id: 'UB-ORD-101',
    courier_partner: 'urbanebolt',
    shipper: {
      name: 'Rohit Athaley',
      phone: '9425018023',
      email: 'bhopal@mbdgroup.com',
      address: 'Plot No. 137, Industrial Area',
      city: 'Govindpura',
      state: 'Bhopal',
      pincode: '122017',
      country: 'India',
    },
    consignee: {
      name: 'Satyam Convent School',
      phone: '8320226438',
      email: 'school@example.com',
      address: 'Plot 26-27 Om Nagar',
      city: 'Surat',
      state: 'Gujarat',
      pincode: '122001',
      country: 'India',
    },
    package: {
      weight_kg: 1.1,
      dimensions_cm: { length: 12, breadth: 10, height: 10 },
      item_description: 'Books',
      declared_value: 100,
    },
    payment: {
      type: PaymentType.COD,
      collectable_amount: 1,
    },
  };

  beforeEach(async () => {
    mockHttpService = {
      executeRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrbaneBoltAdapter,
        { provide: ResilienceHttpService, useValue: mockHttpService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'urbaneBolt.baseUrl') return 'https://uat.urbanebolt.in/api/v1';
              if (key === 'urbaneBolt.username') return 'info@urbanebolt.com';
              if (key === 'urbaneBolt.password') return 'EKIcygsLVV5RCtPZ';
              return null;
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<UrbaneBoltAdapter>(UrbaneBoltAdapter);
  });

  it('should have courierPartnerId = urbanebolt', () => {
    expect(adapter.courierPartnerId).toBe('urbanebolt');
  });

  it('should successfully create shipment via UrbaneBolt manifest endpoint', async () => {
    mockHttpService.executeRequest.mockImplementation(async (opts) => {
      if (opts.config.url.includes('/auth/getToken/')) {
        return { data: { token: 'mock-bearer-token' } };
      }
      if (opts.config.url.includes('/services/manifest/')) {
        return {
          status: 200,
          data: [
            {
              orderNumber: 'UB-ORD-101',
              awb: '200000001170',
              status: 'SUCCESS',
              message: 'Manifest created successfully',
            },
          ],
        };
      }
      return { status: 200, data: {} };
    });

    const result = await adapter.createShipment(validDto);

    expect(result.orderId).toBe('UB-ORD-101');
    expect(result.courierPartner).toBe('urbanebolt');
    expect(result.awbNumber).toBe('200000001170');
    expect(result.status).toBe(ShipmentStatus.CREATED);
  });

  it('should fetch tracking info and map status events to unified format', async () => {
    mockHttpService.executeRequest.mockImplementation(async (opts) => {
      if (opts.config.url.includes('/auth/getToken/')) {
        return { data: { token: 'mock-bearer-token' } };
      }
      if (opts.config.url.includes('/services/tracking-pub/')) {
        return {
          status: 200,
          data: {
            awb: '200000001170',
            current_status: 'In Transit',
            scans: [
              {
                status: 'Manifested',
                location: 'Govindpura',
                timestamp: '2026-09-29T10:00:00Z',
                remark: 'Shipment created',
              },
              {
                status: 'In Transit',
                location: 'Delhi Hub',
                timestamp: '2026-09-29T14:00:00Z',
                remark: 'Dispatched to hub',
              },
            ],
          },
        };
      }
      return { status: 200, data: {} };
    });

    const tracking = await adapter.trackShipment('200000001170', 'UB-ORD-101');

    expect(tracking.awbNumber).toBe('200000001170');
    expect(tracking.orderId).toBe('UB-ORD-101');
    expect(tracking.currentStatus).toBe(ShipmentStatus.IN_TRANSIT);
    expect(tracking.history.length).toBe(2);
  });

  it('should cancel shipment via UrbaneBolt cancellation endpoint', async () => {
    mockHttpService.executeRequest.mockImplementation(async (opts) => {
      if (opts.config.url.includes('/auth/getToken/')) {
        return { data: { token: 'mock-bearer-token' } };
      }
      if (opts.config.url.includes('/services/cancel/')) {
        return {
          status: 200,
          data: {
            success: true,
            message: 'AWB 200000001170 cancelled successfully',
          },
        };
      }
      return { status: 200, data: {} };
    });

    const cancel = await adapter.cancelShipment('200000001170', 'UB-ORD-101');

    expect(cancel.status).toBe(ShipmentStatus.CANCELLED);
    expect(cancel.awbNumber).toBe('200000001170');
  });
});
