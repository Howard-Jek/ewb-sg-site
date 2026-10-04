// Guards against Wix leftovers creeping back (see scripts/remove-wix-leftovers.py)
// and against broken internal references in the static site.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const TEXT = /\.(html|css|js|xml|json|svg|txt)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(PUBLIC);
const texts = files.filter((f) => TEXT.test(f)).map((f) => ({ path: relative(PUBLIC, f), body: readFileSync(f, 'utf8') }));
const html = texts.filter((t) => t.path.endsWith('.html'));

function offenders(pattern: RegExp): string[] {
  return texts.filter((t) => pattern.test(t.body)).map((t) => `${t.path}: ${t.body.match(pattern)![0]}`);
}

describe('no Wix leftovers', () => {
  it('has no "wix" in any file name or text file', () => {
    expect(files.map((f) => relative(PUBLIC, f)).filter((p) => /wix/i.test(p))).toEqual([]);
    expect(offenders(/wix/i)).toEqual([]);
  });

  it('references no Wix hosts', () => {
    expect(offenders(/parastorage\.com|wixstatic\.com|wixsite\.com|wixmp\.com|filesusr\.com|wix\.com/i)).toEqual([]);
  });

  it('carries no Wix template text', () => {
    expect(
      offenders(/Save Our Shores|Business, tagline|Short description about the event|Post \| Ewbsg|skype_toolbar|sourceMappingURL|data-pin-/),
    ).toEqual([]);
  });

  it('has no dead Wix app controls or Wix-generated filler', () => {
    expect(
      offenders(
        /RSVP Closed|other guests|data-hook="events\.MEMBERS"|>Log In<|data-hook="(?:search-input|more-button|more-info-link)|aria-label="(?:Previous|Next)" data-testid="buttonElement"|There’s Nothing Here|Check%20out%20this%20event|<script type="application\/ld\+json">\{\}<\/script>/,
      ),
    ).toEqual([]);
    // Blur-up placeholders that only Wix's script ever cleared.
    expect(offenders(/<[^>]*\sdata-animate-blur/)).toEqual([]);
    // Alt text Wix filled in from upload file names.
    expect(offenders(/\salt="[^"]*\.(?:jpe?g|png|webp|gif|avif)"/i)).toEqual([]);
  });

  it('uses no fonts licensed through Wix', () => {
    expect(offenders(/avenir-lt-w0|helvetica-(?:w0|lt-w10)|helveticaneuew|proxima-n-w|din-next-w|freemium|madefor/i)).toEqual([]);
  });

  it("uses no images from Wix's media library", () => {
    expect(offenders(/11062b_|035244_|6ea5b4a88f0b4f91945b40499aa0af00|0fdef751204647a3bbd7eaa2827ed4f9|01c3aff52f2a4dffa526d7a9843d46ea/)).toEqual([]);
  });

  it('ships a licence with every self-hosted font family', () => {
    const fonts = readdirSync(join(PUBLIC, 'assets', 'fonts'));
    const licences: Record<string, string> = { 'nunito-sans': 'OFL-NunitoSans.txt', montserrat: 'OFL-Montserrat.txt', barlow: 'OFL-Barlow.txt', belleza: 'OFL-Belleza.txt' };
    for (const f of fonts.filter((n) => /\.(woff2?|ttf)$/.test(n))) {
      const family = Object.keys(licences).find((k) => f.startsWith(k));
      expect(family, f).toBeDefined();
      expect(fonts, f).toContain(licences[family!]);
    }
  });
});

describe('removed Wix app pages', () => {
  const redirects: { source: string; destination: string }[] = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).redirects;
  const gone = ['event-details/past-event-1', 'event-details/past-event-2', 'event-details/trial-event', 'event-details/donation-drive', 'groups', 'group'];

  it('are deleted, desktop and mobile', () => {
    for (const g of gone) for (const base of ['', 'm/']) expect(existsSync(join(PUBLIC, base + g)), base + g).toBe(false);
  });

  it('redirect with and without a trailing slash', () => {
    const sources = redirects.map((r) => r.source);
    for (const s of ['/groups', '/group/:path*', '/m/groups', '/m/group/:path*']) {
      expect(sources).toContain(s);
      expect(sources).toContain(s + '/');
    }
    expect(sources.filter((s) => s.includes('past-event-1'))).toHaveLength(4);
  });
});

describe('internal references', () => {
  const resolves = (url: string) => {
    const path = decodeURIComponent(url.split(/[?#]/)[0]);
    const f = join(PUBLIC, path);
    return existsSync(f) && (statSync(f).isFile() || existsSync(join(f, 'index.html')));
  };

  it('every root-relative href/src/srcset/url() points at a file', () => {
    const broken = new Set<string>();
    for (const t of texts.filter((x) => /\.(html|css|xml)$/.test(x.path))) {
      const urls: string[] = [];
      for (const m of t.body.matchAll(/(?:href|src|poster|data-static-zoom)="([^"]*)"/g)) urls.push(m[1]);
      for (const m of t.body.matchAll(/url\(["']?([^"')]+)/g)) urls.push(m[1]);
      for (const m of t.body.matchAll(/srcset="([^"]*)"/g)) urls.push(...m[1].split(/,\s+/).map((c) => c.trim().split(/\s+/)[0]));
      for (const m of t.body.matchAll(/https:\/\/www\.ewb\.sg(\/assets\/[^"<\s]+)/g)) urls.push(m[1]);
      for (const url of urls) {
        if (url.startsWith('/') && !url.startsWith('//') && !resolves(url)) broken.add(`${t.path} -> ${url}`);
      }
    }
    expect([...broken]).toEqual([]);
  });

  it('JSON-LD parses and only links to www.ewb.sg (or schema.org)', () => {
    for (const t of html) {
      for (const [, block] of t.body.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(() => JSON.parse(block), t.path).not.toThrow();
        const urls = block.match(/https?:\/\/[^"\\]+/g) ?? [];
        expect(urls.filter((u) => !/^https:\/\/(www\.ewb\.sg\/|schema\.org(\/|$))/.test(u)), t.path).toEqual([]);
      }
    }
  });
});
