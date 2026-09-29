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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { ApiResponseEnvelope } from '../common/dto/api-response.dto';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async createOrder(@Body() dto: CreateOrderDto): Promise<ApiResponseEnvelope<any>> {
    const data = await this.ordersService.createOrder(dto);
    return {
      success: true,
      data,
    };
  }

  @Get(':order_id/track')
  async trackOrder(@Param('order_id') orderId: string): Promise<ApiResponseEnvelope<any>> {
    const data = await this.ordersService.trackOrder(orderId);
    return {
      success: true,
      data,
    };
  }

  @Post(':order_id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(@Param('order_id') orderId: string): Promise<ApiResponseEnvelope<any>> {
    const data = await this.ordersService.cancelOrder(orderId);
    return {
      success: true,
      data,
    };
  }
}
