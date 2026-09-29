import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateOrderDto, PaymentType } from './create-order.dto';

describe('CreateOrderDto Validation', () => {
  it('should validate a complete valid order payload', async () => {
    const payload = {
      order_id: 'ORD-1001',
      courier_partner: 'urbanebolt',
      shipper: {
        name: 'Warehouse North',
        phone: '9876543210',
        email: 'north@warehouse.com',
        address: 'Sector 18',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122015',
        country: 'India',
      },
      consignee: {
        name: 'John Doe',
        phone: '9123456780',
        email: 'john@example.com',
        address: 'MG Road 42',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      package: {
        weight_kg: 1.5,
        dimensions_cm: { length: 20, breadth: 15, height: 10 },
        item_description: 'Textbooks',
        declared_value: 500,
      },
      payment: {
        type: PaymentType.PREPAID,
        collectable_amount: 0,
      },
    };

    const dto = plainToInstance(CreateOrderDto, payload);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation when required fields are missing', async () => {
    const payload = {
      order_id: '',
      // missing courier_partner, shipper, consignee, package, payment
    };

    const dto = plainToInstance(CreateOrderDto, payload);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
