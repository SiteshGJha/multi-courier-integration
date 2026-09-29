# Architecture & Design Document: Multi-Courier Integration Platform

## 1. Executive Summary

This document describes the architecture, design patterns, database schema, concurrency design, and operational trade-offs for the **Multi-Courier Integration Platform**. The service acts as a unified logistics gateway for internal e-commerce consumers (Order Management Systems, Warehouse Management Systems, and client frontends), exposing a normalized REST API while delegating fulfillment operations to pluggable courier partners.

---

## 2. Architectural Pattern: Strategy + Inversion-of-Control Registry Factory

To satisfy the primary non-negotiable requirement—**adding a new courier partner in the future requires minimal code changes and zero modifications to controllers, routes, DTOs, or existing services**—we implemented the **Strategy Pattern** combined with a decentralized **Registry Factory** (`CourierRegistry`).

```
                    ┌──────────────────────────────┐
                    │  Internal Consumers (OMS/UI) │
                    └──────────────┬───────────────┘
                                   │ Unified Agnostic REST Contract
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
                    │       CourierRegistry        │
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
   UrbaneBolt UAT Services                   In-Memory Simulated Gateway
```

### Why Strategy + Registry Factory?
1. **Open-Closed Principle (OCP)**: The core system is open for extension but closed for modification. Adding a new courier (e.g. `DelhiveryAdapter`) requires only creating the adapter file implementing `ICourierAdapter` and registering it in the NestJS dependency injection container.
2. **Normalized Boundary**: Neither database schemas nor API consumers know about vendor-specific field names (such as UrbaneBolt's `customerCode` or `rtnLat`). Each adapter acts as an anti-corruption layer.
3. **Pluggable Discovery**: If an unknown `courier_partner` identifier is supplied, `CourierRegistry.getAdapter()` throws an `UnknownCourierException` that generates an HTTP 400 error payload containing the active sorted list of supported courier names.

---

## 3. Database Schema & Persistence Design

The service uses **PostgreSQL** via **Prisma ORM**. The data model isolates shipment state, third-party audit payloads, tracking ledgers, and bulk batch lifecycle.

```
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│              Order              │           │         TrackingHistory         │
├─────────────────────────────────┤           ├─────────────────────────────────┤
│ id: String (UUID)               │1         *│ id: String (UUID)               │
│ orderId: String (UNIQUE)        │───────────│ orderId: String (FK)            │
│ courierPartner: String          │           │ awbNumber: String               │
│ courierShipmentId: String?      │           │ status: ShipmentStatus          │
│ awbNumber: String? (UNIQUE)     │           │ statusDetails: String?          │
│ status: ShipmentStatus          │           │ location: String?               │
│ clientPayload: Json             │           │ rawPayload: Json                │
│ courierRawRequest: Json?        │           │ recordedAt: DateTime            │
│ courierRawResponse: Json?       │           └─────────────────────────────────┘
│ failureReason: String?          │
│ createdAt: DateTime             │
│ updatedAt: DateTime             │
└─────────────────────────────────┘

┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│            BulkBatch            │           │          BulkBatchItem          │
├─────────────────────────────────┤           ├─────────────────────────────────┤
│ id: String (UUID)               │1         *│ id: String (UUID)               │
│ totalOrders: Int                │───────────│ batchId: String (FK)            │
│ succeededCount: Int             │           │ orderId: String                 │
│ failedCount: Int                │           │ courierPartner: String          │
│ status: BatchStatus             │           │ status: String (PENDING/...)    │
│ createdAt: DateTime             │           │ awbNumber: String?              │
│ completedAt: DateTime?          │           │ errorReason: String?            │
└─────────────────────────────────┘           │ createdAt / updatedAt: DateTime │
                                              └─────────────────────────────────┘
```

### Persistence Decisions & Highlights
* **Idempotency on `order_id`**: The `orderId` column has a `@unique` index. When an order creation request arrives, `OrdersService` checks whether an order with that ID already exists. If found, it immediately returns the existing shipment and AWB without generating duplicate third-party courier requests.
* **Auditability**: `courierRawRequest` and `courierRawResponse` preserve exact JSON payloads exchanged with third-party APIs for reconciliation and compliance.
* **Append-Only Tracking History**: Status checks never overwrite prior events. Each check appends a timestamped checkpoint to `TrackingHistory` alongside the raw courier status payload.

---

## 4. Bulk Processing Engine & Concurrency Model

### Requirements Addressed
* Accepts up to 100 orders in a single request (`POST /api/v1/orders/bulk`).
* Processes orders concurrently and asynchronously—never 100 sequential calls.
* Orders in a single batch can specify different courier partners.
* Partial success isolation (e.g. 95 succeed, 5 fail).
* Idempotent on `order_id`.
* Non-blocking responsive ingestion.

### Concurrency Design & Trade-offs
```
 Client (100 Orders)
         │  POST /api/v1/orders/bulk
         ▼
  OrdersController
         │ 1. Validate payload length (1 <= items <= 100)
         │ 2. Create BulkBatch + BulkBatchItems in DB (Status: PROCESSING)
         │ 3. Dispatch to background Concurrency Worker
         ▼
 Return HTTP 202 Accepted (< 50ms)
 {
   "batch_id": "b7132924-d2c6-4354-9457-41804f5e27a6",
   "status": "PROCESSING",
   "total_orders": 100,
   "poll_url": "/api/v1/orders/bulk/b7132924-d2c6-4354-9457-41804f5e27a6"
 }
         │
         ▼
 Background Worker (Bounded Concurrency Limit = 10)
 ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
 │Worker 1 │Worker 2 │Worker 3 │Worker 4 │Worker 5 │Worker 6 │Worker 7 │Worker 8 │Worker 9 │Worker 10│
 └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
         │
         ▼ (Processes 10 items in parallel; finishes 100 orders in ~5-7 seconds)
 Persist item status (SUCCESS / FAILED) -> Update Batch to COMPLETED
```

| Model Evaluated | Pros | Cons / Trade-offs | Decision |
|---|---|---|---|
| **Unbounded (`Promise.all`)** | Maximum theoretical speed | Floods courier partner with 100 simultaneous sockets, causing rate limits (HTTP 429) or socket drops. | Rejected |
| **Sequential Loop** | Simplest code | 100 orders × 500ms courier latency = 50+ seconds response time; violates non-blocking requirement. | Rejected |
| **Distributed Broker (RabbitMQ / BullMQ)** | Horizontal scaling across nodes | Heavy operational dependency (requires Redis/RabbitMQ cluster). Overkill for single service assignment. | Deferred |
| **Bounded Concurrency Semaphore (Pool = 10)** | Responsive ingestion (<50ms HTTP 202), throughput without rate limiting, self-contained. | Batch status requires polling (`GET /bulk/:id`). | **Adopted** |

---

## 5. Resilience & Error Handling Architecture

### 1. Token Caching & Automatic Re-authentication
* The bearer token for UrbaneBolt is cached in memory.
* When an HTTP 401 Unauthorized occurs:
  1. An in-flight promise mutex prevents concurrent requests from causing duplicate token refresh calls.
  2. The service requests a fresh token from `/auth/getToken/`.
  3. The original request is retried once with the fresh token.

### 2. Exponential Backoff Retries
* Transient failures (HTTP 5xx, socket timeouts, network drops) trigger retries using exponential backoff:
  $$\text{delay} = \text{initialBackoffMs} \times (\text{backoffFactor})^{\text{attempt} - 1}$$
* Fully configuration-driven: `COURIER_MAX_RETRIES=3`, `COURIER_INITIAL_BACKOFF_MS=500`, `COURIER_BACKOFF_FACTOR=2`.
* 4xx client errors are **never retried**.

### 3. Normalized Error Envelope
Raw third-party errors are never leaked to external clients. The global `HttpExceptionFilter` formats all exceptions:
```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_COURIER",
    "message": "Courier partner 'fedex' is not supported.",
    "details": {
      "supported_couriers": ["mock_courier", "urbanebolt"]
    },
    "request_id": "bfdb3753-7f07-4dea-99d1-b60d0ab5df1e",
    "timestamp": "2026-09-29T19:54:36.000Z"
  }
}
```
Every error is logged with structured metadata: `order_id`, `courier_partner`, `request_id`, error type, and stack trace.
