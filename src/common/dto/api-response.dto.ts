export interface ApiErrorDetail {
  field?: string;
  issue: string;
  [key: string]: any;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: any;
  request_id: string;
  timestamp: string;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorPayload;
}
