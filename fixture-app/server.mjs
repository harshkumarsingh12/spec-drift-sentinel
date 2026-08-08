import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Demo fixture — a deliberately tiny cart API.
 *
 * This is not part of Spec Drift Sentinel. It exists so the tool has a real
 * application whose tests can be made to fail on demand, which is the only way
 * to demonstrate what the tool actually does.
 *
 * The two constants below are the whole point. Break the calculation and the
 * tool should call it a regression. Change the threshold here AND in
 * spec/PRD.md together, and the tool should call it an authorised change.
 *
 * Keep this file small. It is a stage prop.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3100);

/** @covers AC-8 — the value changed live during the demo. */
const FREE_SHIPPING_THRESHOLD = 500;

/** @covers AC-7 */
const STANDARD_SHIPPING_FEE = 4.99;

/** Round to two decimal places without floating-point drift showing up. */
function money(value) {
  return Math.round(value * 100) / 100;
}

export function shippingFeeFor(subtotal) {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_FEE;
}

export function quote(subtotal) {
  const shippingFee = shippingFeeFor(subtotal);
  return {
    subtotal: money(subtotal),
    shippingFee: money(shippingFee),
    total: money(subtotal + shippingFee),
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/api/cart') {
    const subtotal = Number(url.searchParams.get('subtotal'));
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      return json(res, 400, { error: 'subtotal must be a non-negative number' });
    }
    return json(res, 200, quote(subtotal));
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const body = await readBody(req);
    const subtotal = Number(body?.subtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      return json(res, 400, { error: 'subtotal must be a non-negative number' });
    }
    const { total } = quote(subtotal);
    return json(res, 201, { id: `order-${Date.now()}`, subtotal: money(subtotal), total });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = readFileSync(join(HERE, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`fixture-app listening on http://localhost:${PORT}`);
});
