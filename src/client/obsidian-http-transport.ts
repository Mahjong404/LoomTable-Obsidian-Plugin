import { requestUrl } from 'obsidian';

import type { HttpTransport } from './http-transport';

export const obsidianHttpTransport: HttpTransport = async (request) => {
  const response = await requestUrl({
    url: request.url,
    method: request.method,
    headers: { ...request.headers },
    ...(request.body === undefined ? {} : { body: request.body }),
    throw: false,
  });

  return {
    status: response.status,
    headers: response.headers,
    body: response.text,
    bytes: response.arrayBuffer,
  };
};
