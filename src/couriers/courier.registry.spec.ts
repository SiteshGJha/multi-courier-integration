import { CourierRegistry } from './courier.registry';
import { ICourierAdapter } from './interfaces/courier-adapter.interface';
import { UnknownCourierException } from '../common/exceptions/courier.exceptions';
import { ShipmentStatus } from '@prisma/client';

describe('CourierRegistry', () => {
  let registry: CourierRegistry;

  const mockAdapter1: ICourierAdapter = {
    courierPartnerId: 'urbanebolt',
    createShipment: jest.fn().mockResolvedValue({
      orderId: 'ORD-1',
      courierPartner: 'urbanebolt',
      courierShipmentId: 'UB-1',
      awbNumber: '200000001',
      status: ShipmentStatus.CREATED,
      rawRequest: {},
      rawResponse: {},
    }),
    trackShipment: jest.fn(),
    cancelShipment: jest.fn(),
  };

  const mockAdapter2: ICourierAdapter = {
    courierPartnerId: 'mock_courier',
    createShipment: jest.fn().mockResolvedValue({
      orderId: 'ORD-2',
      courierPartner: 'mock_courier',
      courierShipmentId: 'MC-2',
      awbNumber: 'MC-200',
      status: ShipmentStatus.CREATED,
      rawRequest: {},
      rawResponse: {},
    }),
    trackShipment: jest.fn(),
    cancelShipment: jest.fn(),
  };

  beforeEach(() => {
    registry = new CourierRegistry();
  });

  it('should register and retrieve adapters by courier ID (case-insensitive)', () => {
    registry.register(mockAdapter1);
    registry.register(mockAdapter2);

    expect(registry.getAdapter('urbanebolt')).toBe(mockAdapter1);
    expect(registry.getAdapter('URBANEBOLT')).toBe(mockAdapter1);
    expect(registry.getAdapter('mock_courier')).toBe(mockAdapter2);
  });

  it('should return a sorted list of registered supported couriers', () => {
    registry.register(mockAdapter1);
    registry.register(mockAdapter2);

    expect(registry.getSupportedCouriers()).toEqual(['mock_courier', 'urbanebolt']);
  });

  it('should throw UnknownCourierException when requesting an unregistered courier', () => {
    registry.register(mockAdapter1);
    registry.register(mockAdapter2);

    expect(() => registry.getAdapter('delhivery')).toThrow(UnknownCourierException);

    try {
      registry.getAdapter('delhivery');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownCourierException);
      expect((error as UnknownCourierException).supportedCouriers).toEqual([
        'mock_courier',
        'urbanebolt',
      ]);
    }
  });
});
