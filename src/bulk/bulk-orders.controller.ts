import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { BulkOrdersService } from './bulk-orders.service';
import { BulkCreateOrderDto } from '../common/dto/bulk-order.dto';
import { ApiResponseEnvelope } from '../common/dto/api-response.dto';

@Controller('api/v1/orders/bulk')
export class BulkOrdersController {
  constructor(private readonly bulkOrdersService: BulkOrdersService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async submitBulkOrders(@Body() dto: BulkCreateOrderDto): Promise<ApiResponseEnvelope<any>> {
    const data = await this.bulkOrdersService.submitBulkOrders(dto);
    return {
      success: true,
      data,
    };
  }

  @Get(':batch_id')
  async getBatchStatus(@Param('batch_id') batchId: string): Promise<ApiResponseEnvelope<any>> {
    const data = await this.bulkOrdersService.getBatchStatus(batchId);
    return {
      success: true,
      data,
    };
  }
}
