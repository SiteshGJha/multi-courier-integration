import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { UnknownCourierException } from '../exceptions/courier.exceptions';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockGetResponse: jest.Mock;
  let mockGetRequest: jest.Mock;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockImplementation(() => ({ json: mockJson }));
    mockGetResponse = jest.fn().mockReturnValue({ status: mockStatus });
    mockGetRequest = jest.fn().mockReturnValue({
      headers: { 'x-request-id': 'test-request-id-123' },
      url: '/api/v1/orders',
      method: 'POST',
    });

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: mockGetResponse,
        getRequest: mockGetRequest,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should format UnknownCourierException into standard envelope with supported couriers', () => {
    const exception = new UnknownCourierException('fedex', ['mock_courier', 'urbanebolt']);

    filter.catch(exception, mockArgumentsHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'UNKNOWN_COURIER',
          message: expect.stringContaining("Courier partner 'fedex' is not supported"),
          details: {
            supported_couriers: ['mock_courier', 'urbanebolt'],
          },
          request_id: 'test-request-id-123',
        }),
      }),
    );
  });

  it('should format standard BadRequestException with field-level validation errors', () => {
    const exception = new BadRequestException({
      message: ['order_id should not be empty', 'courier_partner must be a string'],
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          request_id: 'test-request-id-123',
        }),
      }),
    );
  });
});
