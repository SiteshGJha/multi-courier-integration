import { Injectable } from '@nestjs/common';
import { ShipmentStatus, BatchStatus } from '@prisma/client';

@Injectable()
export class MockPrismaService {
  public orders = new Map<string, any>();
  public trackingHistories = new Map<string, any[]>();
  public bulkBatches = new Map<string, any>();
  public bulkBatchItems = new Map<string, any[]>();

  async onModuleInit() {}
  async onModuleDestroy() {}

  order = {
    findUnique: jest.fn(async ({ where }: { where: { orderId?: string } }) => {
      if (where.orderId) {
        return this.orders.get(where.orderId) || null;
      }
      return null;
    }),
    create: jest.fn(async ({ data }: { data: any }) => {
      const order = {
        id: `uuid-${Date.now()}-${Math.random()}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.orders.set(data.orderId, order);
      return order;
    }),
    update: jest.fn(async ({ where, data }: { where: { orderId: string }; data: any }) => {
      const existing = this.orders.get(where.orderId);
      if (existing) {
        const updated = { ...existing, ...data, updatedAt: new Date() };
        this.orders.set(where.orderId, updated);
        return updated;
      }
      return null;
    }),
  };

  trackingHistory = {
    create: jest.fn(async ({ data }: { data: any }) => {
      const history = {
        id: `hist-${Date.now()}-${Math.random()}`,
        ...data,
        recordedAt: new Date(),
      };
      const list = this.trackingHistories.get(data.orderId) || [];
      list.push(history);
      this.trackingHistories.set(data.orderId, list);
      return history;
    }),
  };

  bulkBatch = {
    create: jest.fn(async ({ data }: { data: any }) => {
      const id = `batch-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const batch = {
        id,
        totalOrders: data.totalOrders,
        succeededCount: 0,
        failedCount: 0,
        status: data.status || BatchStatus.PROCESSING,
        createdAt: new Date(),
        completedAt: null,
      };
      this.bulkBatches.set(id, batch);
      return batch;
    }),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const batch = this.bulkBatches.get(where.id);
      if (!batch) return null;
      const items = this.bulkBatchItems.get(where.id) || [];
      return { ...batch, items };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = this.bulkBatches.get(where.id);
      if (existing) {
        const updated = { ...existing, ...data };
        this.bulkBatches.set(where.id, updated);
        return updated;
      }
      return null;
    }),
  };

  bulkBatchItem = {
    createMany: jest.fn(async ({ data }: { data: any[] }) => {
      for (const item of data) {
        const list = this.bulkBatchItems.get(item.batchId) || [];
        list.push({
          id: `item-${Date.now()}-${Math.random()}`,
          ...item,
          awbNumber: null,
          errorReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        this.bulkBatchItems.set(item.batchId, list);
      }
      return { count: data.length };
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { batchId: string; orderId: string };
        data: any;
      }) => {
        const list = this.bulkBatchItems.get(where.batchId) || [];
        for (const item of list) {
          if (item.orderId === where.orderId) {
            Object.assign(item, data, { updatedAt: new Date() });
          }
        }
        return { count: 1 };
      },
    ),
  };
}
