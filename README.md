# Multi-Courier Integration Platform

Production-grade logistics integration service providing a normalized, courier-agnostic REST API for e-commerce platforms. Features concrete integrations for **UrbaneBolt UAT** and a bonus **MockCourier**, a pluggable Strategy + Registry architecture, PostgreSQL audit persistence via Prisma ORM, and high-throughput asynchronous bulk order processing with bounded concurrency.

---

## Table of Contents
1. [Key Features](#key-features)
2. [Architecture & Design Principles](#architecture--design-principles)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Setup & Quickstart](#setup--quickstart)
6. [Environment Variables](#environment-variables)
7. [Running Tests](#running-tests)
8. [API Reference & cURL Examples](#api-reference--curl-examples)
9. [How to Add a New Courier Partner](#how-to-add-a-new-courier-partner)
10. [Assumptions & Trade-offs](#assumptions--trade-offs)

---

## Key Features

- **Courier-Agnostic Contract**: API consumers send normalized payloads and specify `courier_partner` (e.g. `"urbanebolt"`, `"mock_courier"`). Third-party vendor schemas never leak to clients.
- **Pluggable Architecture**: Open-Closed Principle (OCP). Onboarding a new courier requires **zero changes** to controllers, routes, unified DTOs, or existing services.
- **Idempotency Guarantee**: Unique constraint on `order_id` ensures re-submitting an order returns the existing shipment without creating duplicate courier requests.
- **Audit Persistence & Append-Only History**: Full request/response raw payloads to courier partners are stored in PostgreSQL. Tracking updates are saved as immutable history records.
- **Asynchronous Bulk Processing**: Up to 100 orders per batch with non-blocking HTTP 202 Accepted response (<50ms), background bounded concurrency worker pool (concurrency limit = 10), multi-courier batches, and isolated partial success handling.
- **Production Resilience**: In-memory token caching with single-flight mutex for automatic re-authentication on HTTP 401, exponential backoff retries on 5xx/network errors, and structured JSON error logging.

---

## Architecture & Design Principles

The service adopts **Hexagonal / Clean Architecture** with the **Strategy + Registry Factory Pattern**:

```
                       ┌──────────────────────────────┐
                       │  Internal Consumers (OMS/UI) │
                       └──────────────┬───────────────┘
                                      │ REST (Unified Contract)
                                      ▼
                       ┌──────────────────────────────┐
                       │      OrdersController        │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │        OrdersService         │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │   CourierRegistry (Factory)  │
                       └──────────────┬───────────────┘
                                      │ Resolves adapter by courier_partner ID
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   ┌───────────────────────────┐             ┌───────────────────────────┐
   │    UrbaneBoltAdapter      │             │     MockCourierAdapter    │
   │  (implements ICourier)    │             │   (implements ICourier)   │
   └─────────────┬─────────────┘             └─────────────┬─────────────┘
                 │                                         │
                 ▼                                         ▼
     UrbaneBolt UAT Services                      Simulated In-Memory / Latency
```

Detailed design documentation is available in [DESIGN.md](DESIGN.md).

---

## Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) v10 (Node.js runtime, TypeScript)
- **Database & ORM**: PostgreSQL 15 & [Prisma ORM](https://www.prisma.io/) v5
- **Validation & Transformation**: `class-validator`, `class-transformer`
- **HTTP Client**: Axios with custom resilience interceptors
- **Testing**: Jest, Supertest
- **Containerization**: Docker, Docker Compose

---

## Prerequisites

- **Node.js**: v18.17+ or v20+
- **npm**: v9+
- **Docker & Docker Compose** (for running PostgreSQL and containerized app)

---

## Setup & Quickstart

### Option A: Running with Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd multi-courier-integration
   ```

2. Start PostgreSQL and the backend service:
   ```bash
   docker-compose up --build
   ```

The service will start on `http://localhost:3000`.

---

### Option B: Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Start PostgreSQL container:
   ```bash
   docker-compose up -d postgres
   ```

4. Generate Prisma client and run migrations:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. Start the application:
   ```bash
   # Development mode (with hot-reload)
   npm run start:dev

   # Production build & run
   npm run build
   npm run start:prod
   ```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://courier_user:courier_password@localhost:5432/courier_db?schema=public` |
| `URBANEBOLT_BASE_URL` | UrbaneBolt UAT Base URL | `https://uat.urbanebolt.in/api/v1` |
| `URBANEBOLT_USERNAME` | UrbaneBolt API Username | `info@urbanebolt.com` |
| `URBANEBOLT_PASSWORD` | UrbaneBolt API Password | `EKIcygsLVV5RCtPZ` |
| `COURIER_MAX_RETRIES` | Max retries for transient 5xx/network errors | `3` |
| `COURIER_INITIAL_BACKOFF_MS` | Initial exponential backoff delay in ms | `500` |
| `COURIER_BACKOFF_FACTOR` | Backoff multiplier factor | `2` |
| `COURIER_TIMEOUT_MS` | HTTP socket timeout in ms | `10000` |
| `BULK_CONCURRENCY_LIMIT` | Max parallel orders processed in bulk worker | `10` |

---

## Running Tests

The test suite covers unit tests, resilience tests, and end-to-end integration tests:

```bash
# Run all unit tests
npm test

# Run end-to-end integration tests (Supertest)
npm run test:e2e

# Run tests with coverage report
npm run test:cov
```

---

## API Reference & cURL Examples

### 1. Create Order
**`POST /api/v1/orders`** (HTTP 201 Created)

Creates a new shipment with the specified courier partner. Idempotent on `order_id`.

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD-2026-9901",
    "courier_partner": "mock_courier",
    "shipper": {
      "name": "Acme Warehouse",
      "phone": "9876543210",
      "email": "shipping@acme.com",
      "address": "Plot 42, Industrial Area Phase 2",
      "city": "Gurugram",
      "state": "Haryana",
      "pincode": "122001",
      "country": "India"
    },
    "consignee": {
      "name": "Jane Doe",
      "phone": "9123456780",
      "email": "jane@example.com",
      "address": "Flat 304, Green Heights",
      "city": "Bengaluru",
      "state": "Karnataka",
      "pincode": "560001",
      "country": "India"
    },
    "package": {
      "weight_kg": 0.75,
      "dimensions_cm": { "length": 15, "breadth": 10, "height": 8 },
      "item_description": "Electronics Accessories",
      "declared_value": 1500
    },
    "payment": {
      "type": "PREPAID",
      "collectable_amount": 0
    }
  }'
```

**Response (HTTP 201 Created):**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "mock_courier",
    "courier_order_id": "MOCK-SHIP-1727618000000",
    "awb_number": "MC-202699-4321",
    "status": "CREATED",
    "created_at": "2026-09-29T14:20:00.000Z"
  }
}
```

---

### 2. Track Order
**`GET /api/v1/orders/:order_id/track`** (HTTP 200 OK)

Fetches current status and full travel history from the courier partner, appending a new snapshot to the database tracking ledger.

```bash
curl -X GET http://localhost:3000/api/v1/orders/ORD-2026-9901/track
```

**Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "mock_courier",
    "awb_number": "MC-202699-4321",
    "current_status": "IN_TRANSIT",
    "history": [
      {
        "status": "CREATED",
        "location": "Gurugram",
        "timestamp": "2026-09-29T14:20:00.000Z",
        "description": "Shipment created in Mock Courier system"
      },
      {
        "status": "IN_TRANSIT",
        "location": "Hub Facility",
        "timestamp": "2026-09-29T14:25:00.000Z",
        "description": "Package in sorting facility"
      }
    ]
  }
}
```

---

### 3. Cancel Order
**`POST /api/v1/orders/:order_id/cancel`** (HTTP 200 OK)

Cancels a shipment before delivery.

```bash
curl -X POST http://localhost:3000/api/v1/orders/ORD-2026-9901/cancel
```

**Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "mock_courier",
    "awb_number": "MC-202699-4321",
    "status": "CANCELLED",
    "cancelled_at": "2026-09-29T14:26:00.000Z",
    "message": "Shipment MC-202699-4321 successfully cancelled with MockCourier"
  }
}
```

---

### 4. Bulk Create Orders (Up to 100 Orders)
**`POST /api/v1/orders/bulk`** (HTTP 202 Accepted)

Non-blocking endpoint that ingests up to 100 orders and immediately returns a `batch_id`. Each order can specify a different `courier_partner`.

```bash
curl -X POST http://localhost:3000/api/v1/orders/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "orders": [
      {
        "order_id": "BATCH-ORD-001",
        "courier_partner": "mock_courier",
        "shipper": { "name": "Warehouse", "phone": "9876543210", "address": "Hub 1", "city": "Delhi", "state": "Delhi", "pincode": "110001", "country": "India" },
        "consignee": { "name": "Buyer 1", "phone": "9123456780", "address": "Flat 1", "city": "Mumbai", "state": "Maharashtra", "pincode": "400001", "country": "India" },
        "package": { "weight_kg": 0.5, "dimensions_cm": { "length": 10, "breadth": 10, "height": 8 }, "item_description": "Item 1", "declared_value": 300 },
        "payment": { "type": "PREPAID", "collectable_amount": 0 }
      },
      {
        "order_id": "BATCH-ORD-002",
        "courier_partner": "urbanebolt",
        "shipper": { "name": "Warehouse", "phone": "9876543210", "address": "Hub 1", "city": "Delhi", "state": "Delhi", "pincode": "110001", "country": "India" },
        "consignee": { "name": "Buyer 2", "phone": "9123456780", "address": "Flat 2", "city": "Bengaluru", "state": "Karnataka", "pincode": "560001", "country": "India" },
        "package": { "weight_kg": 1.2, "dimensions_cm": { "length": 12, "breadth": 12, "height": 10 }, "item_description": "Item 2", "declared_value": 750 },
        "payment": { "type": "COD", "collectable_amount": 750 }
      }
    ]
  }'
```

**Response (HTTP 202 Accepted):**
```json
{
  "success": true,
  "data": {
    "batch_id": "9d90e9c8-4770-4a81-9b19-ef87e35b7194",
    "status": "PROCESSING",
    "total_orders": 2,
    "poll_url": "/api/v1/orders/bulk/9d90e9c8-4770-4a81-9b19-ef87e35b7194"
  }
}
```

---

### 5. Check Bulk Batch Progress
**`GET /api/v1/orders/bulk/:batch_id`** (HTTP 200 OK)

Polls batch progress, aggregate success/failure counts, and individual order item outcomes.

```bash
curl -X GET http://localhost:3000/api/v1/orders/bulk/9d90e9c8-4770-4a81-9b19-ef87e35b7194
```

**Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "batch_id": "9d90e9c8-4770-4a81-9b19-ef87e35b7194",
    "status": "COMPLETED",
    "total_orders": 2,
    "succeeded_count": 2,
    "failed_count": 0,
    "created_at": "2026-09-29T14:21:00.000Z",
    "completed_at": "2026-09-29T14:21:02.000Z",
    "results": [
      {
        "order_id": "BATCH-ORD-001",
        "courier_partner": "mock_courier",
        "status": "SUCCESS",
        "awb_number": "MC-001-9872",
        "error": null
      },
      {
        "order_id": "BATCH-ORD-002",
        "courier_partner": "urbanebolt",
        "status": "SUCCESS",
        "awb_number": "200000001170",
        "error": null
      }
    ]
  }
}
```

---

## How to Add a New Courier Partner

The pluggable architecture strictly adheres to the Open-Closed Principle. To onboard a new courier partner (e.g. **Delhivery**), follow these 2 steps:

### Step 1: Implement `ICourierAdapter`

Create `src/couriers/adapters/delhivery/delhivery.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import {
  ICourierAdapter,
  NormalizedShipmentResult,
  NormalizedTrackingResult,
  NormalizedCancelResult,
} from '../../interfaces/courier-adapter.interface';
import { CreateOrderDto } from '../../../common/dto/create-order.dto';
import { ShipmentStatus } from '@prisma/client';

@Injectable()
export class DelhiveryAdapter implements ICourierAdapter {
  readonly courierPartnerId = 'delhivery';

  async createShipment(dto: CreateOrderDto): Promise<NormalizedShipmentResult> {
    // 1. Transform unified CreateOrderDto to Delhivery request payload
    // 2. Call Delhivery API via ResilienceHttpService
    // 3. Return normalized result
    return {
      orderId: dto.order_id,
      courierPartner: this.courierPartnerId,
      courierShipmentId: 'DEL-12345',
      awbNumber: 'DEL-AWB-9999',
      status: ShipmentStatus.CREATED,
      rawRequest: {},
      rawResponse: {},
    };
  }

  async trackShipment(awbNumber: string, orderId: string): Promise<NormalizedTrackingResult> {
    // Query Delhivery tracking API and map to normalized tracking format
    return {
      orderId,
      courierPartner: this.courierPartnerId,
      awbNumber,
      currentStatus: ShipmentStatus.IN_TRANSIT,
      history: [],
      rawResponse: {},
    };
  }

  async cancelShipment(awbNumber: string, orderId: string): Promise<NormalizedCancelResult> {
    // Call Delhivery cancellation endpoint
    return {
      orderId,
      courierPartner: this.courierPartnerId,
      awbNumber,
      status: ShipmentStatus.CANCELLED,
      cancelledAt: new Date().toISOString(),
      message: 'Delhivery shipment cancelled successfully',
      rawResponse: {},
    };
  }
}
```

### Step 2: Register in `CouriersModule`

Add `DelhiveryAdapter` to `src/couriers/couriers.module.ts`:

```typescript
@Module({
  providers: [
    CourierRegistry,
    ResilienceHttpService,
    UrbaneBoltAdapter,
    MockCourierAdapter,
    DelhiveryAdapter, // <-- Added here
  ],
  exports: [CourierRegistry, ResilienceHttpService],
})
export class CouriersModule implements OnModuleInit {
  constructor(
    private readonly registry: CourierRegistry,
    private readonly urbaneBoltAdapter: UrbaneBoltAdapter,
    private readonly mockCourierAdapter: MockCourierAdapter,
    private readonly delhiveryAdapter: DelhiveryAdapter, // <-- Injected here
  ) {}

  onModuleInit() {
    this.registry.register(this.urbaneBoltAdapter);
    this.registry.register(this.mockCourierAdapter);
    this.registry.register(this.delhiveryAdapter); // <-- Registered here
  }
}
```

**That's it.**
- Zero lines changed in `OrdersController` or `BulkOrdersController`.
- Zero changes to routes or HTTP endpoint contracts.
- Zero changes to `CreateOrderDto` or response schemas.
- Zero changes to existing courier implementations (`UrbaneBoltAdapter`, `MockCourierAdapter`).
- Consumers can now immediately send `"courier_partner": "delhivery"`.

---

## Assumptions & Trade-offs

1. **In-Memory Worker vs External Queue**: For bulk processing up to 100 orders, an in-process worker pool bounded to 10 concurrent requests was chosen. This avoids hard dependencies on external brokers (such as Redis/RabbitMQ) while keeping batch ingestion under 50ms (HTTP 202) and protecting partner APIs from rate limiting.
2. **Idempotency on `order_id`**: Submitting an existing `order_id` returns the existing shipment details immediately. This prevents duplicate air waybills and vendor billing duplicates.
3. **Audit Payloads**: Full raw payloads sent to and received from third-party partners are persisted as JSON in PostgreSQL for auditing, automated reconciliation, and incident debugging.
