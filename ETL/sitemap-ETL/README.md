# Sitemap ETL to Pinecone

[`sitemap.py`](sitemap.py) fetches sitemap XML with Playwright, extracts `<loc>` URLs, normalizes and filters them, and embeds the URL strings into Pinecone. It does not crawl page bodies.

## What It Does

- Fetches remote sitemap XML with Playwright
- Optionally reads local sitemap XML files and a manual URL list
- Filters URLs by domain and include/exclude patterns
- Normalizes query strings and trailing slashes if configured
- Embeds the URL string itself
- Writes vectors to Pinecone using either one namespace or per-host namespaces
- Tracks prior runs in a local ledger

## Install

```bash
cd ETL/sitemap-ETL
python -m pip install playwright openai pinecone tqdm
playwright install chromium
```

## Run

1. Edit the `CONFIG` block in [`sitemap.py`](sitemap.py).
2. Set at least:
   - one or more `SITEMAPS`, `LOCAL_SITEMAP_PATHS`, or `MANUAL_URL_LIST_PATH`
   - `INDEX_NAME`
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
3. Run:

```bash
python sitemap.py
```

## Key Settings

- `ALLOWED_DOMAINS`, `INCLUDE_PATTERNS`, `EXCLUDE_PATTERNS`: control URL selection.
- `STRIP_QUERY`, `NORMALIZE_TRAILING_SLASH`: control URL normalization.
- `NAMESPACE_MODE`: `single` or `by_host`.
- `AUTO_CREATE_INDEX`: creates the target Pinecone index when missing.
- `COOKIE` and `PLAYWRIGHT_EXTRA_HEADERS`: useful when a sitemap is behind anti-bot or checkpoint behavior.
- `DRY_RUN`: lets you inspect the planned work without writing vectors.
- `SYNC_DELETE_MISSING`: deletes previously indexed IDs that are no longer present.

## Important Config Nuance

Like the JSON pipeline, this script only falls back to environment variables when the matching `CONFIG` key is unset or `None`. If you want env-driven credentials, clear the placeholder values first.

## Outputs

- Pinecone vectors containing URL-only embeddings
- `.sitemap_to_pinecone.ledger.json`, which tracks incremental state between runs
