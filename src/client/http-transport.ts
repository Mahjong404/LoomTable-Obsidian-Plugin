MethodException: 
Line |
   2 |  … t.ts' -Raw; $c = $c.Replace([char]13 + [char]10, [char]10).Replace([c …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot convert argument "oldChar", with value: "
", for "Replace" to type "System.Char": "Cannot convert value "
" to type "System.Char". Error: "String must be exactly one character long.""
export interface HttpTransportRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
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

