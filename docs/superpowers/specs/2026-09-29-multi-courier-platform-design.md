# Technical Design Specification: Multi-Courier Integration Platform

## 1. Overview & Business Context

An e-commerce logistics platform requires a backend service capable of integrating with multiple third-party courier partners (today UrbaneBolt; in future Delhivery, Shiprocket, Bluedart, DTDC, etc.).

### Core Goals
1. **Unified REST API**: Internal consumers (Order Management System, web frontends, warehouse management) interact exclusively with a normalized, courier-agnostic contract. Consumers specify `courier_partner` (e.g., `"urbanebolt"`, `"mock_courier"`) and standard order details.
2. **Pluggable Courier Architecture**: Adding a new courier in the future requires:
   - ZERO changes to controllers or HTTP routes.
   - ZERO changes to unified request/response DTOs.
   - ZERO modifications to existing courier implementations.
   - ZERO alterations to core business logic services.
3. **Auditing & Append-Only History**: Complete raw request/response payloads to third-party couriers are persisted for auditing. Tracking updates are saved to an append-only ledger.
4. **Asynchronous Bulk Processing**: Ingest up to 100 orders per batch with responsive non-blocking ingestion (HTTP 202 Accepted + `batch_id`), bounded-concurrency worker execution, multi-courier routing within a single batch, idempotency on `order_id`, and partial success isolation.
5. **Production Resilience**: In-memory token caching with auto re-authentication on 401, exponential backoff retries on transient 5xx/network errors, and normalized error responses without leaking vendor internals.

---

## 2. High-Level Architecture & Pluggable Adapter Pattern

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

### 2.1 The Adapter Interface Contract (`ICourierAdapter`)
Located at `src/couriers/interfaces/courier-adapter.interface.ts`:

```typescript
export interface ICourierAdapter {
  readonly courierPartnerId: string;

  createShipment(request: NormalizedCreateShipmentDto): Promise<NormalizedShipmentResponse>;
  trackShipment(awbNumber: string): Promise<NormalizedTrackingResponse>;
  cancelShipment(awbNumber: string): Promise<NormalizedCancelResponse>;
}
```

### 2.2 Dynamic Registration via `CourierRegistry`
Located at `src/couriers/courier.registry.ts`:

* Implements the **Strategy + Factory** pattern.
* Maintains a registry `Map<string, ICourierAdapter>`.
* Courier adapters register themselves during NestJS initialization (`onModuleInit` or constructor injection).
* `getAdapter(courierPartner: string): ICourierAdapter` returns the registered adapter or throws an `UnknownCourierException` containing the sorted list of supported couriers.

---

## 3. Normalized API Contracts & Unified DTOs

### 3.1 Endpoints
* `POST /api/v1/orders` - Create single shipment (HTTP 201).
* `GET /api/v1/orders/:order_id/track` - Fetch status & travel history (HTTP 200).
* `POST /api/v1/orders/:order_id/cancel` - Cancel shipment before pickup (HTTP 200).
* `POST /api/v1/orders/bulk` - Batch create up to 100 shipments (HTTP 202 Accepted).
* `GET /api/v1/orders/bulk/:batch_id` - Poll batch progress and item outcomes (HTTP 200).

### 3.2 Unified Create Order Request (`POST /api/v1/orders`)
```json
{
  "order_id": "ORD-2026-9901",
  "courier_partner": "urbanebolt",
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
}
```

### 3.3 Standard Response Envelope
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "urbanebolt",
    "courier_order_id": "UATTESTUEBCUS0018",
    "awb_number": "200000001170",
    "status": "CREATED",
    "created_at": "2026-09-29T14:00:00.000Z"
  }
}
```

### 3.4 Unified Tracking Response (`GET /api/v1/orders/:order_id/track`)
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "urbanebolt",
    "awb_number": "200000001170",
    "current_status": "IN_TRANSIT",
    "history": [
      {
        "status": "CREATED",
        "location": "Govindpura",
        "timestamp": "2026-09-29T10:00:00.000Z",
        "description": "Shipment manifest created"
      },
      {
        "status": "IN_TRANSIT",
        "location": "Central Sorting Hub",
        "timestamp": "2026-09-29T13:30:00.000Z",
        "description": "Dispatched to destination hub"
      }
    ]
  }
}
```

