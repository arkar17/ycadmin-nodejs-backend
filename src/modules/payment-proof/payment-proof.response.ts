import type { Response } from 'express';

export const sendPaymentProof = (response: Response, proof: Buffer): Response => response.status(200).set({
  'Content-Type': 'image/webp',
  'Content-Length': String(proof.length),
  'Content-Disposition': 'inline; filename="payment-proof.webp"',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Content-Security-Policy': "sandbox; default-src 'none'",
}).send(proof);
