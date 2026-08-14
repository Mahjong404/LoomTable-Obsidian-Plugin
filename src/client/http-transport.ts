export interface HttpTransportRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | ArrayBuffer;
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bytes?: ArrayBuffer;
}

export type HttpTransport = (request: HttpTransportRequest) => Promise<HttpTransportResponse>;
