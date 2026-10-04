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


STAGES = {"meta": stage_meta, "rename": stage_rename, "remove": stage_remove}

if __name__ == "__main__":
    if not sys.argv[1:] or any(a not in STAGES for a in sys.argv[1:]):
        raise SystemExit(f"usage: {sys.argv[0]} STAGE [STAGE ...]  (stages: {', '.join(STAGES)})")
    for stage in sys.argv[1:]:
        STAGES[stage]()
