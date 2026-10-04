// Contract between the exported HTML forms and the /api/forms validator: every
// form on every page (desktop and /m mobile variants) must declare its kind,
// carry the honeypot, and name its fields the way lib/forms.ts expects.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORM_KINDS, parseSubmission } from '../lib/forms.js';

const PUBLIC = join(import.meta.dirname, '..', 'public');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'assets' ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const SAMPLE: Record<string, string | boolean> = {
  'first-name': 'Test',
  'last-name': 'User',
  email: 'test@example.com',
  phone: '+65 6000 0000',
  qualification: 'PhD',
  'qualification-title': 'PhD Engineering',
  company: 'EWB',
  position: 'Volunteer',
  contribution: 'Testing.',
  'on-behalf-of': 'Myself',
  'honoree-name': 'Test User',
  'donation-amount': '10',
  'terms-accepted': true,
  subject: 'Hello',
  message: 'Testing.',
};

const forms = htmlFiles(PUBLIC).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((m) => ({
    page: relative(PUBLIC, file),
    html: m[0],
  })),
);

describe('exported HTML forms', () => {
  it('finds the forms we expect (newsletter, membership x2, donation, contact; desktop + mobile)', () => {
    expect(forms.length).toBe(10);
  });

  for (const { page, html } of forms) {
    const formTag = html.match(/<form\b[^>]*>/)![0];
    const kind = attr(formTag, 'data-form-kind');

    describe(`${page} ${attr(formTag, 'data-form-name')}`, () => {
      it('declares a known data-form-kind', () => {
        expect(FORM_KINDS).toContain(kind);
      });

      it('names every field and includes the honeypot', () => {
        const fields = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
        const unnamed = fields.filter((f) => !attr(f, 'name'));
        expect(unnamed).toEqual([]);
        const honeypot = fields.find((f) => attr(f, 'name') === 'website');
        expect(honeypot).toBeDefined();
        expect(honeypot).toMatch(/tabindex="-1"/);
        expect(honeypot).toMatch(/autocomplete="off"/);
      });

      it('submits a payload the API accepts', () => {
        const names = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
          .map((m) => attr(m[0], 'name'))
          .filter((n): n is string => !!n && n !== 'website');
        const body = Object.fromEntries(names.map((n) => [n, SAMPLE[n]]));
        expect(names.every((n) => n in SAMPLE)).toBe(true);
        const result = parseSubmission({ ...body, _kind: kind, _page: '/' });
        expect(result).toMatchObject({ ok: true, spam: false });
      });

      it('marks its success message, if the original form had one', () => {
        const body = html.slice(formTag.length);
        const hasThanks = /Thank(s| you) for/.test(body);
        expect(/data-static-success/.test(body)).toBe(hasThanks);
        // Forms without one get a message from data-success instead.
        if (!hasThanks) expect(attr(formTag, 'data-success')).toBeTruthy();
      });
    });
  }
});
