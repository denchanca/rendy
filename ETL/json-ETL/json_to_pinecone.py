#!/usr/bin/env python3
"""
json_to_pinecone.py
- Embed a JSON dataset of {"url","text"} items into Pinecone.
- JSON array OR JSON Lines (one object per line).
- Character-based chunking with overlap (optional).
- Change-tracked upserts via a local hash ledger (skips unchanged).
- Optional sync-delete: removes vectors missing from the new JSON (same namespace).
- Optional serverless auto-create of Pinecone index.

What changed vs your version:
- The EMBEDDED CONTENT is now: "URL: <url>\\n\\n<chunk text>" → URL is searchable.
- Metadata also carries {"url": <url>, "text": <chunk text>} for RAG display.
"""

# =========================
# ===== CONFIG START ======
# =========================
CONFIG = {
    # --- Input ---
    "JSON_PATH": "example.json",   # JSON array OR JSONL file
    "URL_FIELD": "url",
    "TEXT_FIELD": "text",
    "IS_JSONL": False,          # True if file is JSON Lines (one JSON object per line)

    # --- Chunking (character-based, safe & simple) ---
    "ENABLE_CHUNKING": True,
    "CHUNK_SIZE": 1200,         # characters per chunk
    "CHUNK_OVERLAP": 200,       # character overlap between chunks (0..CHUNK_SIZE-1)

    # --- IDs & namespacing ---
    "INDEX_NAME": "example",        # Pinecone index name
    "NAMESPACE": "product",        # "" for default namespace
    "ID_PREFIX": "doc_",        # applied before the base id
    "ID_FROM_URL": True,        # if True, IDs derive from URL (+ chunk suffix). Else, content-hash IDs.

    # --- Behavior ---
    "BATCH_SIZE": 128,
    "MODEL": "text-embedding-3-large",   # or "text-embedding-3-small" (smaller dim & cost)
    "DRY_RUN": False,                    # True: parse & plan only
    "SYNC_DELETE_MISSING": True,        # True: delete vectors in namespace that are not in new JSON
    "LEDGER_PATH": ".json_to_pinecone.ledger.json",

    # --- Keys (or use environment variables) ---
    "OPENAI_API_KEY": "",       # or set env OPENAI_API_KEY
    "PINECONE_API_KEY": "",     # or set env PINECONE_API_KEY

    # --- Pinecone index auto-create (serverless) ---
    "AUTO_CREATE_INDEX": False,   # True to auto-create if missing
    "INDEX_DIM": 3072,            # 3072 for text-embedding-3-large; 1536 for -small
    "INDEX_METRIC": "cosine",     # "cosine" | "dotproduct" | "euclidean"
    "SERVERLESS_CLOUD": "aws",    # aws|gcp|azure (per Pinecone docs)
    "SERVERLESS_REGION": "us-east-1",
}
# =========================
# ====== CONFIG END =======
# =========================

import os, sys, json, time, hashlib
from pathlib import Path
from typing import List, Dict, Any, Iterable
from tqdm import tqdm

# Optional; used just to pretty-print counts and validate fields gracefully.
import pandas as pd

# OpenAI & Pinecone modern SDKs
from openai import OpenAI
from pinecone import Pinecone

LEDGER_VERSION = 1  # increment if you change the ledger entry format


# ---------- Helpers ----------
def get_conf(k: str, default=None):
    v = CONFIG.get(k, None)
    if v is None:
        env_v = os.getenv(k)
        return env_v if env_v is not None else default
    return v

