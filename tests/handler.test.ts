import { describe, expect, it, vi } from 'vitest';
import type { Submission } from '../lib/forms.js';
import { handleFormRequest, type FormStore } from '../lib/handler.js';

const HOST = 'ewb-sg-site.vercel.app';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}/api/forms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `https://${HOST}`, host: HOST, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function store(impl?: (s: Submission) => Promise<void>) {
  const saved: Submission[] = [];
  const s: FormStore = { save: vi.fn(impl ?? (async (sub: Submission) => void saved.push(sub))) };
  return { s, saved };
}

const newsletter = { _kind: 'newsletter', _page: '/', email: 'a@example.com' };

describe('handleFormRequest', () => {
  it('stores a valid submission and returns 201', async () => {
    const { s, saved } = store();
    const res = await handleFormRequest(post(newsletter), s);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(saved).toEqual([
      { kind: 'newsletter', row: { email: 'a@example.com', first_name: null, last_name: null, source_page: '/' } },
    ]);
  });

  it('returns field errors with 400 and stores nothing', async () => {
    const { s } = store();
    const res = await handleFormRequest(post({ _kind: 'newsletter', email: 'bad' }), s);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Please check the highlighted fields.',
      fields: { email: 'Enter a valid email address.' },
    });
    expect(s.save).not.toHaveBeenCalled();
  });

  it('pretends to accept honeypot spam but stores nothing', async () => {
    const { s } = store();
    const res = await handleFormRequest(post({ ...newsletter, website: 'x' }), s);
    expect(res.status).toBe(201);
    expect(s.save).not.toHaveBeenCalled();
  });

  it('rejects cross-site posts', async () => {
    const { s } = store();
    const res = await handleFormRequest(post(newsletter, { origin: 'https://evil.example' }), s);
    expect(res.status).toBe(403);
    expect(s.save).not.toHaveBeenCalled();
  });

  it('rejects posts with no Origin header', async () => {
    const { s } = store();
    const req = post(newsletter);
    const headers = new Headers(req.headers);
    headers.delete('origin');
    const res = await handleFormRequest(new Request(req, { headers }), s);
    expect(res.status).toBe(403);
  });

  it('accepts an origin from the allow-list (e.g. the custom domain)', async () => {
    const { s } = store();
    const res = await handleFormRequest(post(newsletter, { origin: 'https://www.ewb.sg' }), s, {
      allowedOrigins: ['https://www.ewb.sg'],
    });
    expect(res.status).toBe(201);
  });

  it('trusts x-forwarded-host when matching the origin', async () => {
    const { s } = store();
    const res = await handleFormRequest(
      post(newsletter, { host: 'internal:3000', 'x-forwarded-host': HOST }),
      s,
    );
    expect(res.status).toBe(201);
  });

  it('rejects non-JSON bodies', async () => {
    const { s } = store();
    expect((await handleFormRequest(post('email=a@b.co', { 'content-type': 'application/x-www-form-urlencoded' }), s)).status).toBe(415);
    expect((await handleFormRequest(post('{not json'), s)).status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const { s } = store();
    const res = await handleFormRequest(post({ ...newsletter, pad: 'x'.repeat(20_000) }), s);
    expect(res.status).toBe(413);
    expect(s.save).not.toHaveBeenCalled();
  });

  it('hides storage errors behind a generic 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { s } = store(async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await handleFormRequest(post(newsletter), s);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret_table');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('never caches responses', async () => {
    const { s } = store();
    const res = await handleFormRequest(post(newsletter), s);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
