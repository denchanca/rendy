#!/usr/bin/env python3
"""
sitemap_urls_to_pinecone.py  — Playwright-only, URL-only embeddings

- Uses Playwright (Chromium) ONLY to fetch sitemap XML (handles checkpoint/CDN).
- Extracts ONLY <loc> URLs; embeds the URL string itself (no page scraping).
- Upserts to Pinecone (single index). Namespace can be per-host or single.
- Metadata per vector: {"url": "<the URL>", "text": "<the URL>"} for RAG.
- Ledger skips unchanged; optional sync-delete of stale ids.
- Upserts are auto-split to stay under Pinecone's 2 MB request limit.

Setup:
  pip install playwright openai pinecone tqdm
  playwright install chromium
"""

# =========================
# ===== CONFIG START ======
# =========================
CONFIG = {
    # --- Remote source(s) ---
    "SITEMAPS": [
        "https://developer.example.com/server-sitemap.xml",
    ],

    # Offline additions (optional)
    "LOCAL_SITEMAP_PATHS": [
        # "./server-sitemap.xml",
    ],
    "MANUAL_URL_LIST_PATH": "",  # text file with one URL per line

    # Filters
    "ALLOWED_DOMAINS": ["developer.example.com"],  # [] to allow any
    "INCLUDE_PATTERNS": [],   # substring allow-list; [] = include all
    "EXCLUDE_PATTERNS": [],   # substring block-list; [] = none
    "MAX_URLS": 1_000_000,

    # URL normalization
    "STRIP_QUERY": False,
    "NORMALIZE_TRAILING_SLASH": True,

    # Embeddings
    "MODEL": "text-embedding-3-small",   # 3072; or "text-embedding-3-small" (1536)
    "BATCH_SIZE": 256,                   # OpenAI embedding batch size

    # Pinecone (ONE index)
    "INDEX_NAME": "rendy",
    "AUTO_CREATE_INDEX": True,
    "INDEX_DIM": None,                   # None -> infer from model
    "INDEX_METRIC": "cosine",
    "SERVERLESS_CLOUD": "aws",
    "SERVERLESS_REGION": "us-east-1",

    # Namespacing
    "NAMESPACE_MODE": "single",         # "by_host" | "single"
    "NAMESPACE_NAME": "www",        # used if NAMESPACE_MODE == "single"
    "NAMESPACE_LOWERCASE": True,

    # IDs / behavior
    "ID_PREFIX": "url_",
    "DRY_RUN": False,
    "SYNC_DELETE_MISSING": False,        # delete missing IDs per namespace
    "LEDGER_PATH": ".sitemap_to_pinecone.ledger.json",

    # Keys (override here or via env)
    "OPENAI_API_KEY": "",              # or env OPENAI_API_KEY
    "PINECONE_API_KEY": "",            # or env PINECONE_API_KEY

    # Playwright browser config
    "PLAYWRIGHT_BROWSER": "chromium",    # chromium | firefox | webkit
    "PLAYWRIGHT_HEADLESS": True,
    "PLAYWRIGHT_TIMEOUT_MS": 45000,

    # Extra HTTP flavor (helps with checkpoints)
    "PLAYWRIGHT_EXTRA_HEADERS": {
        # "Referer": "https://developer.hashicorp.com/",
    },
    # Paste your browser Cookie string here if necessary
    "COOKIE": "",  # e.g., "datadome=...; _ga=...; ..."
    "DEBUG": False,
}
# =========================
# ====== CONFIG END =======
# =========================

import os, sys, io, gzip, time, json, hashlib, codecs, random
from typing import List, Dict, Any, Iterable, Tuple, Set
from urllib.parse import urlparse, urlunparse
import xml.etree.ElementTree as ET

from tqdm import tqdm
from openai import OpenAI
from pinecone import Pinecone

LEDGER_VERSION = 1
MODEL_DIMS = {"text-embedding-3-large": 3072, "text-embedding-3-small": 1536}

