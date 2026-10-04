#!/usr/bin/env python3
"""One-off: wire the exported Wix forms to /api/forms. Idempotent.

For every <form> in public/: tag it with data-form-kind, give the fields Wix
left unnamed a `name`, start dropdowns on their placeholder, add a hidden
honeypot input, and mark the form's original (hidden) success message with
data-static-success so site.js can reveal it. tests/html-forms.test.ts checks the result.
"""
import pathlib
import re

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"

KINDS = {
    "home — comp-l407kslq": "newsletter",
    "home — Sign Up": "membership",
    "general-6 — Sign Up": "membership",
    "donate — comp-l3oo8aht1": "donation",
    "stay-connected — Have a question?": "contact",
}
# Wix element id -> field name, for fields the export left without one.
NAMES = {
    "collection_comp-m6z2kc3t": "qualification",
    "textarea_comp-m6z1ygjc": "contribution",
    "collection_comp-l3oo8aj01": "on-behalf-of",
    "textarea_comp-l3omkyww2": "message",
}
SUCCESS_IDS = {"comp-l407ksor2", "comp-l3oo8akc1", "comp-l3omkyx21"}
MEMBERSHIP_SUCCESS = "Thank you for signing up! We will be in touch soon."
HONEYPOT = (
    '<div class="static-hp" aria-hidden="true" style="position:absolute;left:-10000px;'
    'width:1px;height:1px;overflow:hidden"><label>Leave this field empty '
    '<input type="text" name="website" tabindex="-1" autocomplete="off" value=""></label></div>'
)


def wire(form: str) -> str:
    open_tag = re.match(r"<form\b[^>]*>", form).group(0)
    # Wix used the form's heading as its name; the contact form's spans lines.
    name = re.search(r'data-form-name="([^"]*)"', open_tag).group(1).split("\n")[0]
    kind = KINDS[name]
    tag = open_tag
    if "data-form-kind" not in tag:
        extra = f' data-form-kind="{kind}"'
        if kind == "membership":
            extra += f' data-success="{MEMBERSHIP_SUCCESS}"'
        tag = tag[:-1] + extra + ">"
    body = form[len(open_tag):]
    for el_id, field in NAMES.items():
        body = re.sub(
            rf'<(select|textarea)\b(?![^>]*\sname=)([^>]*\sid="{el_id}")',
            rf'<\1 name="{field}"\2',
            body,
        )
    body = re.sub(r'<input\b(?![^>]*\sname=)([^>]*type="checkbox")', r'<input name="terms-accepted"\1', body)
    # Wix selected the disabled placeholder with JS; without `selected` the browser
    # preselects the first real option (e.g. "Diploma") and it gets submitted.
    body = re.sub(
        r'(<select\b[^>]*>)<option value="" disabled=""(?![^>]*\sselected)([^>]*)>',
        r'\1<option value="" disabled=""\2 selected="">',
        body,
    )
    for el_id in SUCCESS_IDS:
        body = re.sub(rf'<div id="{el_id}"(?![^>]*data-static-success)', rf'<div id="{el_id}" data-static-success', body)
    if 'name="website"' not in body:
        body = HONEYPOT + body
    return tag + body


changed = 0
for path in sorted(PUBLIC.rglob("*.html")):
    html = path.read_text(encoding="utf-8")
    new = re.sub(r"<form\b[^>]*>.*?</form>", lambda m: wire(m.group(0)), html, flags=re.S)
    if new != html:
        path.write_text(new, encoding="utf-8")
        changed += 1
        print("wired", path.relative_to(PUBLIC))
print(f"{changed} file(s) changed")
