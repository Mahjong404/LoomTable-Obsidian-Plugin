export interface HttpTransportRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpTransport = (request: HttpTransportRequest) => Promise<HttpTransportResponse>;
