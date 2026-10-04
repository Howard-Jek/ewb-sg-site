// POST /api/forms — receives every form on the site (see public/assets/site.js)
// and stores it in Supabase. Needs SUPABASE_URL and SUPABASE_SECRET_KEY.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Submission } from '../lib/forms.js';
import { handleFormRequest, type FormStore } from '../lib/handler.js';

const TABLES = {
  newsletter: 'newsletter_subscribers',
  membership: 'membership_applications',
  donation: 'donations',
  contact: 'contact_messages',
} as const satisfies Record<Submission['kind'], string>;

let client: SupabaseClient | undefined;

function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

const store: FormStore = {
  async save({ kind, row }) {
    const table = db().from(TABLES[kind]);
    const values: Record<string, unknown> = row;
    const { error } =
      kind === 'newsletter'
        ? await table.upsert(values, { onConflict: 'email', ignoreDuplicates: true })
        : await table.insert(values);
    if (error) throw new Error(`${TABLES[kind]}: ${error.message}`);
  },
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function POST(request: Request): Promise<Response> {
  return handleFormRequest(request, store, { allowedOrigins });
}
