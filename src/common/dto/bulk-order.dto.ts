import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateOrderDto } from './create-order.dto';

export class BulkCreateOrderDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Bulk batch must contain at least 1 order' })
  @ArrayMaxSize(100, { message: 'Bulk batch cannot exceed 100 orders' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderDto)
  orders: CreateOrderDto[];
}
