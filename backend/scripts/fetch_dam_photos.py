"""Fetch dam photos from Wikimedia Commons via the stored Wikidata QIDs.

    python scripts/fetch_dam_photos.py            # dry run: report which dams resolve
    python scripts/fetch_dam_photos.py --apply    # download + write dam.photo
    python scripts/fetch_dam_photos.py --apply --limit 5

Only dams with meta.tags.wikidata are candidates. For each QID the script
reads the P18 (image) claim, resolves an 800px thumbnail through the Commons
API, stores it under storage/photos/{dam_id}.jpg and writes the relative path
into dam.photo — exactly the value GET /api/dams/{id}/photo serves. A dam
whose entity has no P18 is reported and skipped, never guessed; the photo
column keeps no placeholder.

Wikimedia etiquette: identifiable User-Agent, paced requests (~1/s).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.db import client as db  # noqa: E402
from modules.storage import paths  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows cp1252 consoles choke on dam names
except Exception:
    pass

WD_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "Niyanta/1.0 (SIH26161; dam photo ingest)"
PACE_S = 1.5
RETRY_429_S = 12.0
RETRIES = 3
CLAIMS_CHUNK = 40
THUMB_WIDTH = 800
MIN_BYTES = 5_000


def _get(url: str) -> dict:
    """GET with a retry on 429 — Commons throttles thumbnail traffic hard."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code != 429 or attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_429_S)
    raise last or RuntimeError("unreachable")


def _claims(qids: list[str]) -> dict[str, list[str]]:
    """QID -> P18 image filenames (possibly empty, never guessed)."""
    out: dict[str, list[str]] = {}
    for i in range(0, len(qids), CLAIMS_CHUNK):
        chunk = qids[i : i + CLAIMS_CHUNK]
        url = (
            f"{WD_API}?action=wbgetentities&ids={'|'.join(chunk)}"
            "&props=claims&format=json"
        )
        try:
            doc = _get(url)
        except Exception as exc:  # offline or throttled: report, move on
            print(f"  [warn] claims chunk failed: {exc}")
            time.sleep(PACE_S)
            continue
        for qid in chunk:
            claims = ((doc.get("entities") or {}).get(qid) or {}).get("claims") or {}
            names = [
                c["mainsnak"]["datavalue"]["value"]
                for c in claims.get("P18", [])
                if isinstance((c.get("mainsnak") or {}).get("datavalue", {}).get("value"), str)
            ]
            out[qid] = names
        time.sleep(PACE_S)
    return out


def _thumb_url(filename: str) -> tuple[str | None, str | None]:
    """(thumbnail url, mime) — SVGs are diagrams, not photos, so they are
    reported back for the caller to skip."""
    title = "File:" + filename
    url = (
        f"{COMMONS_API}?action=query&titles={urllib.parse.quote(title)}"
        f"&prop=imageinfo&iiprop=url|size|mime&iiurlwidth={THUMB_WIDTH}&format=json"
    )
    try:
        doc = _get(url)
    except Exception as exc:
        print(f"  [warn] commons lookup failed for {filename}: {exc}")
        return None, None
    pages = (doc.get("query") or {}).get("pages") or {}
    for page in pages.values():
        if "missing" in page:
            return None, None
        for info in page.get("imageinfo") or []:
            mime = info.get("mime")
            if isinstance(info.get("thumburl"), str):
                return info["thumburl"], mime
            if isinstance(info.get("url"), str):
                return info["url"], mime
    return None, None


def _download(url: str) -> bytes | None:
    last: Exception | None = None
    for attempt in range(RETRIES):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
                if not ctype.startswith("image/"):
                    print(f"  [warn] non-image content-type {ctype} for {url}")
                    return None
                return resp.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code != 429 or attempt == RETRIES - 1:
                print(f"  [warn] download failed for {url}: {exc}")
                return None
            time.sleep(RETRY_429_S)
        except Exception as exc:
            print(f"  [warn] download failed for {url}: {exc}")
            return None
    print(f"  [warn] download failed for {url}: {last}")
    return None


def run(apply: bool = False, limit: int = 0) -> None:
    rows = db.query(
        "SELECT id, name, meta FROM dam WHERE photo IS NULL OR photo = '' ORDER BY name"
    )
    cands: list[dict] = []
    for r in rows:
        meta = r.get("meta") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        qid = (meta.get("tags") or {}).get("wikidata")
        if isinstance(qid, str) and qid.startswith("Q"):
            cands.append({"id": str(r["id"]), "name": r.get("name"), "qid": qid, "meta": meta})
    print(f"dams without photo: {len(rows)}, with wikidata QID: {len(cands)}")
    if limit > 0:
        cands = cands[:limit]

    qids = sorted({c["qid"] for c in cands})
    images = _claims(qids)

    photos_dir = paths.ROOT / "photos"
    resolved = skipped = written = 0
    for c in cands:
        names = images.get(c["qid"]) or []
        if not names:
            skipped += 1
            print(f"  [no P18] {c['name']} ({c['qid']})")
            continue
        url, mime = _thumb_url(names[0])
        time.sleep(PACE_S)
        if not url:
            skipped += 1
            print(f"  [no file] {c['name']}: {names[0]}")
            continue
        if (mime or "").lower() == "image/svg+xml":
            skipped += 1
            print(f"  [svg skip] {c['name']}: {names[0]} is a diagram, not a photo")
            continue
        resolved += 1
        if not apply:
            print(f"  [dry] {c['name']}: {names[0]}")
            continue
        blob = _download(url)
        time.sleep(PACE_S)
        if not blob or len(blob) < MIN_BYTES:
            skipped += 1
            print(f"  [bad bytes] {c['name']}: {len(blob) if blob else 0} bytes")
            continue
        photos_dir.mkdir(parents=True, exist_ok=True)
        rel = f"photos/{c['id']}.jpg"
        (paths.ROOT / rel).write_bytes(blob)
        meta = dict(c["meta"])
        meta["photo_source"] = f"commons:{names[0]}"
        db.execute(
            "UPDATE dam SET photo = %s, meta = %s::jsonb WHERE id = %s",
            (rel, json.dumps(meta), c["id"]),
        )
        written += 1
        print(f"  [wrote] {c['name']}: {rel} ({len(blob)} bytes)")

    print(f"resolved: {resolved}, skipped: {skipped}, written: {written}")


if __name__ == "__main__":
    run(apply="--apply" in sys.argv,
        limit=int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0)
