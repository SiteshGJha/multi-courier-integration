export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  urbaneBolt: {
    baseUrl: process.env.URBANEBOLT_BASE_URL || 'https://uat.urbanebolt.in/api/v1',
    username: process.env.URBANEBOLT_USERNAME || 'info@urbanebolt.com',
    password: process.env.URBANEBOLT_PASSWORD || 'EKIcygsLVV5RCtPZ',
  },
  resilience: {
    maxRetries: parseInt(process.env.COURIER_MAX_RETRIES || '3', 10),
    initialBackoffMs: parseInt(process.env.COURIER_INITIAL_BACKOFF_MS || '500', 10),
    backoffFactor: parseInt(process.env.COURIER_BACKOFF_FACTOR || '2', 10),
    timeoutMs: parseInt(process.env.COURIER_TIMEOUT_MS || '10000', 10),
  },
  bulk: {
    concurrencyLimit: parseInt(process.env.BULK_CONCURRENCY_LIMIT || '10', 10),
  },
});
