#!/usr/bin/env python3
"""Remove what the Wix export left behind. Run the stages in this order; each is
idempotent.

  meta    template titles/metadata, Wix URLs in JSON-LD, source-map comments,
          Pinterest attributes
  rename  asset folders named after Wix hosts, and "wix" in CSS/HTML identifiers
  remove  placeholder events, the Wix Groups forum, blog comment boxes
  media   images from Wix's media library (social icons, 404 art, stock photos)
  fonts   fonts Wix licenses for Wix-hosted sites only -> open-licensed look-alikes

Usage: scripts/remove-wix-leftovers.py STAGE [STAGE ...]
tests/site-hygiene.test.ts checks the result.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
MANIFEST = ROOT / "build-manifest.json"
SITE = "https://www.ewb.sg"
TEXT_EXT = {".html", ".css", ".js", ".xml", ".json", ".svg", ".txt"}


def read(p: Path) -> str:
    with open(p, encoding="utf-8", newline="") as f:
        return f.read()


def write(p: Path, s: str) -> None:
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)


def text_files():
    return [p for p in sorted(PUBLIC.rglob("*")) if p.is_file() and p.suffix.lower() in TEXT_EXT]


def html_files():
    return [p for p in text_files() if p.suffix == ".html"]


def rewrite(paths, fn) -> int:
    changed = 0
    for p in paths:
        s = read(p)
        new = fn(s, p)
        if new != s:
            write(p, new)
            changed += 1
    return changed


def element_end(s: str, start: int) -> int:
    """Index just past the element whose open tag starts at `start`."""
    tag = re.match(r"<([A-Za-z][\w-]*)", s[start:]).group(1)
    depth = 0
    for m in re.finditer(r"<(/?)%s(?=[\s>/])[^>]*>" % re.escape(tag), s[start:]):
        if m.group(1):
            depth -= 1
        elif not m.group(0).endswith("/>"):
            depth += 1
        if depth == 0:
            return start + m.end()
    raise ValueError(f"unclosed <{tag}> at {start}")


def enclosing(s: str, idx: int, tag: str, attrs: str = "") -> tuple[int, int] | None:
    """Innermost <tag> element (whose open tag matches `attrs`) that contains idx."""
    for m in reversed(list(re.finditer(r"<%s(?=[\s>])[^>]*>" % tag, s[:idx]))):
        if attrs and not re.search(attrs, m.group(0)):
            continue
        end = element_end(s, m.start())
        if end > idx:
            return m.start(), end
    return None


# --- meta -------------------------------------------------------------------

OLD_SITE = re.compile(r"^https?://ewbsingapore\.wixsite\.com/ewbsg(/.*)?$")
WIX_MEDIA = re.compile(r"^https?://static\.wixstatic\.com/media/([^/]+)")
DROP = object()


def media_index() -> dict[str, str]:
    """Wix media id (e.g. 596d39_...~mv2.jpg) -> local copy of its largest variant."""
    best: dict[str, tuple[int, str]] = {}
    for url, local in json.loads(read(MANIFEST))["assets"].items():
        m = WIX_MEDIA.match(url)
        f = PUBLIC / local.lstrip("/")
        if m and f.exists():
            size = f.stat().st_size
            if size > best.get(m.group(1), (-1, ""))[0]:
                best[m.group(1)] = (size, local)
    return {k: v for k, (_, v) in best.items()}


def ld_value(v, media):
    if isinstance(v, dict):
        return {k: y for k, x in v.items() if (y := ld_value(x, media)) is not DROP}
    if isinstance(v, list):
        return [y for x in v if (y := ld_value(x, media)) is not DROP]
    if not isinstance(v, str):
        return v
    if m := OLD_SITE.match(v):
        path = (m.group(1) or "/").rstrip("/")
        if not path:
            return SITE + "/"
        page = PUBLIC / unquote(path).lstrip("/") / "index.html"
        return f"{SITE}{path}/" if page.exists() else DROP  # e.g. Wix member profiles
    if m := WIX_MEDIA.match(v):
        return SITE + media[m.group(1)] if m.group(1) in media else DROP
    return v


def ld_json(block: str, media) -> str:
    try:
        data = json.loads(block)
    except ValueError:
        return block
    return json.dumps(ld_value(data, media), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def stage_meta():
    media = media_index()

    def fix(s, p):
        s = s.replace("| Save Our Shores", "| EWB Singapore")  # Wix template site name
        s = re.sub(r'[ \t]*<meta name="keywords" content="Business, tagline">\n?', "", s)
        s = re.sub(r'[ \t]*<meta name="skype_toolbar"[^>]*>\n?', "", s)
        s = re.sub(r'[ \t]*<meta http-equiv="X-UA-Compatible"[^>]*>\n?', "", s)
        s = re.sub(r'(<style\b[^>]*?)\s+data-url="[^"]*"', r"\1", s)
        s = re.sub(r"\s*/\*# sourceMappingURL=[^*]*\*/", "", s)
        s = re.sub(r'\s+data-pin-(?:url|media|nopin|description)="[^"]*"', "", s)
        s = re.sub(
            r'(<script type="application/ld\+json"[^>]*>)(.*?)(</script>)',
            lambda m: m.group(1) + ld_json(m.group(2), media) + m.group(3),
            s,
            flags=re.S,
        )
        if p.name == "404.html":  # og:url pointed at a page that never existed
            s = s.replace('content="https://www.ewb.sg/events/"', 'content="https://www.ewb.sg/"')
        return s

    print(f"meta: {rewrite(text_files(), fix)} file(s) changed")


# --- rename -----------------------------------------------------------------

ASSET_DIRS = {
    "static.wixstatic.com": "media",
    "static.parastorage.com": "static",
    "images-wixmp-fab9913bae2ffa83c48a0b95.wixmp.com": "stock",
    "a3478224-ae82-47fc-a8f3-f229ac03e0be.filesusr.com": "files",
}


def wix_to_ewb(s: str) -> str:
    return re.sub(r"wix", lambda m: {"wix": "ewb", "Wix": "Ewb", "WIX": "EWB"}.get(m.group(0), "ewb"), s, flags=re.I)


def stage_rename():
    assets = PUBLIC / "assets"
    moves = {}
    for old, new in ASSET_DIRS.items():
        if (assets / old).exists():
            assert not (assets / new).exists(), f"assets/{new} already exists"
            (assets / old).rename(assets / new)
        moves[f"/assets/{old}/"] = f"/assets/{new}/"
    for f in sorted(assets.rglob("*")):
        if f.is_file() and re.search("wix", f.name, re.I):
            name = re.sub(r"[-_]{2,}", "-", re.sub(r"(?i)wix", "", f.name))
            assert not (f.parent / name).exists(), f"{f.parent / name} exists"
            f.rename(f.parent / name)
            moves[f"/{f.relative_to(PUBLIC)}"] = f"/{(f.parent / name).relative_to(PUBLIC)}"

    def paths(s, _):
        for old, new in moves.items():
            s = s.replace(old, new)
        return s

    changed = rewrite(text_files(), paths)
    write(MANIFEST, paths(read(MANIFEST), None))

    # "wix" in class names, CSS custom properties, ids and font aliases. Refuse to
    # rename if a renamed token would collide with one that already exists.
    tokens, renamed = set(), set()
    for p in text_files():
        for t in re.findall(r"[\w-]+", read(p)):
            (renamed if re.search("wix", t, re.I) else tokens).add(t)
    clash = {wix_to_ewb(t) for t in renamed} & tokens
    assert not clash, f"renaming would collide with existing tokens: {sorted(clash)[:20]}"
    ids = rewrite(text_files(), lambda s, _: wix_to_ewb(s))
    print(f"rename: {len(moves)} path(s) moved, {changed} file(s) re-pointed, {ids} file(s) with identifiers renamed")


# --- remove -----------------------------------------------------------------

DEAD_EVENTS = ["past-event-1", "past-event-2", "trial-event", "donation-drive"]
DEAD_DIRS = [f"event-details/{e}" for e in DEAD_EVENTS] + ["groups", "group"]
REDIRECTS = [
    ("/event-details/:slug(%s)" % "|".join(DEAD_EVENTS), "/projects-8/"),
    ("/m/event-details/:slug(%s)" % "|".join(DEAD_EVENTS), "/m/projects-8/"),
    ("/groups", "/stay-connected/"),
    ("/group/:path*", "/stay-connected/"),
    ("/m/groups", "/m/stay-connected/"),
    ("/m/group/:path*", "/m/stay-connected/"),
]


def cut_all(s: str, needle: str, tag: str, attrs: str, what: str, page: Path) -> str:
    body = s.find("<body")
    while (i := s.find(needle, body)) != -1:
        el = enclosing(s, i, tag, attrs)
        if el is None:
            raise SystemExit(f"{page.relative_to(PUBLIC)}: no enclosing <{tag}> for {what} at {i}")
        s = s[: el[0]] + s[el[1]:]
    return s


def stage_remove():
    for d in DEAD_DIRS:
        for base in (PUBLIC, PUBLIC / "m"):
            if (base / d).exists():
                shutil.rmtree(base / d)

    events = "|".join(DEAD_EVENTS)

    def fix(s, p):
        # Rows/cards for the placeholder events on the Events page lists.
        body = s.find("<body")
        while m := re.compile(r"event-details(?:/|%%2F)(?:%s)\b" % events).search(s, body):
            el = enclosing(s, m.start(), "li", r'data-hook="(?:event-list-item|events-card)"')
            if el is None:
                raise SystemExit(f"{p.relative_to(PUBLIC)}: event link outside a list item at {m.start()}")
            s = s[: el[0]] + s[el[1]:]
        if p.parent.name == "projects-8":
            # The list section was sized for five events: drop its empty background
            # strip (desktop) and fixed minimum height (mobile) so it fits one.
            if (i := s.find('<section id="comp-l3fkfl6l"')) != -1:
                s = s[:i] + s[element_end(s, i):]
            s = re.sub(
                r"(\[data-mesh-id=comp-li1ox2e8inlineContent-gridContainer\]\{[^}]*?min-height:)\d+px",
                r"\1auto",
                s,
            )
        # "Groups List" menu items (desktop dropdown and mobile menu).
        for href in ('href="/groups/"', 'href="/m/groups/"'):
            s = cut_all(s, href, "li", "", "Groups List link", p)
        # Wix Comments box at the end of blog posts: the section wrapping the widget.
        while (i := s.find('data-hook="wc-root')) != -1:
            widget = s.rfind("<section", 0, i)  # the marker is an attribute of this tag
            outer = enclosing(s, widget, "section") if widget != -1 else None
            if outer is None:
                raise SystemExit(f"{p.relative_to(PUBLIC)}: comments widget without a wrapping section")
            s = s[: outer[0]] + s[outer[1]:]
        return s

    changed = rewrite(html_files(), fix)
    sitemap = PUBLIC / "sitemap.xml"
    write(sitemap, re.sub(r"\s*<url><loc>[^<]*/event-details/(?:%s)/</loc></url>" % events, "", read(sitemap)))

    cfg_path = ROOT / "vercel.json"
    cfg = json.loads(read(cfg_path))
    have = {r["source"] for r in cfg.get("redirects", [])}
    # Vercel matches sources exactly, so list each with and without the trailing slash.
    cfg["redirects"] = cfg.get("redirects", []) + [
        {"source": s, "destination": dst, "permanent": True}
        for src, dst in REDIRECTS
        for s in (src, src + "/")
        if s not in have
    ]
    write(cfg_path, json.dumps(cfg, indent=2) + "\n")
    print(f"remove: {changed} page(s) edited, {len(DEAD_DIRS) * 2} director(ies) removed")


# --- media ------------------------------------------------------------------

# Our own artwork replacing images from Wix's media library, which Wix licenses
# for Wix-hosted sites. Keyed by the Wix media id in the exported file names.
_CIRCLE = '<circle cx="32" cy="32" r="32"/>'
_LINKEDIN = (
    '<circle cx="21.5" cy="19.5" r="4.2"/><rect x="17.8" y="26.5" width="7.4" height="21" rx=".8"/>'
    '<path d="M30 26.5h7.1v2.9c1.3-2.1 3.8-3.5 7-3.5 5.4 0 8 3.3 8 9.3v12.3h-7.4V36.4c0-3-1.1-4.6-3.6-4.6'
    '-2.7 0-3.7 1.9-3.7 4.7v11H30z"/>'
)
_FACEBOOK = (
    '<path d="M35.2 52V34.6h5.8l.9-6.8h-6.7v-4.3c0-2 .6-3.3 3.4-3.3h3.6v-6.1c-.6-.1-2.8-.3-5.3-.3'
    '-5.2 0-8.8 3.2-8.8 9v5h-5.9v6.8h5.9V52z"/>'
)
_INSTAGRAM = (
    '<g fill="none" stroke-width="3.8"><rect x="16.5" y="16.5" width="31" height="31" rx="8.8"/>'
    '<circle cx="32" cy="32" r="7.2"/></g><circle cx="41.6" cy="22.4" r="2.3"/>'
)


def _icon(glyph: str, circle: bool) -> str:
    if circle:  # white mark on a black disc (footer)
        body = f'<g fill="#000">{_CIRCLE}</g><g fill="#fff" stroke="#fff" stroke-width="0">{glyph}</g>'
        box = "0 0 64 64"
    else:  # bare black mark (Contact page)
        body = f'<g fill="#000" stroke="#000" stroke-width="0">{glyph}</g>'
        box = "8.5 8.5 47 47"
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}">{body}</svg>\n'


def _gradient(w: int, h: int, stops, angle=(0, 0, 0, 1)) -> str:
    x1, y1, x2, y2 = angle
    st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'preserveAspectRatio="none"><defs><linearGradient id="g" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
        f'{st}</linearGradient></defs><rect width="{w}" height="{h}" fill="url(#g)"/></svg>\n'
    )


_NOT_FOUND = """<svg xmlns="http://www.w3.org/2000/svg" width="483" height="335" viewBox="0 0 483 335">
<ellipse cx="241" cy="318" rx="190" ry="7" fill="#e9f0f4"/>
<g fill="#d6e6f0"><rect x="52" y="214" width="78" height="100" rx="3"/><rect x="353" y="214" width="78" height="100" rx="3"/></g>
<g fill="#38b5e9"><path d="M52 200h150l18 12H52z"/><path d="M263 212l18-12h150v12z"/></g>
<g fill="none" stroke="#38b5e9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M60 200l26-34 26 34 26-34 26 34 26-34 12 16"/><path d="M60 166h146"/>
<path d="M423 200l-26-34-26 34-26-34-26 34-26-34-12 16"/><path d="M423 166H277"/>
<path d="M230 236l6 10M252 232l-4 12M241 254l1 9"/></g>
<text x="241" y="120" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
 font-size="96" font-weight="300" fill="#38b5e9">404</text>
