# Crawl ETL to JSON

[`crawl_to_json.py`](crawl_to_json.py) crawls one or more seed URLs with Playwright, executes JavaScript, follows links up to a configured depth, and writes JSON records shaped like `{url, text}` so the output can feed the JSON-to-Pinecone pipeline directly.

## What It Does

- Starts from one or more `START_URLS`
- Executes JavaScript before extracting each page
- Normalizes and filters discovered links
- Optionally stays inside the start domains or a configured domain allow-list
- Follows links breadth-first up to `MAX_DEPTH`
- Captures rendered DOM text, hidden DOM text, inline JS/CSS, and external JS/CSS
- Writes either a JSON array or JSONL file

## Install

```bash
cd ETL/crawl-ETL
python3 -m pip install playwright tqdm
playwright install chromium
```

## Run

1. Edit the `CONFIG` block in [`crawl_to_json.py`](crawl_to_json.py).
2. Set at least:
   - one or more `START_URLS`
   - `OUTPUT_PATH`
   - `MAX_DEPTH`
3. Run:

```bash
python3 crawl_to_json.py
```

## Key Settings

- `MAX_DEPTH`: `0` means scrape only the seed URLs. `1` includes links found on those pages, and so on.
- `STAY_WITHIN_START_DOMAINS`: when `True`, the crawler stays on the domains derived from `START_URLS` unless `ALLOWED_DOMAINS` is explicitly set.
- `ALLOWED_DOMAINS`, `ALLOW_SUBDOMAINS`: control domain boundaries.
- `INCLUDE_PATTERNS`, `EXCLUDE_PATTERNS`: control which URLs are eligible to crawl.
- `STRIP_QUERY`, `NORMALIZE_TRAILING_SLASH`: reduce duplicate URL variants.
- `MAX_PAGES`, `MAX_LINKS_PER_PAGE`: control crawl size.
- `CAPTURE_VISIBLE_TEXT`, `CAPTURE_HIDDEN_TEXT`: control DOM text capture.
- `CAPTURE_INLINE_SCRIPTS`, `CAPTURE_EXTERNAL_SCRIPTS`: control JavaScript capture.
- `CAPTURE_INLINE_STYLES`, `CAPTURE_EXTERNAL_STYLES`: control stylesheet capture.
- `CAPTURE_STYLE_ATTRIBUTES`, `CAPTURE_EVENT_HANDLERS`: include CSS/JS living in HTML attributes.
- `PLAYWRIGHT_WAIT_UNTIL`, `PLAYWRIGHT_POST_LOAD_WAIT_MS`: tune how long the crawler waits for client-side rendering.
- `SAVE_EMPTY_TEXT`: includes pages even when the final aggregated `text` field is empty.
- `OUTPUT_FORMAT`: `json` or `jsonl`.

## Output Shape

Each saved record includes at least:

```json
{
  "url": "https://example.com/docs/page",
  "text": "Aggregated rendered text, hidden DOM text, JS, and CSS capture",
  "depth": 1
}
```

Additional fields such as `title`, `visible_text`, `hidden_text`, `inline_scripts`, `external_scripts`, `inline_styles`, `external_styles`, and `discovered_from` may be included too.

## Notes

- This crawler uses Playwright and is intended for rendered pages where content lives in the DOM, scripts, or stylesheets after client-side execution.
- Comprehensive captures can get large quickly, especially on sites with large bundled JS and CSS files. Use the character-limit config entries if needed.
- The output is compatible with [`../json-ETL/json_to_pinecone.py`](../json-ETL/json_to_pinecone.py) as long as `URL_FIELD` remains `url` and `TEXT_FIELD` remains `text`.
