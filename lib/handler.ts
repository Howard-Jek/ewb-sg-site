import { parseSubmission, type Submission } from './forms.js';

export interface FormStore {
  save(submission: Submission): Promise<void>;
}

export interface HandlerOptions {
  /** Extra origins allowed to post, e.g. the custom domain when it differs from the request host. */
  allowedOrigins?: string[];
}

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function fail(status: number, error: string): Response {
  return json(status, { ok: false, error });
}

/**
 * Only accept posts from pages on this site. Browsers always send Origin on a
 * fetch() POST, so a missing header means a non-browser client.
 */
function originAllowed(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return host === requestHost || allowed.includes(origin);
}

export async function handleFormRequest(
  request: Request,
  store: FormStore,
  { allowedOrigins = [] }: HandlerOptions = {},
): Promise<Response> {
  if (!originAllowed(request, allowedOrigins)) return fail(403, 'Forbidden.');

  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return fail(415, 'Expected JSON.');

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail(413, 'Submission too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail(413, 'Submission too large.');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'Invalid submission.');
  }

  const result = parseSubmission(body);
  if (!result.ok) {
    return json(400, { ok: false, error: 'Please check the highlighted fields.', fields: result.errors });
  }
  // Bots that fill the honeypot get the same response as people, so they don't adapt.
  if (result.spam) return json(201, { ok: true });

  try {
    await store.save(result.submission);
  } catch (err) {
    console.error(`Failed to save ${result.submission.kind} submission`, err);
    return fail(500, 'Sorry, something went wrong. Please email secretary@ewb.sg instead.');
  }
  return json(201, { ok: true });
}
