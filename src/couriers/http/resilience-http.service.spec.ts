import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResilienceHttpService } from './resilience-http.service';
import {
  CourierClientException,
  CourierServerException,
} from '../../common/exceptions/courier.exceptions';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ResilienceHttpService', () => {
  let service: ResilienceHttpService;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    mockAxiosInstance = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResilienceHttpService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'resilience.maxRetries') return 2;
              if (key === 'resilience.initialBackoffMs') return 10;
              if (key === 'resilience.backoffFactor') return 2;
              if (key === 'resilience.timeoutMs') return 1000;
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ResilienceHttpService>(ResilienceHttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully return data on HTTP 200 without retrying', async () => {
    mockAxiosInstance.request.mockResolvedValueOnce({
      status: 200,
      data: { success: true, manifestId: 'M123' },
    });

    const result = await service.executeRequest({
      courierPartner: 'urbanebolt',
      config: { url: '/test', method: 'POST' },
    });

    expect(result.data).toEqual({ success: true, manifestId: 'M123' });
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
  });

  it('should immediately throw CourierClientException on 4xx without retrying', async () => {
    const error400: any = new Error('Bad Request');
    error400.isAxiosError = true;
    error400.response = {
      status: 400,
      data: { error: 'Invalid pincode 999999' },
    };
    mockAxiosInstance.request.mockRejectedValueOnce(error400);

    await expect(
      service.executeRequest({
        courierPartner: 'urbanebolt',
        config: { url: '/test', method: 'POST' },
      }),
    ).rejects.toThrow(CourierClientException);

    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
  });

  it('should retry with exponential backoff on 500 error up to maxRetries, then throw CourierServerException', async () => {
    const error500: any = new Error('Internal Server Error');
    error500.isAxiosError = true;
    error500.response = {
      status: 500,
      data: { message: 'Database failure on courier side' },
    };
    mockAxiosInstance.request.mockRejectedValue(error500);

    await expect(
      service.executeRequest({
        courierPartner: 'urbanebolt',
        config: { url: '/test', method: 'POST' },
      }),
    ).rejects.toThrow(CourierServerException);

    // Initial attempt + 2 retries = 3 total attempts
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
  });

  it('should automatically refresh token on 401 and retry successfully', async () => {
    const error401: any = new Error('Unauthorized');
    error401.isAxiosError = true;
    error401.response = { status: 401, data: { message: 'Token expired' } };

    mockAxiosInstance.request
      .mockRejectedValueOnce(error401)
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const onTokenRefresh = jest.fn().mockResolvedValue('new-fresh-token-123');

    const result = await service.executeRequest({
      courierPartner: 'urbanebolt',
      config: { url: '/test', method: 'POST', headers: {} },
      onTokenRefresh,
    });

    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ ok: true });
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
  });

  it('should collapse concurrent 401 refreshes into a single refresh call', async () => {
    let refreshCount = 0;
    const onTokenRefresh = jest.fn().mockImplementation(async () => {
      refreshCount++;
      await new Promise((r) => setTimeout(r, 20));
      return 'shared-fresh-token';
    });

    const error401: any = new Error('Unauthorized');
    error401.isAxiosError = true;
    error401.response = { status: 401, data: { message: 'Token expired' } };

    // Initial requests both fail with 401
    mockAxiosInstance.request
      .mockRejectedValueOnce(error401)
      .mockRejectedValueOnce(error401)
      .mockResolvedValueOnce({ status: 200, data: { id: 1 } })
      .mockResolvedValueOnce({ status: 200, data: { id: 2 } });

    const [res1, res2] = await Promise.all([
      service.executeRequest({
        courierPartner: 'urbanebolt',
        config: { url: '/call1', method: 'GET', headers: {} },
        onTokenRefresh,
      }),
      service.executeRequest({
        courierPartner: 'urbanebolt',
        config: { url: '/call2', method: 'GET', headers: {} },
        onTokenRefresh,
      }),
    ]);

    expect(res1.data).toEqual({ id: 1 });
    expect(res2.data).toEqual({ id: 2 });
    expect(refreshCount).toBe(1);
  });
});
