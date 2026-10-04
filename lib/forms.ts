// Validation for the site's three forms. Field names match the `name`
// attributes in public/**/index.html; required fields match what the original
// Wix forms required. Rows map 1:1 onto the tables in supabase/migrations.

export const FORM_KINDS = ['newsletter', 'membership', 'donation', 'contact'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const QUALIFICATIONS = [
  'Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'PhD',
  'Professional Certification',
  'Others',
] as const;

export const DONATION_ON_BEHALF_OF = ['Myself', 'An organization', 'Someone else'] as const;

export const HONEYPOT_FIELD = 'website';

type Nullable<T> = { [K in keyof T]: T[K] | null };

export type NewsletterRow = { email: string } & Nullable<{
  first_name: string;
  last_name: string;
  source_page: string;
}>;

export type MembershipRow = { first_name: string; email: string } & Nullable<{
  last_name: string;
  phone: string;
  highest_qualification: string;
  qualification_title: string;
  company: string;
  position: string;
  contribution: string;
  source_page: string;
}>;

export type DonationRow = {
  first_name: string;
  last_name: string;
  email: string;
  on_behalf_of: string;
  honoree_name: string | null;
  /** Decimal string with two places, so no float rounding on the way to numeric(12,2). */
  amount_sgd: string;
  terms_accepted: true;
  source_page: string | null;
};

export type ContactRow = { email: string } & Nullable<{
  first_name: string;
  last_name: string;
  subject: string;
  message: string;
  source_page: string;
}>;

export type Submission =
  | { kind: 'newsletter'; row: NewsletterRow }
  | { kind: 'membership'; row: MembershipRow }
  | { kind: 'donation'; row: DonationRow }
  | { kind: 'contact'; row: ContactRow };

export type FieldErrors = Record<string, string>;

export type ParseResult =
  | { ok: true; spam: false; submission: Submission }
  | { ok: true; spam: true }
  | { ok: false; errors: FieldErrors };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^(?=(?:\D*\d){6})[0-9+()\-./\s]{6,40}$/;
const AMOUNT = /^\d{1,7}(?:\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000;

/** Reads one field, collecting an error instead of throwing. */
class Fields {
  readonly errors: FieldErrors = {};
  constructor(private readonly body: Record<string, unknown>) {}

  text(name: string, opts: { required?: boolean; max?: number } = {}): string | null {
    const { required = false, max = 200 } = opts;
    const raw = this.body[name];
    if (raw === undefined || raw === null || raw === '') return this.missing(name, required);
    if (typeof raw !== 'string') return this.fail(name, 'Invalid value.');
    const value = raw.trim();
    if (value === '') return this.missing(name, required);
    if (value.length > max) return this.fail(name, `Keep this under ${max} characters.`);
    return value;
  }

  email(name: string, required: boolean): string | null {
    const value = this.text(name, { required, max: 1000 });
    if (value === null) return null;
    if (value.length > 254 || !EMAIL.test(value)) return this.fail(name, 'Enter a valid email address.');
    return value.toLowerCase();
  }

  oneOf(name: string, options: readonly string[], required: boolean, message: string): string | null {
    const value = this.text(name, { required });
    if (value === null) return null;
    return options.includes(value) ? value : this.fail(name, message);
  }

  matching(name: string, pattern: RegExp, message: string): string | null {
    const value = this.text(name, { max: 40 });
    if (value === null) return null;
    return pattern.test(value) ? value : this.fail(name, message);
  }

  amount(name: string): string | null {
    const value = this.text(name, { required: true, max: 20 });
    if (value === null) return null;
    const n = Number(value);
    if (!AMOUNT.test(value) || !(n > 0) || n > MAX_AMOUNT) {
      return this.fail(name, 'Enter an amount in S$ between 0.01 and 1,000,000.');
    }
    return n.toFixed(2);
  }

  checked(name: string, message: string): true | null {
    const raw = this.body[name];
    if (raw === true || raw === 'on' || raw === 'true') return true;
    return this.fail(name, message);
  }

  /** Where the form was submitted from; only same-site paths are kept. */
  page(): string | null {
    const raw = this.body._page;
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 300) return null;
    return raw;
  }

  private missing(name: string, required: boolean): null {
    if (required) this.errors[name] = 'This field is required.';
    return null;
  }

  private fail(name: string, message: string): null {
    this.errors[name] = message;
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseSubmission(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, errors: { _form: 'Invalid submission.' } };

  const trap = body[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') return { ok: true, spam: true };

  const kind = body._kind;
  if (typeof kind !== 'string' || !(FORM_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, errors: { _kind: 'Unknown form.' } };
  }

  const f = new Fields(body);
  let submission: Submission;

  switch (kind as FormKind) {
    case 'newsletter':
      submission = {
        kind: 'newsletter',
        row: {
          email: f.email('email', true)!,
          first_name: f.text('first-name', { max: 100 }),
          last_name: f.text('last-name', { max: 100 }),
          source_page: f.page(),
        },
      };
      break;

    case 'membership':
      submission = {
        kind: 'membership',
        row: {
          first_name: f.text('first-name', { required: true, max: 100 })!,
          last_name: f.text('last-name', { max: 100 }),
          email: f.email('email', true)!,
          phone: f.matching('phone', PHONE, 'Enter a valid phone number.'),
          highest_qualification: f.oneOf(
            'qualification',
            QUALIFICATIONS,
            false,
            'Choose one of the listed qualifications.',
          ),
          qualification_title: f.text('qualification-title'),
          company: f.text('company'),
          position: f.text('position'),
          contribution: f.text('contribution', { max: 5000 }),
          source_page: f.page(),
        },
      };
      break;

    case 'donation':
      submission = {
        kind: 'donation',
        row: {
          first_name: f.text('first-name', { required: true, max: 100 })!,
          last_name: f.text('last-name', { required: true, max: 100 })!,
          email: f.email('email', true)!,
          on_behalf_of: f.oneOf(
            'on-behalf-of',
            DONATION_ON_BEHALF_OF,
            true,
            'Choose who the donation is on behalf of.',
          )!,
          honoree_name: f.text('honoree-name'),
          amount_sgd: f.amount('donation-amount')!,
          terms_accepted: f.checked('terms-accepted', 'Please accept the terms & conditions.')!,
          source_page: f.page(),
        },
      };
      break;

    case 'contact':
      submission = {
        kind: 'contact',
        row: {
          first_name: f.text('first-name', { max: 100 }),
          last_name: f.text('last-name', { max: 100 }),
          email: f.email('email', true)!,
          subject: f.text('subject'),
          message: f.text('message', { max: 5000 }),
          source_page: f.page(),
        },
      };
      break;
  }

  if (Object.keys(f.errors).length > 0) return { ok: false, errors: f.errors };
  return { ok: true, spam: false, submission };
}
