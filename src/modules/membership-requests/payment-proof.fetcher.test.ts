import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { HttpPaymentProofFetcher, PaymentProofFetchFailure } from './payment-proof.fetcher.js';

const config = (overrides: Partial<PaymentProofConfig> = {}): PaymentProofConfig => ({
  enabled: true,
  allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
  bucket: 'yc-fitness-uat',
  keyPrefix: 'payment-attachments/',
  maxBytes: 16,
  maxPixels: 40_000_000,
  timeoutMs: 100,
  ...overrides,
});
const trustedUrl = 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png';

const expectFailure = async (promise: Promise<unknown>, kind: string) => {
  await expect(promise).rejects.toMatchObject({ name: 'PaymentProofFetchFailure', kind });
};

describe('HTTP payment proof fetcher', () => {
  it('uses one bounded GET with manual redirects and identity encoding', async () => {
    const implementation = vi.fn(async () => new Response(Buffer.from('png'), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } })) as unknown as typeof fetch;
    const result = await new HttpPaymentProofFetcher(config(), implementation).fetch(trustedUrl);
    expect(result).toEqual({ bytes: Buffer.from('png'), mediaType: 'image/png' });
    expect(implementation).toHaveBeenCalledTimes(1);
    expect(implementation).toHaveBeenCalledWith(trustedUrl, expect.objectContaining({ method: 'GET', redirect: 'manual', headers: { 'accept-encoding': 'identity' } }));
  });

  it.each([301, 302, 307, 308, 404, 500])('rejects upstream status %s without retrying', async (status) => {
    const implementation = vi.fn(async () => new Response(null, { status, headers: { location: 'http://127.0.0.1/private' } })) as unknown as typeof fetch;
    await expectFailure(new HttpPaymentProofFetcher(config(), implementation).fetch(trustedUrl), 'UPSTREAM');
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized declared and streamed bodies', async () => {
    const declared = vi.fn(async () => new Response(Buffer.from('small'), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '17' } })) as unknown as typeof fetch;
    await expectFailure(new HttpPaymentProofFetcher(config(), declared).fetch(trustedUrl), 'TOO_LARGE');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    const streamed = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '1' } })) as unknown as typeof fetch;
    await expectFailure(new HttpPaymentProofFetcher(config(), streamed).fetch(trustedUrl), 'TOO_LARGE');
  });

  it.each([
    { headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' },
    { headers: { 'content-type': 'text/html' }, body: '<html/>' },
    { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' }, body: 'compressed' },
    { headers: { 'content-type': 'image/png', 'content-length': 'invalid' }, body: 'x' },
  ])('rejects invalid headers and compressed content', async ({ headers, body }) => {
    const implementation = vi.fn(async () => new Response(body, { status: 200, headers })) as unknown as typeof fetch;
    await expectFailure(new HttpPaymentProofFetcher(config(), implementation).fetch(trustedUrl), 'INVALID_CONTENT');
  });

  it('maps an aborted request to a stable timeout without retrying', async () => {
    const implementation = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as unknown as typeof fetch;
    await expectFailure(new HttpPaymentProofFetcher(config({ timeoutMs: 10 }), implementation).fetch(trustedUrl), 'TIMEOUT');
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it('does not expose the target through its stable failures', () => {
    const failure = new PaymentProofFetchFailure('UPSTREAM');
    expect(failure.message).not.toContain('digitaloceanspaces');
    expect(JSON.stringify(failure)).not.toContain(trustedUrl);
  });
});
