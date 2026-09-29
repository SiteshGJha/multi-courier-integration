import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PaymentType {
  PREPAID = 'PREPAID',
  COD = 'COD',
}

export class AddressDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  pincode: string;

  @IsString()
  @IsNotEmpty()
  country: string;
}

export class PackageDimensionsDto {
  @IsNumber()
  @IsPositive()
  length: number;

  @IsNumber()
  @IsPositive()
  breadth: number;

  @IsNumber()
  @IsPositive()
  height: number;
}

export class PackageDto {
  @IsNumber()
  @IsPositive()
  weight_kg: number;

  @ValidateNested()
  @Type(() => PackageDimensionsDto)
  dimensions_cm: PackageDimensionsDto;

  @IsString()
  @IsNotEmpty()
  item_description: string;

  @IsNumber()
  @IsPositive()
  declared_value: number;
}

export class PaymentDto {
  @IsEnum(PaymentType)
  type: PaymentType;

  @IsNumber()
  collectable_amount: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;

  @IsString()
  @IsNotEmpty()
  courier_partner: string;

  @ValidateNested()
  @Type(() => AddressDto)
  shipper: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  consignee: AddressDto;

  @ValidateNested()
  @Type(() => PackageDto)
  package: PackageDto;

  @ValidateNested()
  @Type(() => PaymentDto)
  payment: PaymentDto;

  @IsString()
  @IsOptional()
  service_type?: string;
}
