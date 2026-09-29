import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponseEnvelope } from '../dto/api-response.dto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      (request.headers?.['x-request-id'] as string) ||
      (response.getHeader?.('x-request-id') as string) ||
      uuidv4();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected internal error occurred.';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, any>;
        code = obj.code || (status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR');
        message = obj.message || exception.message;
        details = obj.details;

        // Handle class-validator messages array
        if (Array.isArray(obj.message)) {
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = obj.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorBody: ApiResponseEnvelope<null> = {
      success: false,
      error: {
        code,
        message,
        details,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
    };

    // Structured logging for traceability
    const orderId = (request.body?.order_id as string) || (request.params?.order_id as string) || 'N/A';
    const courierPartner = (request.body?.courier_partner as string) || 'N/A';

    this.logger.error(
      JSON.stringify({
        requestId,
        orderId,
        courierPartner,
        errorType: code,
        statusCode: status,
        url: request.url,
        method: request.method,
        message,
        details,
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    );

    response.status(status).json(errorBody);
  }
}
