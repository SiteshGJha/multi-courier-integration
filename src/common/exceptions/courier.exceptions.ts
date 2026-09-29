import { HttpException, HttpStatus } from '@nestjs/common';

export class UnknownCourierException extends HttpException {
  constructor(
    public readonly requestedCourier: string,
    public readonly supportedCouriers: string[],
  ) {
    super(
      {
        code: 'UNKNOWN_COURIER',
        message: `Courier partner '${requestedCourier}' is not supported.`,
        details: {
          supported_couriers: supportedCouriers,
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class CourierClientException extends HttpException {
  constructor(
    public readonly courierPartner: string,
    message: string,
    public readonly rawCourierError?: any,
  ) {
    super(
      {
        code: 'COURIER_CLIENT_ERROR',
        message: message || 'Courier partner rejected the request due to invalid parameters.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class CourierServerException extends HttpException {
  constructor(
    public readonly courierPartner: string,
    message: string,
    public readonly rawCourierError?: any,
  ) {
    super(
      {
        code: 'COURIER_SERVICE_UNAVAILABLE',
        message: message || 'Courier partner service failed or timed out after retries.',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class OrderNotFoundException extends HttpException {
  constructor(orderId: string) {
    super(
      {
        code: 'ORDER_NOT_FOUND',
        message: `Order with order_id '${orderId}' not found.`,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class OrderConflictException extends HttpException {
  constructor(orderId: string, message?: string) {
    super(
      {
        code: 'ORDER_ALREADY_EXISTS',
        message: message || `Order with order_id '${orderId}' has already been processed.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class ShipmentCancellationException extends HttpException {
  constructor(orderId: string, message: string) {
    super(
      {
        code: 'CANCELLATION_FAILED',
        message: message || `Order '${orderId}' could not be cancelled.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
