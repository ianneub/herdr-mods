#!/usr/bin/env python3
"""Sync the user's claude.ai artifacts for the Herdr Artifacts panel.

Reads Claude Code's claude.ai login from the macOS Keychain on every run
(never stored), lists the artifacts the person owns through the same
endpoint Claude Code uses, downloads each gallery thumbnail (and its dark-mode
screenshot, when the page has one) once per thumbnail version (downscaled with sips), and writes
~/.config/herdr-app/data/artifacts/index.json for the mod to read.

The token is only sent to api.anthropic.com. Thumbnails come from signed
claudeusercontent.com URLs that need no token. An expired token is
reported, never refreshed: refreshing would rotate Claude Code's own login.

Prints one JSON line: {"ok": true, "count": N} or {"ok": false, "error": "..."}.
"""
import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.anthropic.com/api/frame/artifacts"
HOME = os.path.expanduser("~/.config/herdr-app")
DATA = os.path.join(HOME, "data", "artifacts")
THUMBS = os.path.join(DATA, "thumbs")
INDEX = os.path.join(DATA, "index.json")
MAX_ITEMS = 500
THUMB_WIDTH = 640  # sharp on a Retina screen up to ~320 px wide cards


def token():
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout
        oauth = json.loads(raw)["claudeAiOauth"]
    except Exception:
        raise SystemExit(fail("No Claude Code login found in the Keychain. Sign in to Claude Code first."))
    exp = oauth.get("expiresAt")
    if isinstance(exp, (int, float)) and exp / 1000 < time.time():
        raise SystemExit(fail("Claude Code's login has expired. Start Claude Code once to renew it, then refresh."))
    return oauth["accessToken"]


def fail(msg):
    write_index(error=msg)
    print(json.dumps({"ok": False, "error": msg}))
    return 1


def get_json(url, tok):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {tok}",
        "anthropic-beta": "oauth-2025-04-20",
        "Accept": "application/json",
        "X-Frame-Surface": "code",
        "X-Frame-Platform": "cli",
        "X-Frame-CP": "go",
        "User-Agent": "herdr-artifacts-panel",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def list_all(tok):
    rows, page = [], None
    while len(rows) < MAX_ITEMS:
        q = {"rel": "mine", "kind": "page,document", "sort": "last_viewed", "limit": "50"}
        if page:
            q["page_token"] = page
        d = get_json(f"{API}?{urllib.parse.urlencode(q)}", tok)
        rows += d.get("artifacts") or []
        page = d.get("next_page_token")
        if not page:
            break
    return [a for a in rows if not a.get("soft_deleted")]


def fetch_thumb(url, dest):
    if os.path.exists(dest):
        return True
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "herdr-artifacts-panel"}), timeout=30) as r:
            body = r.read()
    except Exception:
        return False
    fd, tmp = tempfile.mkstemp(dir=THUMBS, suffix=".jpg")
    with os.fdopen(fd, "wb") as f:
        f.write(body)
    # sips converts PNGs too, so every cached thumbnail is a small JPEG.
    r = subprocess.run(["sips", "-s", "format", "jpeg", "--resampleWidth", str(THUMB_WIDTH), tmp, "--out", tmp],
                       capture_output=True, timeout=30)
    if r.returncode != 0:
        os.unlink(tmp)
        return False
    os.replace(tmp, dest)
    return True


def write_index(items=None, error=None):
    os.makedirs(DATA, exist_ok=True)
    try:
        with open(INDEX) as f:
            old = json.load(f)
    except Exception:
        old = {}
    out = {
        "fetched_at": time.time() if items is not None else old.get("fetched_at"),
        "checked_at": time.time(),
        "items": items if items is not None else old.get("items", []),
        "error": error,
    }
    fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(out, f)
    os.replace(tmp, INDEX)


def main():
    os.makedirs(THUMBS, exist_ok=True)
    tok = token()
    try:
        rows = list_all(tok)
    except urllib.error.HTTPError as e:
        msg = ("claude.ai refused Claude Code's login (HTTP %d). Start Claude Code once, then refresh." % e.code
               if e.code in (401, 403) else "claude.ai answered HTTP %d." % e.code)
        return fail(msg)
    except Exception as e:
        return fail(f"Couldn't reach claude.ai: {e}")

    items, jobs = [], []
    for a in rows:
        thumb = thumb_dark = None
        if a.get("thumbnail_url") and a.get("thumbnail_version"):
            rel = f"data/artifacts/thumbs/{a['id']}-{a['thumbnail_version']}.jpg"
            jobs.append((a["thumbnail_url"], os.path.join(HOME, rel), rel))
            thumb = rel
            # Pages that support dark mode also get a dark screenshot (same version).
            if a.get("thumbnail_dark_url"):
                rel = f"data/artifacts/thumbs/{a['id']}-{a['thumbnail_version']}-dark.jpg"
                jobs.append((a["thumbnail_dark_url"], os.path.join(HOME, rel), rel))
                thumb_dark = rel
        items.append({
            "id": a["id"],
            "title": a.get("title") or "Untitled",
            "url": a.get("open_url"),
            "favicon": a.get("favicon"),
            "type": a.get("type_title") or ("Doc" if a.get("kind") == "document" else "Page"),
            "audience": a.get("audience"),
            "label": a.get("label"),
            "updated_at": a.get("updated_at"),
            "viewed_at": a.get("last_viewed_at"),
            "thumb": thumb,
            "thumb_dark": thumb_dark,
        })

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        ok = dict(zip([j[2] for j in jobs], pool.map(lambda j: fetch_thumb(j[0], j[1]), jobs)))
    for it in items:
        for k in ("thumb", "thumb_dark"):
            if it[k] and not ok.get(it[k]):
                it[k] = None

    keep = {os.path.basename(it[k]) for it in items for k in ("thumb", "thumb_dark") if it[k]}
    for name in os.listdir(THUMBS):
        if name not in keep:
            try:
                os.unlink(os.path.join(THUMBS, name))
            except OSError:
                pass

    write_index(items=items)
    print(json.dumps({"ok": True, "count": len(items)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
