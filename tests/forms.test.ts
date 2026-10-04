import { describe, expect, it } from 'vitest';
import { parseSubmission } from '../lib/forms.js';

const membership = {
  _kind: 'membership',
  _page: '/general-6/',
  'first-name': '  Ada ',
  'last-name': 'Lovelace',
  email: ' Ada@Example.COM ',
  phone: '+65 9123 4567',
  qualification: "Master's Degree",
  'qualification-title': 'MEng Civil Engineering',
  company: 'Analytical Engines Pte Ltd',
  position: 'Engineer',
  contribution: 'Structural design for footbridges.',
};

const donation = {
  _kind: 'donation',
  _page: '/donate/',
  'first-name': 'Grace',
  'last-name': 'Hopper',
  email: 'grace@example.com',
  'on-behalf-of': 'Someone else',
  'honoree-name': 'Alan Turing',
  'donation-amount': '50.5',
  'terms-accepted': true,
};

describe('parseSubmission', () => {
  it('normalises a newsletter sign-up', () => {
    const r = parseSubmission({ _kind: 'newsletter', _page: '/', email: 'Me@Example.com', 'first-name': 'Me' });
    expect(r).toEqual({
      ok: true,
      spam: false,
      submission: {
        kind: 'newsletter',
        row: { email: 'me@example.com', first_name: 'Me', last_name: null, source_page: '/' },
      },
    });
  });

  it('normalises a membership application', () => {
    const r = parseSubmission(membership);
    expect(r).toEqual({
      ok: true,
      spam: false,
      submission: {
        kind: 'membership',
        row: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          phone: '+65 9123 4567',
          highest_qualification: "Master's Degree",
          qualification_title: 'MEng Civil Engineering',
          company: 'Analytical Engines Pte Ltd',
          position: 'Engineer',
          contribution: 'Structural design for footbridges.',
          source_page: '/general-6/',
        },
      },
    });
  });

  it('normalises a donation record', () => {
    const r = parseSubmission(donation);
    expect(r).toEqual({
      ok: true,
      spam: false,
      submission: {
        kind: 'donation',
        row: {
          first_name: 'Grace',
          last_name: 'Hopper',
          email: 'grace@example.com',
          on_behalf_of: 'Someone else',
          honoree_name: 'Alan Turing',
          amount_sgd: '50.50',
          terms_accepted: true,
          source_page: '/donate/',
        },
      },
    });
  });

  it('normalises a contact message', () => {
    const r = parseSubmission({
      _kind: 'contact',
      _page: '/stay-connected/',
      'first-name': 'Kat',
      email: 'kat@example.com',
      subject: 'Volunteering',
      message: 'How do I join a project?',
    });
    expect(r).toEqual({
      ok: true,
      spam: false,
      submission: {
        kind: 'contact',
        row: {
          first_name: 'Kat',
          last_name: null,
          email: 'kat@example.com',
          subject: 'Volunteering',
          message: 'How do I join a project?',
          source_page: '/stay-connected/',
        },
      },
    });
  });

  it('accepts the "on" value a checkbox posts through FormData', () => {
    const r = parseSubmission({ ...donation, 'terms-accepted': 'on' });
    expect(r.ok && !r.spam && r.submission.kind === 'donation' && r.submission.row.terms_accepted).toBe(true);
  });

  it('treats a filled honeypot as spam without validating anything else', () => {
    expect(parseSubmission({ _kind: 'newsletter', website: 'http://spam.example' })).toEqual({ ok: true, spam: true });
  });

  it('rejects a body that is not an object', () => {
    for (const body of [null, 'x', 42, ['a']]) {
      expect(parseSubmission(body)).toEqual({ ok: false, errors: { _form: 'Invalid submission.' } });
    }
  });

  it('rejects an unknown form kind', () => {
    expect(parseSubmission({ _kind: 'admin', email: 'a@b.co' })).toEqual({
      ok: false,
      errors: { _kind: 'Unknown form.' },
    });
  });

  it('requires the fields the original Wix forms required', () => {
    const r = parseSubmission({ _kind: 'membership' });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['email', 'first-name']);

    const c = parseSubmission({ _kind: 'contact' });
    expect(!c.ok && Object.keys(c.errors)).toEqual(['email']);

    const d = parseSubmission({ _kind: 'donation' });
    expect(!d.ok && Object.keys(d.errors).sort()).toEqual([
      'donation-amount',
      'email',
      'first-name',
      'last-name',
      'on-behalf-of',
      'terms-accepted',
    ]);
  });

  it('rejects malformed emails', () => {
    for (const email of ['nope', 'a@b', 'a b@c.de', `${'x'.repeat(250)}@e.co`]) {
      const r = parseSubmission({ _kind: 'newsletter', email });
      expect(r, email).toEqual({ ok: false, errors: { email: 'Enter a valid email address.' } });
    }
  });

  it('rejects values outside the dropdown options', () => {
    const r = parseSubmission({ ...membership, qualification: 'Wizard' });
    expect(!r.ok && r.errors).toEqual({ qualification: 'Choose one of the listed qualifications.' });
    const d = parseSubmission({ ...donation, 'on-behalf-of': 'Everyone' });
    expect(!d.ok && d.errors).toEqual({ 'on-behalf-of': 'Choose who the donation is on behalf of.' });
  });

  it('rejects bad donation amounts', () => {
    for (const amount of ['0', '-5', 'abc', '1.234', '1000000.01', '1e3', '']) {
      const r = parseSubmission({ ...donation, 'donation-amount': amount });
      expect(!r.ok && Object.keys(r.errors), amount).toEqual(['donation-amount']);
    }
  });

  it('requires the terms checkbox to be ticked', () => {
    const r = parseSubmission({ ...donation, 'terms-accepted': false });
    expect(!r.ok && r.errors).toEqual({ 'terms-accepted': 'Please accept the terms & conditions.' });
  });

  it('rejects overlong and non-string values', () => {
    const r = parseSubmission({ ...membership, contribution: 'x'.repeat(5001), company: { $ne: 1 } });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['company', 'contribution']);
  });

  it('rejects implausible phone numbers', () => {
    for (const phone of ['call me', '12', '<script>']) {
      const r = parseSubmission({ ...membership, phone });
      expect(!r.ok && r.errors, phone).toEqual({ phone: 'Enter a valid phone number.' });
    }
  });

  it('drops a source page that is not a site path', () => {
    const r = parseSubmission({ _kind: 'newsletter', email: 'a@b.co', _page: 'https://evil.example/' });
    expect(r.ok && !r.spam && r.submission.row.source_page).toBe(null);
  });
});
