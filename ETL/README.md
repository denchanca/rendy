# Rendy ETL Workbench

This checkout currently carries three maintained ETL pipelines. They are intentionally config-first scripts: edit the `CONFIG` block at the top of each file, then run the script directly.

## Current Contents

| Path | Purpose | Output |
| --- | --- | --- |
| `crawl-ETL/` | Playwright crawler that executes JS and captures DOM text plus inline/external JS and CSS into `{url, text}` JSON records. | Local JSON / JSONL |
| `json-ETL/` | JSON or JSONL `{url, text}` loader with chunking, ledgers, and optional sync-delete. | Pinecone vectors |
| `sitemap-ETL/` | Playwright sitemap fetcher that extracts `<loc>` URLs and embeds the URL strings only. | Pinecone vectors |
| `sitemap-ETL/.sitemap_to_pinecone.ledger.json` | Generated ledger that records the last sitemap run. | Local state |

Detailed docs:

- [`json-ETL/README.md`](json-ETL/README.md)
- [`sitemap-ETL/README.md`](sitemap-ETL/README.md)
- [`crawl-ETL/README.md`](crawl-ETL/README.md)

## Shared Conventions

- Edit the `CONFIG` block in each script before first run.
- The Pinecone ingestion scripts write ledger files so reruns can skip unchanged work.
- `text-embedding-3-large` requires a 3072-dimension index; `text-embedding-3-small` requires 1536.
- `SYNC_DELETE_MISSING` can remove stale vectors. Turn it on only after you trust the source and namespace selection.
- Namespaces are script-controlled. Make that decision before your first large ingest to avoid reindex churn.

## Important Config Nuance

The scripts only fall back to environment variables when the matching `CONFIG` entry is unset or `None`. The checked-in credential placeholders are ordinary strings, so the safest path is to edit the `CONFIG` block directly or clear those keys before relying on env vars.

## Quick Start

### JSON or JSONL to Pinecone

```bash
cd ETL/json-ETL
python -m pip install openai pinecone pandas tqdm
# edit CONFIG in json_to_pinecone.py
python json_to_pinecone.py
```

Use this when you already have exported content, crawler output, or a curated dataset shaped like `{url, text}`.

### Crawl Website Pages to JSON

```bash
cd ETL/crawl-ETL
python3 -m pip install playwright tqdm
playwright install chromium
# edit CONFIG in crawl_to_json.py
python3 crawl_to_json.py
```

Use this when you want to start from one or more pages, crawl links up to a configured depth, execute client-side JavaScript, and produce comprehensive `{url, text}` records for later embedding.

### Sitemap URLs to Pinecone

```bash
cd ETL/sitemap-ETL
python -m pip install playwright openai pinecone tqdm
playwright install chromium
# edit CONFIG in sitemap.py
python sitemap.py
```

Use this when you want sitemap discovery coverage or lightweight URL-level retrieval without crawling page bodies.

## Operational Notes

- Ledger files are local state. Keep them if you want incremental reruns; delete them if you want to force a full re-evaluation.
- The sitemap pipeline can read remote sitemap XML, local sitemap files, or a manual URL list.
- The crawl pipeline writes JSON or JSONL records that can be ingested by the JSON pipeline without reshaping if you keep the default `url` and `text` field names.
- The JSON pipeline can read JSON arrays, JSONL, or a JSON object that contains one list value.
- Neither script currently exposes a full argparse CLI. Treat them as editable worker scripts, not packaged commands.
