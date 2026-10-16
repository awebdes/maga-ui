#!/usr/bin/env python3
"""Inline prototype CSS/JS into one HTML file.

Usage: python3 tools/build_single.py [out.html] [--fragment]
--fragment drops the <!doctype>/<html>/<head>/<body> wrapper (for hosts that add their own).
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "prototype"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
fragment = "--fragment" in sys.argv
out = pathlib.Path(args[0]) if args else ROOT.parent / "dist" / "maga-ui-kit.html"

src = (ROOT / "index.html").read_text(encoding="utf-8")


def inline_css(m):
    return "<style>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</style>"


def inline_js(m):
    return "<script>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</script>"


html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, src)
html = re.sub(r'<script src="(js/[^"]+)"></script>', inline_js, html)

if fragment:
    head = html.split("<!-- @artifact-head -->")[1].split("<!-- @artifact-head-end -->")[0]
    body = html.split("<!-- @artifact-body -->")[1].split("<!-- @artifact-body-end -->")[0]
    # the title must lead the file; preconnect hints are dropped
    head = re.sub(r'<link rel="preconnect"[^>]*>\n?', "", head)
    html = head.strip() + "\n" + body.strip() + "\n"

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({len(html) // 1024} KB)")
