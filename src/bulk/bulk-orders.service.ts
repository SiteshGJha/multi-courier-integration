import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { BulkCreateOrderDto } from '../common/dto/bulk-order.dto';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { BatchStatus } from '@prisma/client';

export interface BulkSubmissionResponse {
  batch_id: string;
  status: string;
  total_orders: number;
  poll_url: string;
}

export interface BatchItemResult {
  order_id: string;
  courier_partner: string;
  status: 'SUCCESS' | 'FAILED';
  awb_number?: string | null;
  error?: string | null;
}

export interface BatchStatusResponse {
  batch_id: string;
  status: BatchStatus;
  total_orders: number;
  succeeded_count: number;
  failed_count: number;
  created_at: Date;
  completed_at?: Date | null;
  results: BatchItemResult[];
}

@Injectable()
export class BulkOrdersService {
  private readonly logger = new Logger(BulkOrdersService.name);
  private readonly concurrencyLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {
    this.concurrencyLimit = this.configService.get<number>('bulk.concurrencyLimit') ?? 10;
  }

  async submitBulkOrders(dto: BulkCreateOrderDto): Promise<BulkSubmissionResponse> {
    const totalOrders = dto.orders.length;
    this.logger.log(`Received bulk submission of ${totalOrders} orders`);

    // 1. Create BulkBatch record in PENDING / PROCESSING state
    const batch = await this.prisma.bulkBatch.create({
      data: {
        totalOrders,
        status: BatchStatus.PROCESSING,
      },
    });

    // 2. Pre-create pending BulkBatchItem records for audit
    const itemRecords = dto.orders.map((order) => ({
      batchId: batch.id,
      orderId: order.order_id,
      courierPartner: order.courier_partner.toLowerCase(),
      status: 'PENDING',
    }));

    await this.prisma.bulkBatchItem.createMany({
      data: itemRecords,
    });

    // 3. Dispatch execution asynchronously in background (non-blocking)
    setImmediate(() => {
      this.processBatchInBackground(batch.id, dto.orders).catch((err) => {
        this.logger.error(`Fatal background error processing batch ${batch.id}: ${err.message}`, err.stack);
      });
    });

    // 4. Return HTTP 202 payload immediately (<50ms)
    return {
      batch_id: batch.id,
      status: 'PROCESSING',
      total_orders: totalOrders,
      poll_url: `/api/v1/orders/bulk/${batch.id}`,
    };
  }

  async processBatchInBackground(batchId: string, orders: CreateOrderDto[]): Promise<void> {
    this.logger.log(
      `Starting background execution for batch ${batchId} with concurrency limit ${this.concurrencyLimit}`,
    );

    let succeededCount = 0;
    let failedCount = 0;

    // Concurrency-limited execution pool
    await this.runWithConcurrency(orders, this.concurrencyLimit, async (order) => {
      try {
        const result = await this.ordersService.createOrder(order);
        succeededCount++;

        await this.prisma.bulkBatchItem.updateMany({
          where: { batchId, orderId: order.order_id },
          data: {
            status: 'SUCCESS',
            awbNumber: result.awb_number,
          },
        });
      } catch (error: any) {
        failedCount++;
        const errorMessage = error?.response?.message || error.message || 'Unknown processing error';

        this.logger.warn(`Bulk order ${order.order_id} failed: ${errorMessage}`);

        await this.prisma.bulkBatchItem.updateMany({
          where: { batchId, orderId: order.order_id },
          data: {
            status: 'FAILED',
            errorReason: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
          },
        });
      }
    });

    // Mark batch as COMPLETED
    await this.prisma.bulkBatch.update({
      where: { id: batchId },
      data: {
        status: BatchStatus.COMPLETED,
        succeededCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Batch ${batchId} completed. Succeeded: ${succeededCount}, Failed: ${failedCount}`,
    );
  }

  async getBatchStatus(batchId: string): Promise<BatchStatusResponse> {
    const batch = await this.prisma.bulkBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Bulk batch with id '${batchId}' not found.`);
    }

    return {
      batch_id: batch.id,
      status: batch.status,
      total_orders: batch.totalOrders,
      succeeded_count: batch.succeededCount,
      failed_count: batch.failedCount,
      created_at: batch.createdAt,
      completed_at: batch.completedAt,
      results: batch.items.map((item) => ({
        order_id: item.orderId,
        courier_partner: item.courierPartner,
        status: item.status as 'SUCCESS' | 'FAILED',
        awb_number: item.awbNumber,
        error: item.errorReason,
      })),
    };
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    workerFn: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;
    const workerCount = Math.min(limit, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const itemIndex = index++;
        if (itemIndex < items.length) {
          await workerFn(items[itemIndex]);
        }
      }
    });

    await Promise.all(workers);
  }
}
