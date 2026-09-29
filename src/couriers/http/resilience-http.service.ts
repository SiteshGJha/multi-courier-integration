import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  CourierClientException,
  CourierServerException,
} from '../../common/exceptions/courier.exceptions';

export interface ExecuteRequestOptions {
  courierPartner: string;
  config: AxiosRequestConfig;
  onTokenRefresh?: () => Promise<string>;
}

@Injectable()
export class ResilienceHttpService {
  private readonly logger = new Logger(ResilienceHttpService.name);
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly timeoutMs: number;

  // Mutex for token refreshes per courier
  private refreshPromises = new Map<string, Promise<string>>();

  constructor(private readonly configService: ConfigService) {
    this.maxRetries = this.configService.get<number>('resilience.maxRetries') ?? 3;
    this.initialBackoffMs = this.configService.get<number>('resilience.initialBackoffMs') ?? 500;
    this.backoffFactor = this.configService.get<number>('resilience.backoffFactor') ?? 2;
    this.timeoutMs = this.configService.get<number>('resilience.timeoutMs') ?? 10000;

    this.client = axios.create({
      timeout: this.timeoutMs,
    });
  }

  async executeRequest<T = any>(options: ExecuteRequestOptions): Promise<AxiosResponse<T>> {
    const { courierPartner, config, onTokenRefresh } = options;
    let attempt = 0;
    let hasRefreshedToken = false;

    while (attempt <= this.maxRetries) {
      try {
        const response = await this.client.request<T>(config);
        return response;
      } catch (error: any) {
        const status = error.response?.status;
        const rawData = error.response?.data;

        // 1. Handle 401 Unauthorized with token refresh mutex
        if (status === 401 && onTokenRefresh && !hasRefreshedToken) {
          this.logger.warn(
            `[${courierPartner}] Received 401 Unauthorized. Attempting token refresh...`,
          );

          try {
            const newToken = await this.getOrCreateTokenRefresh(courierPartner, onTokenRefresh);
            hasRefreshedToken = true;

            // Update Authorization header for retry
            config.headers = config.headers || {};
            config.headers['Authorization'] = `Bearer ${newToken}`;

            // Retry request immediately with new token without incrementing backoff attempt
            continue;
          } catch (refreshError: any) {
            this.logger.error(
              `[${courierPartner}] Token refresh failed: ${refreshError.message}`,
            );
            throw new CourierServerException(
              courierPartner,
              'Courier authentication failed during automatic re-authentication.',
              refreshError,
            );
          }
        }

        // 2. Handle 4xx Client Errors (Do NOT retry)
        if (status && status >= 400 && status < 500) {
          const clientErrorMessage = this.extractClientErrorMessage(rawData, courierPartner);
          this.logger.warn(
            `[${courierPartner}] Client error ${status}: ${clientErrorMessage}`,
          );
          throw new CourierClientException(courierPartner, clientErrorMessage, rawData);
        }

        // 3. Handle Transient / 5xx / Network Errors with Exponential Backoff
        attempt++;
        if (attempt > this.maxRetries) {
          const failureReason = error.message || 'Courier partner service unavailable';
          this.logger.error(
            `[${courierPartner}] Retries exhausted (${this.maxRetries}). Final failure: ${failureReason}`,
          );
          throw new CourierServerException(
            courierPartner,
            `Courier partner failed after ${this.maxRetries} retries: ${failureReason}`,
            rawData || error.message,
          );
        }

        const delay = this.initialBackoffMs * Math.pow(this.backoffFactor, attempt - 1);
        this.logger.warn(
          `[${courierPartner}] Request failed (${error.message || status}). Retrying attempt ${attempt}/${this.maxRetries} after ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new CourierServerException(
      courierPartner,
      'Unexpected execution state in resilience HTTP client.',
    );
  }

  private async getOrCreateTokenRefresh(
    courierPartner: string,
    refreshFn: () => Promise<string>,
  ): Promise<string> {
    const existingPromise = this.refreshPromises.get(courierPartner);
    if (existingPromise) {
      return existingPromise;
    }

    const refreshPromise = (async () => {
      try {
        const token = await refreshFn();
        return token;
      } finally {
        this.refreshPromises.delete(courierPartner);
      }
    })();

    this.refreshPromises.set(courierPartner, refreshPromise);
    return refreshPromise;
  }

  private extractClientErrorMessage(data: any, courierPartner: string): string {
    if (!data) return `Courier ${courierPartner} rejected the request.`;
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      if (data.message && typeof data.message === 'string') return data.message;
      if (data.error && typeof data.error === 'string') return data.error;
      if (data.detail && typeof data.detail === 'string') return data.detail;
      if (Array.isArray(data) && data[0]?.message) return data[0].message;
    }
    return `Courier ${courierPartner} rejected request due to invalid parameters.`;
  }
}
