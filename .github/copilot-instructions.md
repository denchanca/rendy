
## Copilot instructions for rendy-flow

Purpose (what this repo enables)
- Build searchable knowledge with OpenAI embeddings + Pinecone, and analytics-ready marts in Postgres. Flowise chatflows (in `chatflows/`) and system prompts (in `SRC/`) define runtime agent behavior. MCP-tool can query Postgres marts directly.

Architecture (how things fit)
- Ingestion: CSV/JSON/GitHub/Sitemaps → OpenAI embeddings → Pinecone vectors (rich metadata). CSV can also → Postgres (staging + star-schema marts).
- Runtime: Flowise chatflows load vectors by namespace and apply a system message from `SRC/` for RAG/analytics tasks.
- Namespacing: `per_repo`, `by_host`, or `single` with optional prefix/lowercasing (set per script CONFIG).

Repo anchors (start here)
- CSV→Pinecone: `ETL/CSV-SQL/csv_to_pinecone_all_columns.py` (docs: `ETL/CSV-SQL/README.md`).
- CSV→Postgres: `ETL/CSV-SQL/csv_to_postgres_marts.py` (docs: `ETL/CSV-SQL/README-postgres.md`).
- JSON→Pinecone: `ETL/json-pinecone/json_to_pinecone.py`.
- GitHub→Pinecone: `ETL/GITHUB-Pinecone/repo.py`.
- Sitemaps→Pinecone (URL-only): `ETL/www-pinecone/sitemap.py`.
- System prompts: `SRC/` (see `SRC/README.md`). Flowise chatflows: `chatflows/`.

Key conventions and patterns
- Embedding dims must match index: `text-embedding-3-large`=3072, `...-3-small`=1536. Scripts validate; many support `AUTO_CREATE_INDEX` and `INDEX_DIM`.
- Idempotency via JSON ledgers per namespace; enable sync delete with `--delete-missing` or `SYNC_DELETE_MISSING`.
- Payloads: GitHub/JSON embed `"URL: <url>\n\n<chunk>"`; Sitemap embeds the URL string; metadata always includes `url` (+ fields).
- Chunking: characters for text; lines for code. Tune via CONFIG flags; requests auto-batch and split under Pinecone’s ~2MB limit.
- Postgres marts: staging → dimensions (text/date) + fact (numeric/bool) with indexes; MCP-tool targets marts for BI queries.

Quick workflows (PowerShell examples)
- CSV→Pinecone (dry run): `python ETL\CSV-SQL\csv_to_pinecone_all_columns.py --csv C:\data.csv --index my-index --namespace default --dry-run --preview 5`.
- CSV→Postgres (env-driven): set `PG*` + `CSV_PATH`; run `python ETL\CSV-SQL\csv_to_postgres_marts.py`.
- JSON/GitHub/Sitemap→Pinecone: `python ETL\json-pinecone\json_to_pinecone.py` | `python ETL\GITHUB-Pinecone\repo.py` | `python ETL\www-pinecone\sitemap.py`.

Environment and setup
- Python 3.10+; PowerShell examples assumed. Install deps: `python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r ETL\CSV-SQL\requirements.txt` (or minimal: `pip install openai pinecone-client tqdm`; plus `playwright; playwright install chromium` for sitemaps).
- Secrets via env vars: `OPENAI_API_KEY`, `PINECONE_API_KEY`; Postgres: `PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE`.

Troubleshooting quick refs
- Dim mismatch → choose model matching index or recreate; auto-create supported where enabled.
- Missing creds → set `OPENAI_API_KEY`, `PINECONE_API_KEY`, optional `GITHUB_TOKEN` for allowlisted repos.
- Playwright checkpoints → provide `COOKIE`/headers, try non-headless, `playwright install chromium`.
- Postgres connection → verify `PG*` or use `ETL/CSV-SQL/util.env` with `--env-file`.

Adding or changing flows
- Mirror existing pattern: CONFIG block near top, env-backed defaults, ledger + optional sync delete, namespace strategy, model/index dim validation, safe batching. Document new flags in the script’s README.

If anything is unclear or missing, say which workflow you’re targeting and we’ll refine these instructions.
