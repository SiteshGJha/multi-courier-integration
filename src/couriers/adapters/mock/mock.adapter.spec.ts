import { MockCourierAdapter } from './mock.adapter';
import { CreateOrderDto, PaymentType } from '../../../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';

describe('MockCourierAdapter', () => {
  let adapter: MockCourierAdapter;

  const validDto: CreateOrderDto = {
    order_id: 'ORD-MOCK-1',
    courier_partner: 'mock_courier',
    shipper: {
      name: 'Shipper Name',
      phone: '9876543210',
      email: 'shipper@example.com',
      address: 'Industrial Area',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001',
      country: 'India',
    },
    consignee: {
      name: 'Consignee Name',
      phone: '9123456780',
      email: 'consignee@example.com',
      address: 'Main Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India',
    },
    package: {
      weight_kg: 0.8,
      dimensions_cm: { length: 10, breadth: 10, height: 10 },
      item_description: 'Book',
      declared_value: 200,
    },
    payment: {
      type: PaymentType.PREPAID,
      collectable_amount: 0,
    },
  };

  beforeEach(() => {
    adapter = new MockCourierAdapter();
  });

  it('should have courierPartnerId = mock_courier', () => {
    expect(adapter.courierPartnerId).toBe('mock_courier');
  });

  it('should create shipment successfully and return deterministic AWB and status CREATED', async () => {
    const result = await adapter.createShipment(validDto);

    expect(result.orderId).toBe('ORD-MOCK-1');
    expect(result.courierPartner).toBe('mock_courier');
    expect(result.awbNumber).toMatch(/^MC-/);
    expect(result.status).toBe(ShipmentStatus.CREATED);
    expect(result.rawRequest).toBeDefined();
    expect(result.rawResponse).toBeDefined();
  });

  it('should track shipment and return travel history', async () => {
    const tracking = await adapter.trackShipment('MC-999999', 'ORD-MOCK-1');

    expect(tracking.awbNumber).toBe('MC-999999');
    expect(tracking.orderId).toBe('ORD-MOCK-1');
    expect(tracking.history.length).toBeGreaterThan(0);
    expect(tracking.currentStatus).toBeDefined();
  });

  it('should cancel shipment successfully', async () => {
    const cancel = await adapter.cancelShipment('MC-999999', 'ORD-MOCK-1');

    expect(cancel.status).toBe(ShipmentStatus.CANCELLED);
    expect(cancel.awbNumber).toBe('MC-999999');
    expect(cancel.message).toContain('cancelled');
  });
});