### 3.5 Unified Cancellation Response (`POST /api/v1/orders/:order_id/cancel`)
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-2026-9901",
    "courier_partner": "urbanebolt",
    "awb_number": "200000001170",
    "status": "CANCELLED",
    "cancelled_at": "2026-09-29T14:10:00.000Z",
    "message": "Shipment cancelled successfully"
  }
}
```

### 3.6 Normalized Error Shape (All Endpoints)
```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_COURIER",
    "message": "Courier partner 'fedex' is not supported.",
    "details": {
      "supported_couriers": ["mock_courier", "urbanebolt"]
    },
    "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "timestamp": "2026-09-29T14:00:00.000Z"
  }
}
```

---

## 4. Database Schema & Audit Persistence (Prisma + PostgreSQL)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum ShipmentStatus {
  CREATED
  PICKED_UP
  IN_TRANSIT
  DELIVERED
  CANCELLED
  FAILED
}

enum BatchStatus {
  PENDING
  PROCESSING
  COMPLETED
}

model Order {
  id                  String           @id @default(uuid())
  orderId             String           @unique
  courierPartner      String
  courierShipmentId   String?
  awbNumber           String?          @unique
  status              ShipmentStatus   @default(CREATED)
  
  // Normalized consumer payload
  clientPayload       Json
  
  // Third-party audit trail
  courierRawRequest   Json?
  courierRawResponse  Json?
  failureReason       String?
  
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  trackingHistory     TrackingHistory[]

  @@index([orderId])
  @@index([awbNumber])
  @@index([courierPartner, status])
}

model TrackingHistory {
  id              String         @id @default(uuid())
  orderId         String
  awbNumber       String
  status          ShipmentStatus
  statusDetails   String?
  location        String?
  rawPayload      Json
  recordedAt      DateTime       @default(now())

  order           Order          @relation(fields: [orderId], references: [orderId], onDelete: Cascade)

  @@index([orderId])
  @@index([awbNumber])
}

model BulkBatch {
  id             String          @id @default(uuid())
  totalOrders    Int
  succeededCount Int             @default(0)
  failedCount    Int             @default(0)
  status         BatchStatus     @default(PENDING)
  createdAt      DateTime        @default(now())
  completedAt    DateTime?

  items          BulkBatchItem[]
}

model BulkBatchItem {
  id             String          @id @default(uuid())
  batchId        String
  orderId        String
  courierPartner String
  status         String          // PENDING, SUCCESS, FAILED
  awbNumber      String?
  errorReason    String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  batch          BulkBatch       @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@index([batchId])
  @@index([orderId])
}
```

---

## 5. Bulk Order Processing & Concurrency Engine

### Ingestion & Worker Design
1. **Validation**: Rejects batch if payload contains 0 or >100 orders (HTTP 400).
2. **Immediate 202 Response**: Inserts `BulkBatch` record and pending `BulkBatchItem` records in PostgreSQL. Returns `batch_id` and polling URL immediately (< 50ms).
3. **Bounded Concurrency Execution**: Background runner dispatches order creation using a bounded concurrency queue (`p-limit` / worker pool with configurable `CONCURRENCY_LIMIT=10`).
   - Prevents socket exhaustion and partner rate limits (HTTP 429).
   - Finishes 100 orders in ~5-7 seconds.
4. **Idempotency on `order_id`**: For each item in the batch, checks if `order_id` already exists:
   - If exists, retrieves existing shipment record, updates batch item as `SUCCESS (ALREADY_CREATED)` with existing `awbNumber`, and avoids duplicate third-party calls.
5. **Partial Success Isolation**: Failures in individual orders (e.g., invalid phone or partner timeout) are isolated, marked as `FAILED` with specific `error_reason`, and do not impede the rest of the batch.
6. **Batch Status Polling**: `GET /api/v1/orders/bulk/:batch_id` returns batch state, aggregate counts (`totalOrders`, `succeededCount`, `failedCount`), and detailed results.

---

## 6. Resilience, Error Handling & Courier Adaptations

### 6.1 UrbaneBolt Adapter Integration Details
* **Base URL**: `https://uat.urbanebolt.in/api/v1`
* **Authentication**: `POST /auth/getToken/` with `username` and `password`. Returns bearer token.
* **Shipment Manifest**: `POST /services/manifest/`. Translates normalized DTO to UrbaneBolt's customer manifest array.
* **Tracking**: `GET /services/tracking-pub/?awb={awbNumber}`. Maps vendor status events to normalized `ShipmentStatus`.
* **Cancellation**: `POST /services/cancel/` with `{ "awbs": "{awbNumber}" }`.

### 6.2 Token Caching & Automatic Re-authentication
* Bearer token is cached in memory.
* If a request receives HTTP 401 Unauthorized:
  - Cache is invalidated.
  - A mutex ensures only a single in-flight token refresh occurs.
  - The failed request is retried once with the new bearer token.

### 6.3 Exponential Backoff Retries
* Configurable parameters:
  - `COURIER_MAX_RETRIES`: default 3
  - `COURIER_INITIAL_BACKOFF_MS`: default 500ms
  - `COURIER_BACKOFF_FACTOR`: default 2
  - `COURIER_TIMEOUT_MS`: default 10000ms
* Applied exclusively to transient errors (HTTP 5xx, timeouts, network connection drops).
* 4xx client errors are never retried.

### 6.4 Bonus MockCourier Adapter
* Implements `ICourierAdapter` with `courierPartnerId = 'mock_courier'`.
* Generates simulated AWB numbers (`MC-XXXXXX`), supports deterministic status progression, and simulates edge cases (such as intentional failure triggers for testing) without hitting external networks.

---

## 7. Testing & Quality Assurance Plan

1. **Unit Tests**:
   - `CourierRegistry`: registration, lookup, exception on unknown courier.
   - `UrbaneBoltAdapter`: payload transformation, response mapping, error sanitization.
   - `MockCourierAdapter`: deterministic responses and failure simulation.
   - `ResilienceInterceptor`: token re-auth, retry on 5xx, non-retry on 4xx.
2. **Integration & Concurrency Tests**:
   - `OrdersService`: order creation, idempotency, append-only history.
   - `BulkOrdersService`: 100-order batch concurrency limit, multi-courier batches, partial failure accounting.
3. **E2E API Tests (Supertest)**:
   - Full controller-to-database integration tests covering all 5 REST endpoints.