def get_conf(k, default=None):
    v = CONFIG.get(k)
    if v is None:
        env = os.getenv(k)
        return env if env is not None else default
    return v

def debug(*args):
    if get_conf("DEBUG", False):
        print("[DEBUG]", *args)

def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def load_ledger(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {"_version": LEDGER_VERSION, "rows": {}}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("_version", 0)
    data.setdefault("rows", {})
    return data

def save_ledger(path: str, ledger: Dict[str, Any]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def batched(seq: List[Any], n: int) -> Iterable[List[Any]]:
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def normalize_url(u: str) -> str:
    p = urlparse(u.strip())
    if get_conf("STRIP_QUERY", False):
        p = p._replace(query="", fragment="")
    path = p.path or "/"
    if get_conf("NORMALIZE_TRAILING_SLASH", True) and path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    p = p._replace(path=path)
    return urlunparse(p)

def allowed(u: str) -> bool:
    doms = set(get_conf("ALLOWED_DOMAINS", []) or [])
    if doms:
        host = urlparse(u).hostname or ""
        if host not in doms:
            return False
    inc = get_conf("INCLUDE_PATTERNS", []) or []
    exc = get_conf("EXCLUDE_PATTERNS", []) or []
    if inc and not any(s in u for s in inc):
        return False
    if exc and any(s in u for s in exc):
        return False
    return True

# -------- Playwright client (single browser for all fetches) --------
class PWClient:
    def __init__(self):
        self.browser = None
        self.ctx = None
        self.page = None

    def __enter__(self):
        try:
            from playwright.sync_api import sync_playwright
        except Exception as e:
            raise RuntimeError(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            ) from e

        self.pw = sync_playwright().start()
        browser_name = (get_conf("PLAYWRIGHT_BROWSER", "chromium") or "chromium").lower()
        headless = bool(get_conf("PLAYWRIGHT_HEADLESS", True))
        launcher = getattr(self.pw, browser_name, None)
        if launcher is None:
            raise RuntimeError(f"Unsupported PLAYWRIGHT_BROWSER '{browser_name}'")

        self.browser = launcher.launch(headless=headless)
        ua = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        )
        extra = {
            "Accept": "application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
        extra.update(get_conf("PLAYWRIGHT_EXTRA_HEADERS", {}) or {})
        self.ctx = self.browser.new_context(user_agent=ua, extra_http_headers=extra)
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(int(get_conf("PLAYWRIGHT_TIMEOUT_MS", 45000)))
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.ctx: self.ctx.close()
            if self.browser: self.browser.close()
        finally:
            if hasattr(self, "pw"): self.pw.stop()

    def _apply_cookie_for_url(self, url: str):
        cookie_str = (get_conf("COOKIE", "") or "").strip()
        if not cookie_str:
            return
        parsed = urlparse(url)
        domain = parsed.hostname or ""
        cookies = []
        for c in cookie_str.split(";"):
            c = c.strip()
            if not c:
                continue
            if "=" in c:
                name, val = c.split("=", 1)
                cookies.append({"name": name.strip(), "value": val.strip(), "domain": domain, "path": "/"})
        if cookies:
            try:
                self.ctx.add_cookies(cookies)
            except Exception as e:
                debug("add_cookies failed:", e)

    def fetch_bytes(self, url: str, retries: int = 5) -> bytes:
        self._apply_cookie_for_url(url)
        delay = 0.8
        for attempt in range(1, max(1, retries) + 1):
            try:
                resp = self.page.goto(url, wait_until="networkidle")
                body = None
                if resp and resp.ok:
                    try:
                        body = resp.body()
                    except Exception:
                        body = None
                if body is None:
                    body = self.page.content().encode("utf-8", "replace")

                # Detect obvious checkpoints and retry
                text_preview = body[:4096].decode("utf-8", "ignore")
                if any(s in text_preview for s in (
                    "Vercel Security Checkpoint",
                    "DataDome",
                    "Request unsuccessful",
                )):
                    print(f"[WARN] Checkpoint detected on attempt {attempt} for {url}; retrying…")
                    time.sleep(delay)
                    delay = min(delay * 1.75, 8.0)
                    continue

                return body
            except Exception as e:
                print(f"[WARN] Playwright error on attempt {attempt} for {url}: {e}")
                time.sleep(delay)
                delay = min(delay * 1.75, 8.0)
                continue
        raise RuntimeError(f"Failed to fetch {url} after {retries} attempts (checkpoint or network issues)")

# ---------- sitemap parsing ----------
def parse_sitemap_xml(xml_bytes: bytes) -> ET.Element:
    try:
        if xml_bytes[:2] == b"\x1f\x8b":
            xml_bytes = gzip.decompress(xml_bytes)
    except Exception:
        pass
    if xml_bytes.startswith(codecs.BOM_UTF8):
        xml_bytes = xml_bytes.lstrip(codecs.BOM_UTF8)
    return ET.fromstring(xml_bytes)

def is_sitemap_index(root: ET.Element) -> bool:
    return root.tag.lower().endswith("sitemapindex")

def tag_localname(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag

def extract_locs(root: ET.Element) -> List[str]:
    locs = []
    for child in root:
        for g in child:
            if tag_localname(g.tag) == "loc" and g.text:
                locs.append(g.text.strip())
    return locs

def collect_urls_from_sitemaps(client: PWClient, smap_urls: List[str], max_urls: int) -> List[str]:
    urls: List[str] = []
    seen_sitemaps: Set[str] = set()
    q: List[str] = [u.strip() for u in smap_urls if u and u.strip()]

    while q:
        cur = q.pop(0)
        if cur in seen_sitemaps:
            continue
        seen_sitemaps.add(cur)

        raw = client.fetch_bytes(cur)
        root = parse_sitemap_xml(raw)
        if is_sitemap_index(root):
            for loc in extract_locs(root):
                q.append(loc)
        else:
            for child in root:
                if tag_localname(child.tag) == "url":
                    for g in child:
                        if tag_localname(g.tag) == "loc" and g.text:
                            urls.append(g.text.strip())
                            if len(urls) >= max_urls:
                                return urls
    return urls

def parse_local_sitemap(path: str) -> List[str]:
    with open(path, "rb") as f:
        raw = f.read()
    root = parse_sitemap_xml(raw)
    urls: List[str] = []
    if is_sitemap_index(root):
        for loc in extract_locs(root):
            urls.append(loc)
    else:
        for child in root:
            if tag_localname(child.tag) == "url":
                for g in child:
                    if tag_localname(g.tag) == "loc" and g.text:
                        urls.append(g.text.strip())
    return urls

# ---------- Pinecone ----------
def ensure_pinecone_index(pc: Pinecone, index_name: str, want_dim: int, metric: str, cloud: str, region: str, auto_create: bool) -> int:
    names = [idx["name"] for idx in pc.list_indexes()]
    if index_name not in names:
        if not auto_create:
            raise RuntimeError(f"Pinecone index '{index_name}' missing. Create it or set AUTO_CREATE_INDEX=True.")
        from pinecone import ServerlessSpec
        pc.create_index(name=index_name, dimension=int(want_dim), metric=metric,
                        spec=ServerlessSpec(cloud=cloud, region=region))
        while True:
            desc = pc.describe_index(index_name)
            if desc.status and desc.status.get("ready"): break
            time.sleep(2)
    desc = pc.describe_index(index_name)
    idx_dim = getattr(desc, "dimension", None) or (desc.get("dimension") if isinstance(desc, dict) else None)
    if idx_dim is None:
        raise RuntimeError("Unable to determine Pinecone index dimension.")
    return int(idx_dim)

def embed_batch(oai: OpenAI, items: List[str], model: str) -> List[List[float]]:
    r = oai.embeddings.create(model=model, input=items)
    return [d.embedding for d in r.data]

def pinecone_groups_by_request_size(ns_items: List[Tuple[Dict[str, Any], List[float]]],
                                   dim: int,
                                   limit_bytes: int = 1_900_000,
                                   overhead_per_vec: int = 800):
    """
    Split (item, vec) pairs into groups whose estimated request size stays under limit_bytes.
    4 bytes per float32 + JSON/id/metadata overhead budget.
    """
    per_vec_bytes = dim * 4 + overhead_per_vec
    max_per = max(1, int((limit_bytes - 1024) // per_vec_bytes))
    for i in range(0, len(ns_items), max_per):
        yield ns_items[i:i + max_per]

# ---------- main ----------
def main():
    # Keys
    openai_key = get_conf("OPENAI_API_KEY")
    pinecone_key = get_conf("PINECONE_API_KEY")
    if not openai_key: sys.exit("ERROR: OPENAI_API_KEY not set (CONFIG or env).")
    if not pinecone_key: sys.exit("ERROR: PINECONE_API_KEY not set (CONFIG or env).")

    with PWClient() as client:
        # Collect URLs via Playwright
        print("Collecting URLs from sitemap(s)…")
        remote_urls = collect_urls_from_sitemaps(
            client,
            get_conf("SITEMAPS", []),
            int(get_conf("MAX_URLS", 1_000_000)),
        )

        # Local sitemaps
        local_urls = []
        for p in get_conf("LOCAL_SITEMAP_PATHS", []) or []:
            if os.path.isfile(p):
                print(f"[INFO] Parsing local sitemap: {p}")
                try:
                    local_urls.extend(parse_local_sitemap(p))
                except Exception as e:
                    print(f"[WARN] Failed local sitemap {p}: {e}")

        # Manual URL list
        manual_urls = []
        mup = (get_conf("MANUAL_URL_LIST_PATH", "") or "").strip()
        if mup and os.path.isfile(mup):
            print(f"[INFO] Reading manual URL list: {mup}")
            with open(mup, "r", encoding="utf-8") as f:
                for line in f:
                    s = line.strip()
                    if s: manual_urls.append(s)

    raw_urls = remote_urls + local_urls + manual_urls
    if not raw_urls:
        print("No URLs found (remote/local/manual). Nothing to do.")
        return

    # Normalize + filter
    seen = set(); urls = []
    for u in raw_urls:
        try:
            nu = normalize_url(u)
        except Exception:
            continue
        if not allowed(nu): continue
        if nu in seen: continue
        seen.add(nu); urls.append(nu)

    if not urls:
        print("No URLs after filtering. Nothing to do.")
        return

    # Namespace selection
    ns_mode = (get_conf("NAMESPACE_MODE", "by_host") or "by_host").lower()
    ns_lower = bool(get_conf("NAMESPACE_LOWERCASE", True))
    ns_single = get_conf("NAMESPACE_NAME", "all-urls")
    def ns_for_url(u: str) -> str:
        if ns_mode == "single":
            return ns_single
        host = urlparse(u).hostname or "unknown"
        return host.lower() if ns_lower else host

    # Plan: embed URL only
    id_prefix = get_conf("ID_PREFIX", "url_")
    plan: List[Dict[str, Any]] = []
    for u in urls:
        base_id = sha256(u)[:24]
        vid = f"{id_prefix}{base_id}"
        text = u
        metadata = {"url": u, "text": u}
        row_hash = sha256("URLONLY||" + u)
        plan.append({"id": vid, "text": text, "hash": row_hash, "metadata": metadata, "namespace": ns_for_url(u)})

    # Summary
    per_ns: Dict[str, int] = {}
    for p in plan: per_ns[p["namespace"]] = per_ns.get(p["namespace"], 0) + 1
    print(f"Collected {len(plan)} URLs into {len(per_ns)} namespace(s):")
    for ns, n in sorted(per_ns.items()): print(f"  - {ns}: {n}")

    # Pinecone setup
    model = get_conf("MODEL", "text-embedding-3-large")
    desired_dim = get_conf("INDEX_DIM", None) or MODEL_DIMS.get(model)
    if not desired_dim: raise RuntimeError(f"Unknown dimension for model '{model}'. Set CONFIG['INDEX_DIM'].")

    index_name = get_conf("INDEX_NAME")
    metric = get_conf("INDEX_METRIC", "cosine")
    cloud = get_conf("SERVERLESS_CLOUD", "aws")
    region = get_conf("SERVERLESS_REGION", "us-east-1")
    auto_create = bool(get_conf("AUTO_CREATE_INDEX", True))
    dry_run = bool(get_conf("DRY_RUN", False))
    sync_delete = bool(get_conf("SYNC_DELETE_MISSING", False))
    ledger_path = get_conf("LEDGER_PATH", ".sitemap_to_pinecone.ledger.json")
    batch_size = int(get_conf("BATCH_SIZE", 256))

    if not index_name: sys.exit("ERROR: CONFIG['INDEX_NAME'] required.")
    if dry_run:
        print("DRY_RUN=True → stopping before embeddings/upserts.")
        return

    oai = OpenAI(api_key=openai_key)
    pc = Pinecone(api_key=pinecone_key)
    idx_dim = ensure_pinecone_index(pc, index_name, int(desired_dim), metric, cloud, region, auto_create)
    if int(idx_dim) != int(desired_dim):
        raise RuntimeError(f"Index dim {idx_dim} != model dim {desired_dim}. Recreate index or switch model.")
    index = pc.Index(index_name)

    # Ledger delta
    ledger = load_ledger(ledger_path); known = ledger["rows"]
    current_ids = {p["id"] for p in plan}
    to_upsert = []
    for it in plan:
        prev = known.get(it["id"])
        if (prev is None) or (prev.get("hash") != it["hash"]) or (prev.get("namespace") != it["namespace"]):
            to_upsert.append(it)

    to_delete_by_ns: Dict[str, List[str]] = {}
    if sync_delete:
        for vid, meta in known.items():
            ns = meta.get("namespace","")
            if vid not in current_ids:
                to_delete_by_ns.setdefault(ns, []).append(vid)

    print(f"Plan: upsert {len(to_upsert)} new/changed" +
          (f", delete {sum(len(v) for v in to_delete_by_ns.values())} missing (by namespace)." if sync_delete else "."))

    # Embed + upsert with 2MB-safe grouping
    total_upserted = 0
    for batch in tqdm(list(batched(to_upsert, batch_size)), desc="Embedding+Upserting", unit="batch"):
        texts = [x["text"] for x in batch]
        vecs = embed_batch(oai, texts, model)

        # Group by namespace, then split into request-size-safe chunks
        by_ns: Dict[str, List[Tuple[Dict[str, Any], List[float]]]] = {}
        for it, v in zip(batch, vecs):
            by_ns.setdefault(it["namespace"], []).append((it, v))

        for ns, items in by_ns.items():
            for group in pinecone_groups_by_request_size(items, idx_dim, limit_bytes=1_900_000, overhead_per_vec=800):
                payload = [{"id": it["id"], "values": v, "metadata": it["metadata"]} for (it, v) in group]
                index.upsert(vectors=payload, namespace=ns)
                total_upserted += len(payload)

        # ledger flush
        for it in batch:
            known[it["id"]] = {"hash": it["hash"], "namespace": it["namespace"]}
        save_ledger(ledger_path, {"_version": LEDGER_VERSION, "rows": known})

    # Deletes
    total_deleted = 0
    if sync_delete and to_delete_by_ns:
        for ns, ids in to_delete_by_ns.items():
            for d in batched(ids, 1000):
                index.delete(ids=d, namespace=ns); total_deleted += len(d)
            for vid in ids:
                if vid in known: del known[vid]
        save_ledger(ledger_path, {"_version": LEDGER_VERSION, "rows": known})

    print(f"Done. Upserted: {total_upserted}, Deleted: {total_deleted}. Ledger: {ledger_path}")

if __name__ == "__main__":
    main()

