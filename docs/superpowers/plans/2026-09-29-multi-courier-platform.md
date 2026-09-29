# Multi-Courier Integration Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade, pluggable multi-courier logistics integration platform in NestJS/TypeScript with UrbaneBolt UAT integration, a bonus MockCourier adapter, Prisma/PostgreSQL persistence, and asynchronous bulk processing with bounded concurrency.

**Architecture:** Hexagonal / Clean Architecture with Strategy + Registry Factory pattern. Inversion of control enables adding new couriers with zero changes to controllers, routes, DTOs, or existing services. Asynchronous bounded concurrency worker pool processes up to 100 bulk orders with idempotency and partial success isolation.

**Tech Stack:** NestJS, TypeScript, Prisma ORM, PostgreSQL (Docker Compose), Axios, class-validator, class-transformer, Jest, Supertest.

**Spec:** [`docs/superpowers/specs/2026-09-29-multi-courier-platform-design.md`](file:///Users/siteshjha/Desktop/projects/interview/multi-courier-integration/docs/superpowers/specs/2026-09-29-multi-courier-platform-design.md)

## Global Constraints

- Adding a new courier partner MUST NOT require modifying controllers, routes, unified DTOs, or existing courier implementations.
- Every endpoint must consume and produce normalized, courier-agnostic schemas without leaking third-party vendor internals.
- Every order and courier request/response payload must be persisted in PostgreSQL for auditability.
- Tracking history must be recorded in an append-only table.
- Bulk endpoint must accept up to 100 orders, return HTTP 202 immediately with `batch_id`, execute concurrently via a bounded worker pool (limit=10), and guarantee idempotency on `order_id`.
- All timeouts, retry counts, base URLs, and credentials must be configuration-driven via environment variables.

## Review Focus

1. Duplicate `order_id` in single or bulk requests must return existing order details idempotently without creating duplicate shipments on the courier.
2. Request with an unsupported `courier_partner` must return HTTP 400 with a clear error payload listing all currently supported couriers.
3. Expired bearer token (HTTP 401) during courier operations must trigger a single-flight token refresh and one retry without failing client requests.
4. Transient courier failures (HTTP 5xx or network timeouts) must retry with exponential backoff and fail gracefully as `FAILED` in the database upon retry exhaustion.
5. In bulk batches containing both valid and invalid orders (or different couriers), individual failures must be isolated so valid orders succeed.

---

### Task 1: Project Scaffolding, Configuration & Docker Infrastructure

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `nest-cli.json`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `Dockerfile`
- Create: `.gitignore`
- Test: `test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: Node.js 18+, Docker, npm
- Produces: Runnable NestJS boilerplate with ConfigModule validating required environment variables (`PORT`, `DATABASE_URL`, `URBANEBOLT_BASE_URL`, `URBANEBOLT_USERNAME`, `URBANEBOLT_PASSWORD`, `COURIER_MAX_RETRIES`, `COURIER_INITIAL_BACKOFF_MS`, `COURIER_TIMEOUT_MS`, `BULK_CONCURRENCY_LIMIT`).

- [ ] **Step 1: Write `package.json` and install dependencies**
Dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `class-validator`, `class-transformer`, `axios`, `uuid`, `@prisma/client`, `p-limit`.
Dev dependencies: `@nestjs/cli`, `@nestjs/testing`, `typescript`, `@types/node`, `@types/express`, `@types/jest`, `@types/uuid`, `jest`, `ts-jest`, `supertest`, `@types/supertest`, `prisma`.

- [ ] **Step 2: Create TypeScript, Nest CLI, Docker, and Environment configuration files**
Configure `tsconfig.json`, `nest-cli.json`, `.gitignore`, `docker-compose.yml` (PostgreSQL service + app service), and `.env.example`.

- [ ] **Step 3: Run package installation and build verification**
Run: `npm install && npm run build`
Expected: Build succeeds, outputs to `dist/`.

- [ ] **Step 4: Commit**
```bash
git add package.json tsconfig.json tsconfig.build.json nest-cli.json .env.example docker-compose.yml Dockerfile .gitignore
git commit -m "chore: scaffold NestJS project with TypeScript and Docker Compose"
```

---

### Task 2: Database Schema & Prisma ORM Layer

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`
- Test: `src/prisma/prisma.service.spec.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` environment variable
- Produces: `PrismaService` providing typed client access to `Order`, `TrackingHistory`, `BulkBatch`, and `BulkBatchItem` models.

- [ ] **Step 1: Write Prisma schema with Enums and Models**
Define `ShipmentStatus` (`CREATED`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, `CANCELLED`, `FAILED`), `BatchStatus` (`PENDING`, `PROCESSING`, `COMPLETED`), `Order`, `TrackingHistory`, `BulkBatch`, `BulkBatchItem` matching the spec.

- [ ] **Step 2: Write test for PrismaService instantiation and lifecycle**
Assert `PrismaService` connects and disconnects on module init and destroy.

- [ ] **Step 3: Generate Prisma Client and implement PrismaService**
Run: `npx prisma generate`
Implement `src/prisma/prisma.service.ts` extending `PrismaClient` with `OnModuleInit` and `OnModuleDestroy`.

- [ ] **Step 4: Run Prisma test**
Run: `npx jest src/prisma/prisma.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add prisma/schema.prisma src/prisma/
git commit -m "feat: setup Prisma ORM schema and database service"
```

---

### Task 3: Unified DTOs, Error Handling & Request Tracing

**Files:**
- Create: `src/common/dto/create-order.dto.ts`
- Create: `src/common/dto/api-response.dto.ts`
- Create: `src/common/dto/bulk-order.dto.ts`
- Create: `src/common/exceptions/courier.exceptions.ts`
- Create: `src/common/filters/http-exception.filter.ts`
- Create: `src/common/middleware/request-id.middleware.ts`
- Test: `src/common/filters/http-exception.filter.spec.ts`
- Test: `src/common/dto/create-order.dto.spec.ts`

**Interfaces:**
- Consumes: `class-validator`, `class-transformer`
- Produces:
  - `CreateOrderDto`, `BulkCreateOrderDto`
  - `NormalizedApiResponse<T>`, `NormalizedApiError`
  - `UnknownCourierException`, `CourierClientException`, `CourierServerException`
  - `HttpExceptionFilter` producing normalized `{ success: false, error: { code, message, details, request_id, timestamp } }`

- [ ] **Step 1: Write failing tests for DTO validation and Exception Filter**
Test that invalid payloads produce structured field errors, unknown courier exception formats list of supported couriers, and all responses carry `request_id`.

- [ ] **Step 2: Run tests to verify failure**
Run: `npx jest src/common/`
Expected: FAIL (modules not implemented)

- [ ] **Step 3: Implement Unified DTOs, Exceptions, Middleware, and Exception Filter**
Implement `CreateOrderDto`, `BulkCreateOrderDto`, custom exceptions, `RequestIdMiddleware`, and `HttpExceptionFilter`.

- [ ] **Step 4: Run tests to verify pass**
Run: `npx jest src/common/`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/common/
git commit -m "feat: add normalized DTOs, error filters, and request tracing"
```

---

### Task 4: Pluggable Courier Architecture & Courier Registry

**Files:**
- Create: `src/couriers/interfaces/courier-adapter.interface.ts`
- Create: `src/couriers/courier.registry.ts`
- Create: `src/couriers/couriers.module.ts`
- Test: `src/couriers/courier.registry.spec.ts`

**Interfaces:**
- Consumes: `NormalizedCreateShipmentDto`, `NormalizedShipmentResponse`, `NormalizedTrackingResponse`, `NormalizedCancelResponse`
- Produces: `CourierRegistry` with:
  - `register(adapter: ICourierAdapter): void`
  - `getAdapter(courierPartner: string): ICourierAdapter`
  - `getSupportedCouriers(): string[]`

- [ ] **Step 1: Write failing unit test for `CourierRegistry`**
Verify:
1. Adapter can be registered and retrieved by `courierPartnerId`.
2. Calling `getAdapter("unknown")` throws `UnknownCourierException` containing the array of supported courier names.
3. List of supported couriers is returned alphabetically.

- [ ] **Step 2: Run test to verify failure**
Run: `npx jest src/couriers/courier.registry.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `ICourierAdapter` and `CourierRegistry`**
Implement interface and registry class with thread-safe `Map<string, ICourierAdapter>`.

- [ ] **Step 4: Run test to verify pass**
Run: `npx jest src/couriers/courier.registry.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/couriers/
git commit -m "feat: implement pluggable courier interface and registry factory"
```

---

### Task 5: HTTP Resilience & Exponential Backoff Retry Engine

**Files:**
- Create: `src/couriers/http/resilience-http.service.ts`
- Test: `src/couriers/http/resilience-http.service.spec.ts`

**Interfaces:**
- Consumes: Axios, NestJS ConfigService
- Produces: `ResilienceHttpService` with:
  - Exponential backoff retry on transient 5xx errors and network timeouts.
  - Automatic re-authentication on 401 with mutex lock (preventing parallel stampedes).
  - Sanitization of 4xx responses without leaking raw vendor error strings.

- [ ] **Step 1: Write failing unit tests for `ResilienceHttpService`**
Verify:
1. 500 error retries `COURIER_MAX_RETRIES` times with exponential delay then throws `CourierServerException`.
2. 401 error invokes `onTokenExpired()` callback, updates bearer token, and retries request successfully once.
3. Concurrent 401 errors share the single in-flight token refresh promise.
4. 400/404/422 error immediately throws `CourierClientException` without retrying.

- [ ] **Step 2: Run tests to verify failure**
Run: `npx jest src/couriers/http/resilience-http.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `ResilienceHttpService`**
Implement Axios wrapper with interceptors, backoff calculation (`delay = initialDelay * (factor ^ attempt)`), and token refresh mutex.

- [ ] **Step 4: Run tests to verify pass**
Run: `npx jest src/couriers/http/resilience-http.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/couriers/http/
git commit -m "feat: add HTTP resilience engine with backoff retries and token refresh mutex"
```

---

### Task 6: Concrete Courier Adapters (UrbaneBolt & MockCourier)

**Files:**
- Create: `src/couriers/adapters/urbanebolt/urbanebolt.adapter.ts`
- Create: `src/couriers/adapters/mock/mock.adapter.ts`
- Modify: `src/couriers/couriers.module.ts`
- Test: `src/couriers/adapters/urbanebolt/urbanebolt.adapter.spec.ts`
- Test: `src/couriers/adapters/mock/mock.adapter.spec.ts`

**Interfaces:**
- Consumes: `ICourierAdapter`, `ResilienceHttpService`, `ConfigService`
- Produces:
  - `UrbaneBoltAdapter` (`courierPartnerId = 'urbanebolt'`) calling UrbaneBolt UAT APIs.
  - `MockCourierAdapter` (`courierPartnerId = 'mock_courier'`) for zero-network testing and pluggability proof.

- [ ] **Step 1: Write failing unit tests for `MockCourierAdapter` and `UrbaneBoltAdapter`**
Assert schema mapping:
- `UrbaneBoltAdapter` maps normalized `CreateOrderDto` to UrbaneBolt manifest structure, maps tracking response to normalized status, and handles cancellation.
- `MockCourierAdapter` generates deterministic AWB (`MC-...`), returns valid tracking states, and succeeds/fails based on order payload.

- [ ] **Step 2: Run tests to verify failure**
Run: `npx jest src/couriers/adapters/`
Expected: FAIL

- [ ] **Step 3: Implement `MockCourierAdapter` and `UrbaneBoltAdapter`**
Implement adapters and register them into `CourierRegistry` inside `CouriersModule.onModuleInit()`.

- [ ] **Step 4: Run tests to verify pass**
Run: `npx jest src/couriers/adapters/`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/couriers/adapters/ src/couriers/couriers.module.ts
git commit -m "feat: implement UrbaneBolt UAT adapter and MockCourier pluggable adapter"
```

---

### Task 7: Order Management Service & Single Order Endpoints

**Files:**
- Create: `src/orders/orders.service.ts`
- Create: `src/orders/orders.controller.ts`
- Create: `src/orders/orders.module.ts`
- Test: `src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `CourierRegistry`
- Produces:
  - `POST /api/v1/orders` (Idempotent single order creation)
  - `GET /api/v1/orders/:order_id/track` (Normalized status + append-only tracking history)
  - `POST /api/v1/orders/:order_id/cancel` (Cancellation)

- [ ] **Step 1: Write failing tests for `OrdersService`**
Verify:
1. `createOrder`: Calls courier adapter, persists order with raw audit payloads, returns normalized envelope.
2. Idempotency: Submitting the same `order_id` twice returns the existing order record without calling the courier again.
3. `trackOrder`: Queries courier, appends a new row to `TrackingHistory`, updates order status in DB.
4. `cancelOrder`: Cancels with courier, updates order status to `CANCELLED`.

- [ ] **Step 2: Run tests to verify failure**
Run: `npx jest src/orders/orders.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `OrdersService` and `OrdersController`**
Implement business logic, DB audit logging, and controller endpoints.

- [ ] **Step 4: Run tests to verify pass**
Run: `npx jest src/orders/orders.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/orders/
git commit -m "feat: implement OrdersService and single order endpoints with idempotency"
```

---

### Task 8: Bulk Order Processing Engine & Polling Endpoints

**Files:**
- Create: `src/bulk/bulk-orders.service.ts`
- Create: `src/bulk/bulk-orders.controller.ts`
- Create: `src/bulk/bulk.module.ts`
- Test: `src/bulk/bulk-orders.service.spec.ts`

**Interfaces:**
- Consumes: `OrdersService`, `PrismaService`, `p-limit`
- Produces:
  - `POST /api/v1/orders/bulk` (HTTP 202 with `batch_id`)
  - `GET /api/v1/orders/bulk/:batch_id` (Polling progress, counts, results)
  - Bounded concurrency worker pool (concurrency = 10)

- [ ] **Step 1: Write failing tests for `BulkOrdersService`**
Verify:
1. Ingestion: Generates `batch_id`, returns 202 immediately.
2. Concurrency: 100 orders executed with max 10 concurrent promises.
3. Multi-courier: Processes orders with mixed `courier_partner` in the same batch.
4. Partial success: If 95 succeed and 5 fail, batch completes with `succeeded_count=95`, `failed_count=5`, and individual reasons.
5. Idempotency: Duplicate `order_id` in batch reuses existing order record.

- [ ] **Step 2: Run tests to verify failure**
Run: `npx jest src/bulk/bulk-orders.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `BulkOrdersService` and `BulkOrdersController`**
Implement background worker pool with `p-limit`, batch tracking in `BulkBatch` / `BulkBatchItem`, and status polling endpoint.

- [ ] **Step 4: Run tests to verify pass**
Run: `npx jest src/bulk/bulk-orders.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/bulk/
git commit -m "feat: implement asynchronous bulk order processing engine and polling"
```

---

### Task 9: End-to-End API Integration Tests (Supertest)

**Files:**
- Create: `test/orders.e2e-spec.ts`
- Create: `test/bulk.e2e-spec.ts`
- Create: `test/test-utils.ts`
- Modify: `package.json` (test scripts)

**Interfaces:**
- Consumes: Full NestJS application, PrismaService, Supertest
- Produces: Automated HTTP E2E tests validating all 5 endpoints.

- [ ] **Step 1: Write E2E test cases**
Covers:
- `POST /api/v1/orders`: 201 Created (MockCourier & UrbaneBolt mocked), 400 Bad Request (validation errors with field paths), 400 Unknown Courier (with supported list).
- `GET /api/v1/orders/:order_id/track`: 200 with tracking history, 404 for non-existent order.
- `POST /api/v1/orders/:order_id/cancel`: 200 Cancelled, 404 for non-existent order.
- `POST /api/v1/orders/bulk`: 202 Accepted, >100 orders rejected with 400.
- `GET /api/v1/orders/bulk/:batch_id`: 200 with completed batch summary and item outcomes.

- [ ] **Step 2: Run E2E test suite**
Run: `npm run test:e2e`
Expected: PASS (All endpoints pass verification)

- [ ] **Step 3: Commit**
```bash
git add test/ package.json
git commit -m "test: add comprehensive end-to-end API test suites"
```

---

### Task 10: Deliverables, Documentation & Postman Collection

**Files:**
- Create: `DESIGN.md`
- Create: `README.md`
- Create: `postman/multi-courier-api.postman_collection.json`
- Create: `postman/multi-courier.env.json`

**Interfaces:**
- Consumes: Working application, API specifications
- Produces:
  - `DESIGN.md`: 1–2 page architecture doc detailing Strategy + Factory pattern, DB schema, concurrency model, and trade-offs.
  - `README.md`: Setup steps, Docker usage, env vars, test execution commands, and step-by-step onboarding guide for a new courier partner.
  - Postman Collection: Ready-to-import collection with environment variables and sample cURL requests for all endpoints.

- [ ] **Step 1: Write `DESIGN.md`**
Detail architecture diagrams, design patterns (Strategy, Factory, Open-Closed), persistence model, concurrency design, resilience mechanisms, and trade-offs.

- [ ] **Step 2: Write `README.md`**
Provide clear setup, Docker Compose commands, environment variable descriptions, test execution instructions, and a concrete code tutorial on how to add a 3rd courier (e.g. `DelhiveryAdapter`).

- [ ] **Step 3: Create Postman collection and environment files**
Export complete Postman JSON collection with sample payloads for single orders, bulk orders (100 items), tracking, cancellation, and error cases.

- [ ] **Step 4: Verify test suite & linting**
Run: `npm run lint && npm test && npm run test:e2e`
Expected: 100% tests pass, zero lint errors.

- [ ] **Step 5: Commit**
```bash
git add DESIGN.md README.md postman/
git commit -m "docs: add DESIGN.md, README.md, and Postman collection deliverables"
```
