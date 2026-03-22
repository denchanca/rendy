# JSON ETL to Pinecone

[`json_to_pinecone.py`](json_to_pinecone.py) embeds JSON records into Pinecone. It expects each record to contain a URL field and a text field, and it can read either a JSON array or JSONL.

## What It Does

- Loads records from `JSON_PATH`
- Validates the configured `URL_FIELD` and `TEXT_FIELD`
- Optionally chunks text with overlap
- Embeds `URL: <url>\n\n<chunk text>` so the URL is searchable too
- Stores `url` and `text` in vector metadata
- Uses a local ledger to skip unchanged chunks on later runs
- Optionally deletes missing records from the target namespace

## Install

```bash
cd ETL/json-ETL
python -m pip install openai pinecone pandas tqdm
```

## Run

1. Edit the `CONFIG` block at the top of [`json_to_pinecone.py`](json_to_pinecone.py).
2. Set at least:
   - `JSON_PATH`
   - `INDEX_NAME`
   - `NAMESPACE`
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
3. Run:

```bash
python json_to_pinecone.py
```

## Key Settings

- `IS_JSONL`: switch to `True` for one-record-per-line JSONL files.
- `ENABLE_CHUNKING`, `CHUNK_SIZE`, `CHUNK_OVERLAP`: control the text splitter.
- `ID_FROM_URL`: keeps IDs stable per URL instead of per content hash.
- `DRY_RUN`: plans the work without embedding or upserting.
- `SYNC_DELETE_MISSING`: removes vectors not present in the latest source file.
- `AUTO_CREATE_INDEX`: creates the Pinecone index if it does not exist yet.
- `INDEX_DIM`: must match the embedding model.

## Important Config Nuance

The script only falls back to environment variables when the matching `CONFIG` key is unset or `None`. The checked-in credential placeholders are plain strings, so edit the `CONFIG` block directly unless you also clear those keys first.

## Outputs

- Pinecone vectors in the configured index/namespace
- A local ledger file, `.json_to_pinecone.ledger.json`, next to the script