</svg>
"""

MEDIA = {
    "11062b_a06d85fa94d64ef68680321f5a043a8c": ("icon-linkedin-circle.svg", _icon(_LINKEDIN, True)),
    "11062b_366f7fdbcafc4effaeddb0dba92014c1": ("icon-facebook-circle.svg", _icon(_FACEBOOK, True)),
    "11062b_084cbbff6ae446c1b03dc3637193e77a": ("icon-instagram-circle.svg", _icon(_INSTAGRAM, True)),
    "6ea5b4a88f0b4f91945b40499aa0af00": ("icon-linkedin.svg", _icon(_LINKEDIN, False)),
    "0fdef751204647a3bbd7eaa2827ed4f9": ("icon-facebook.svg", _icon(_FACEBOOK, False)),
    "01c3aff52f2a4dffa526d7a9843d46ea": ("icon-instagram.svg", _icon(_INSTAGRAM, False)),
    # Home page: backdrop of the "Kampung Gurney" text panel ("Concrete Wall").
    "11062b_5c6719f355894992a4ffad6a33a9749b": (
        "bg-panel.svg",
        _gradient(640, 1398, [(0, "#b9c7d4"), (0.2, "#dcdfe1"), (0.5, "#e9e7e4"), (0.8, "#e3e7e3"), (1, "#b7cbc6")], (0, 0, 0.55, 1)),
    ),
    # Home page: backdrop of "On the Ground - Moments That Matter" ("Winter Scenery").
    "11062b_ad10c7e40bd24b06aeed962ab9c2d849": (
        "bg-sky.svg",
        _gradient(1960, 1060, [(0, "#f2f5f8"), (0.35, "#dde8f1"), (0.6, "#b9cfe0"), (0.82, "#80a0b6"), (1, "#506f84")]),
    ),
    # AGM page: backdrop behind the meeting cards ("Meeting Room").
    "11062b_cc6be4a9d73e4f71bc504bae8980d0e3": (
        "bg-grey.svg",
        _gradient(1960, 1788, [(0, "#f6f6f5"), (0.45, "#ececea"), (0.72, "#c9c9c6"), (1, "#8f8f8c")]),
    ),
    # 404 page illustration.
    "035244_516142e5fd21466aaf92b39e0883e66f": ("not-found.svg", _NOT_FOUND),
}


def prune_assets() -> int:
    """Delete asset files nothing references any more, and their manifest entries."""
    blob = "\n".join(read(p) for p in text_files())
    refs = {unquote(r) for r in re.findall(r"/assets/[^\"'\s)>,?#]+", blob)}
    removed = 0
    for f in sorted((PUBLIC / "assets").rglob("*")):
        rel = f"/{f.relative_to(PUBLIC)}"
        if f.is_file() and rel not in refs and f.name not in ("site.js",) and not f.name.startswith("OFL"):
            f.unlink()
            removed += 1
    for d in sorted((PUBLIC / "assets").rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    manifest = json.loads(read(MANIFEST))
    manifest["assets"] = {k: v for k, v in manifest["assets"].items() if (PUBLIC / v.lstrip("/")).exists()}
    write(MANIFEST, json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    return removed


def stage_media():
    media_dir = PUBLIC / "assets" / "media"
    moves = {}
    for wix_id, (name, svg) in MEDIA.items():
        write(media_dir / name, svg)
        for f in media_dir.iterdir():
            if wix_id in f.name:
                moves[f"/assets/media/{f.name}"] = f"/assets/media/{name}"

    def repoint(s, _):
        for old, new in moves.items():
            s = s.replace(old, new)
        return s

    changed = rewrite(text_files(), repoint)
    print(f"media: {len(moves)} Wix-library file(s) replaced in {changed} file(s); {prune_assets()} unused asset(s) deleted")


STAGES = {"meta": stage_meta, "rename": stage_rename, "remove": stage_remove, "media": stage_media}

if __name__ == "__main__":
    if not sys.argv[1:] or any(a not in STAGES for a in sys.argv[1:]):
        raise SystemExit(f"usage: {sys.argv[0]} STAGE [STAGE ...]  (stages: {', '.join(STAGES)})")
    for stage in sys.argv[1:]:
        STAGES[stage]()