def sha256_str(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def chunk_text(text: str, size: int, overlap: int) -> List[str]:
    if not text:
        return []
    size = max(1, int(size))
    overlap = max(0, min(int(overlap), size - 1))
    chunks = []
    i = 0
    n = len(text)
    while i < n:
        j = min(i + size, n)
        chunks.append(text[i:j])
        if j == n:
            break
        i = j - overlap
    return chunks

def load_json_records(path: Path, is_jsonl: bool) -> List[Dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"JSON not found at: {path}")
    if is_jsonl:
        out = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                out.append(json.loads(line))
        return out
    else:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    return v
            return [data]
        if not isinstance(data, list):
            raise ValueError("JSON must be an array, a JSONL file, or a dict containing a list value.")
        return data

def load_ledger(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"_version": LEDGER_VERSION, "rows": {}}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if "_version" not in data:
        data["_version"] = 0
    if "rows" not in data:
        data["rows"] = {}
    return data

def save_ledger(path: Path, ledger: Dict[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=2)
    tmp.replace(path)

def build_chunk_id(base: str, chunk_idx: int, prefix: str) -> str:
    return f"{prefix}{base}__{chunk_idx:04d}"

def ensure_pinecone_index(pc: Pinecone, index_name: str, auto_create: bool,
                          dim: int, metric: str, cloud: str, region: str) -> None:
    names = [idx["name"] for idx in pc.list_indexes()]
    if index_name in names:
        return
    if not auto_create:
        raise RuntimeError(
            f"Pinecone index '{index_name}' does not exist. "
            f"Create it first or set AUTO_CREATE_INDEX=True in CONFIG."
        )
    from pinecone import ServerlessSpec
    pc.create_index(
        name=index_name,
        dimension=int(dim),
        metric=metric,
        spec=ServerlessSpec(cloud=cloud, region=region),
    )
    # wait for ready
    while True:
        desc = pc.describe_index(index_name)
        if desc.status and desc.status.get("ready"):
            break
        time.sleep(2)

def embed_batch(oai: OpenAI, texts: List[str], model: str) -> List[List[float]]:
    resp = oai.embeddings.create(model=model, input=texts)
    return [d.embedding for d in resp.data]

def batched(items: List[Any], n: int) -> Iterable[List[Any]]:
    for i in range(0, len(items), n):
        yield items[i:i+n]


# ---------- Main ----------
def main():
    # Config
    json_path = Path(get_conf("JSON_PATH"))
    url_field = get_conf("URL_FIELD", "url")
    text_field = get_conf("TEXT_FIELD", "text")
    is_jsonl = bool(get_conf("IS_JSONL", False))

    enable_chunking = bool(get_conf("ENABLE_CHUNKING", True))
    chunk_size = int(get_conf("CHUNK_SIZE", 1200))
    chunk_overlap = int(get_conf("CHUNK_OVERLAP", 200))

    index_name = get_conf("INDEX_NAME")
    namespace = get_conf("NAMESPACE", "")
    id_prefix = get_conf("ID_PREFIX", "")
    id_from_url = bool(get_conf("ID_FROM_URL", True))

    batch_size = int(get_conf("BATCH_SIZE", 128))
    model = get_conf("MODEL", "text-embedding-3-large")
    dry_run = bool(get_conf("DRY_RUN", False))
    sync_delete = bool(get_conf("SYNC_DELETE_MISSING", False))
    ledger_path = Path(get_conf("LEDGER_PATH", ".json_to_pinecone.ledger.json"))

    openai_key = get_conf("OPENAI_API_KEY")
    pinecone_key = get_conf("PINECONE_API_KEY")

    auto_create = bool(get_conf("AUTO_CREATE_INDEX", False))
    index_dim = int(get_conf("INDEX_DIM", 3072))
    index_metric = get_conf("INDEX_METRIC", "cosine")
    cloud = get_conf("SERVERLESS_CLOUD", "aws")
    region = get_conf("SERVERLESS_REGION", "us-east-1")

    # Sanity checks
    if not json_path.exists():
        print(f"ERROR: JSON not found at {json_path}", file=sys.stderr)
        sys.exit(2)
    if not index_name:
        print("ERROR: INDEX_NAME is required.", file=sys.stderr)
        sys.exit(2)
    if not openai_key:
        print("ERROR: OPENAI_API_KEY not set in CONFIG or env.", file=sys.stderr)
        sys.exit(2)
    if not pinecone_key:
        print("ERROR: PINECONE_API_KEY not set in CONFIG or env.", file=sys.stderr)
        sys.exit(2)

    # Load records
    records = load_json_records(json_path, is_jsonl)
    if not records:
        print("No records found in JSON; nothing to do.")
        sys.exit(0)

    # Normalize records & validate fields
    df = pd.DataFrame(records)
    for col in [url_field, text_field]:
        if col not in df.columns:
            print(f"ERROR: Missing field '{col}' in records.", file=sys.stderr)
            sys.exit(2)

    # Deduplicate by URL (keep first)
    df = df.dropna(subset=[url_field, text_field])
    df = df.drop_duplicates(subset=[url_field], keep="first").reset_index(drop=True)

    # Build chunk plan
    plan = []  # list of {id, text, hash, metadata}
    for _, row in df.iterrows():
        url = str(row[url_field]).strip()
        text = str(row[text_field]) if row[text_field] is not None else ""
        if not url or not text:
            continue

        if id_from_url:
            base_id = sha256_str(url)[:24]                  # stable id per URL
        else:
            base_id = sha256_str(url + "::" + text)[:24]    # id per content

        chunks = [text]
        if enable_chunking:
            chunks = chunk_text(text, chunk_size, chunk_overlap)
            if not chunks:
                continue

        for i, chunk in enumerate(chunks):
            chunk_text_str = chunk.strip()
            if not chunk_text_str:
                continue
            vector_id = build_chunk_id(base_id, i, id_prefix)
            # Make BOTH url and text visible to RAG:
            # 1) Embedded content includes URL and chunk text
            embedded_text = f"URL: {url}\n\n{chunk_text_str}"
            # 2) Metadata also carries url + text for display
            metadata = {
                "url": url,
                "text": chunk_text_str,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "text_len": len(chunk_text_str),
            }
            # Hash URL + chunk to detect changes
            row_hash = sha256_str(url + "||" + chunk_text_str)
            plan.append({"id": vector_id, "text": embedded_text, "hash": row_hash, "metadata": metadata})

    if not plan:
        print("Nothing to index after preprocessing.")
        sys.exit(0)

    # Change detection (ledger)
    ledger = load_ledger(ledger_path)
    known = ledger.get("rows", {})
    current_ids = {p["id"] for p in plan}

    to_upsert = []
    for item in plan:
        prev = known.get(item["id"])
        needs = (prev is None) or (prev.get("hash") != item["hash"]) or (prev.get("namespace") != namespace)
        if needs:
            to_upsert.append(item)

    to_delete = []
    if sync_delete:
        for vid, meta in known.items():
            if meta.get("namespace") == namespace and vid not in current_ids:
                to_delete.append(vid)

    print(f"Docs: {len(df)} | Chunks: {len(plan)}")
    print(f"Index: {index_name} | Namespace: '{namespace or '(default)'}'")
    print(f"Plan: upsert {len(to_upsert)} new/changed", end="")
    if sync_delete:
        print(f", delete {len(to_delete)} missing.")
    else:
        print(".")

    if dry_run:
        print("DRY_RUN=True → no embedding or upserts performed.")
        sys.exit(0)

    # Init clients
    oai = OpenAI(api_key=openai_key)
    pc = Pinecone(api_key=pinecone_key)
    ensure_pinecone_index(pc, index_name, auto_create, index_dim, index_metric, cloud, region)
    index = pc.Index(index_name)

    # Upserts
    total_upserted = 0
    for batch in tqdm(list(batched(to_upsert, batch_size)), desc="Embedding+Upserting", unit="batch"):
        texts = [x["text"] for x in batch]  # embedded_text with URL + chunk
        vecs = embed_batch(oai, texts, model)
        payload = []
        for item, vec in zip(batch, vecs):
            payload.append({"id": item["id"], "values": vec, "metadata": item["metadata"]})
        index.upsert(vectors=payload, namespace=namespace)
        total_upserted += len(payload)
        # Update ledger incrementally
        for item in batch:
            known[item["id"]] = {"hash": item["hash"], "namespace": namespace}
        save_ledger(ledger_path, {"_version": LEDGER_VERSION, "rows": known})

    # Deletes
    total_deleted = 0
    if to_delete:
        for d_batch in batched(to_delete, 1000):
            index.delete(ids=d_batch, namespace=namespace)
            total_deleted += len(d_batch)
        for vid in to_delete:
            if vid in known:
                del known[vid]
        save_ledger(ledger_path, {"_version": LEDGER_VERSION, "rows": known})

    print(f"Done. Upserted: {total_upserted}, Deleted: {total_deleted}. Ledger: {ledger_path}")


if __name__ == "__main__":
    main()

