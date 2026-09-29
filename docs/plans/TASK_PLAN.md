# Task Plan: Multi-Courier Integration Platform

## Acceptance Criteria & Edge Cases

### 1. Unified REST API
- [ ] `POST /api/v1/orders` accepts unified schema, delegates to courier partner adapter, and returns standard envelope.
- [ ] `GET /api/v1/orders/:order_id/track` returns normalized status and append-only travel history.
- [ ] `POST /api/v1/orders/:order_id/cancel` cancels order via courier partner and updates status to `CANCELLED`.
- [ ] `POST /api/v1/orders/bulk` accepts up to 100 orders, returns HTTP 202 with `batch_id` and initial status.
- [ ] `GET /api/v1/orders/bulk/:batch_id` returns batch progress, summary counts, and item-level outcomes.

### 2. Pluggable Architecture
- [ ] `ICourierAdapter` interface defines standard courier methods (`createShipment`, `trackShipment`, `cancelShipment`).
- [ ] `CourierRegistry` allows registering couriers without modifying controllers, DTOs, or existing services.
- [ ] Unknown `courier_partner` returns HTTP 400 with a list of currently supported couriers.
- [ ] `UrbaneBoltAdapter` correctly transforms data and communicates with UrbaneBolt UAT APIs.
- [ ] Bonus `MockCourierAdapter` demonstrates plug-and-play capability and supports offline testing.

### 3. Order & Tracking Persistence
- [ ] Orders persisted in PostgreSQL via Prisma with internal `orderId`, `courierPartner`, `courierShipmentId`, `awbNumber`, `status`, raw request/response audit payloads, and timestamps.
- [ ] `orderId` is unique and ensures idempotency: duplicate `orderId` submission does not trigger a duplicate courier request.
- [ ] `TrackingHistory` is append-only: every status inquiry records a timestamped raw snapshot.

### 4. Bulk Processing & Concurrency
- [ ] Bulk processing executes asynchronously via a bounded worker pool (concurrency limit = 10).
- [ ] Multi-courier support: a single batch can contain orders for different courier partners.
- [ ] Partial success: if some orders fail, successful orders complete normally and per-item results detail exact reasons.
- [ ] Reject bulk requests exceeding 100 orders with HTTP 400.

### 5. Error Handling & Resilience
- [ ] Field-level validation errors return HTTP 400 with field details.
- [ ] Courier 4xx errors sanitized into normalized errors without leaking raw third-party internals.
- [ ] Courier 5xx/network errors retry with configurable exponential backoff.
- [ ] Courier 401 triggers automatic re-authentication and single retry.
- [ ] All errors logged with `order_id`, `courier_partner`, `request_id`, error type, and stack trace.

---

## Step-by-Step Implementation Checklist

- [ ] **Phase 1: Project Scaffolding & Setup**
  - [ ] Initialize NestJS application with TypeScript, ESLint, and Prettier.
  - [ ] Configure Docker Compose (`docker-compose.yml`) with PostgreSQL and environment variables.
  - [ ] Configure Prisma ORM, create schema, and generate Prisma client.
  - [ ] Setup ConfigModule with validation for all environment variables.

- [ ] **Phase 2: Core Domain, DTOs & Pluggable Courier Architecture**
  - [ ] Define `ICourierAdapter` interface and normalized DTOs/types.
  - [ ] Implement `CourierRegistry` (Strategy + Factory pattern).
  - [ ] Implement unified DTO validation pipes with `class-validator` and `class-transformer`.
  - [ ] Implement custom exceptions and normalized `HttpExceptionFilter`.
  - [ ] Add `RequestIdMiddleware` for end-to-end request tracing.

- [ ] **Phase 3: Courier Adapters & Resilience**
  - [ ] Implement HTTP client wrapper with Axios interceptors (exponential backoff & retry).
  - [ ] Implement `UrbaneBoltAdapter` with token caching, auto re-authentication, manifest creation, tracking, and cancellation.
  - [ ] Implement `MockCourierAdapter` (Bonus) for deterministic testing and pluggability demonstration.
  - [ ] Write unit tests for `CourierRegistry`, `UrbaneBoltAdapter`, and `MockCourierAdapter`.

- [ ] **Phase 4: Order Service & Single Order Endpoints**
  - [ ] Implement `OrdersService` with idempotency and audit persistence.
  - [ ] Implement append-only `TrackingHistory` recording.
  - [ ] Implement `OrdersController` (`POST /orders`, `GET /orders/:order_id/track`, `POST /orders/:order_id/cancel`).
  - [ ] Write service unit and integration tests.

- [ ] **Phase 5: Bulk Order Processing Engine**
  - [ ] Implement `BulkOrdersService` with asynchronous bounded-concurrency worker pool.
  - [ ] Implement batch persistence (`BulkBatch` and `BulkBatchItem`).
  - [ ] Implement `POST /api/v1/orders/bulk` (HTTP 202) and `GET /api/v1/orders/bulk/:batch_id`.
  - [ ] Write concurrency and partial failure tests.

- [ ] **Phase 6: E2E Verification & Documentation Deliverables**
  - [ ] Write full E2E test suite covering all endpoints with Supertest.
  - [ ] Create `DESIGN.md` (1-2 pages explaining architecture, design patterns, schema, trade-offs).
  - [ ] Create `README.md` (setup steps, env vars, run, test, and guide for adding new courier).
  - [ ] Export Postman collection with curl examples (`postman/multi-courier-api.postman_collection.json`).
  - [ ] Run full test suite and confirm 100% pass state.
