#!/usr/bin/env python3
"""
crawl_to_json.py

- Crawls one or more seed pages with Playwright.
- Executes JavaScript before extracting content.
- Captures rendered DOM text, hidden DOM text, inline/external JS, and inline/external CSS.
- Follows links up to a configurable depth.
- Writes JSON records shaped like {"url": "...", "text": "..."} with extra structured fields.

This script is intentionally config-first to match the other ETL workers in this repo.

Setup:
  pip install playwright tqdm
  playwright install chromium
"""

# =========================
# ===== CONFIG START ======
# =========================
CONFIG = {
    # --- Crawl roots ---
    "START_URLS": [
        "https://example.com/",
    ],

    # --- Output ---
    "OUTPUT_PATH": "crawl_output.json",
    "OUTPUT_FORMAT": "json",       # "json" | "jsonl"
    "OVERWRITE_OUTPUT": True,

    # --- Crawl limits ---
    "MAX_DEPTH": 2,                # 0 = just the start URLs
    "MAX_PAGES": 100,              # number of saved page records
    "MAX_LINKS_PER_PAGE": 250,     # cap discovered links per page after filtering

    # --- Domain / URL controls ---
    "STAY_WITHIN_START_DOMAINS": True,
    "ALLOWED_DOMAINS": [],         # [] -> derive from START_URLS when STAY_WITHIN_START_DOMAINS=True
    "ALLOW_SUBDOMAINS": True,
    "INCLUDE_PATTERNS": [],        # substring allow-list; [] = include all
    "EXCLUDE_PATTERNS": [],        # substring block-list; [] = none
    "STRIP_QUERY": False,
    "NORMALIZE_TRAILING_SLASH": True,
    "SKIP_EXTENSIONS": [
        ".7z",
        ".avi",
        ".csv",
        ".doc",
        ".docx",
        ".gif",
        ".ico",
        ".jpeg",
        ".jpg",
        ".json",
        ".m4a",
        ".mov",
        ".mp3",
        ".mp4",
        ".pdf",
        ".png",
        ".ppt",
        ".pptx",
        ".rss",
        ".svg",
        ".tar",
        ".tgz",
        ".txt",
        ".wav",
        ".webm",
        ".webp",
        ".xml",
        ".zip",
    ],

    # --- Capture controls ---
    "CAPTURE_META_TAGS": True,
    "CAPTURE_VISIBLE_TEXT": True,
    "CAPTURE_HIDDEN_TEXT": True,
    "CAPTURE_INLINE_SCRIPTS": True,
    "CAPTURE_EXTERNAL_SCRIPTS": True,
    "CAPTURE_INLINE_STYLES": True,
    "CAPTURE_EXTERNAL_STYLES": True,
    "CAPTURE_STYLE_ATTRIBUTES": True,
    "CAPTURE_EVENT_HANDLERS": True,
    "INCLUDE_RENDERED_HTML": False,
    "SAVE_EMPTY_TEXT": False,

    # Optional truncation safeguards. Use None for full capture.
    "INLINE_CODE_CHAR_LIMIT": None,
    "RESOURCE_TEXT_CHAR_LIMIT": None,
    "HTML_CHAR_LIMIT": None,

    # --- Playwright browser config ---
    "PLAYWRIGHT_BROWSER": "chromium",  # chromium | firefox | webkit
    "PLAYWRIGHT_HEADLESS": True,
    "PLAYWRIGHT_TIMEOUT_MS": 45000,
    "PLAYWRIGHT_WAIT_UNTIL": "networkidle",  # commit | domcontentloaded | load | networkidle
    "PLAYWRIGHT_POST_LOAD_WAIT_MS": 500,
    "USER_AGENT": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 RendyCrawler/2.0"
    ),
    "PLAYWRIGHT_EXTRA_HEADERS": {},
    "COOKIE": "",                   # e.g., "session=abc; other=value"
    "VERIFY_SSL": True,
    "MAX_RETRIES": 3,

    # --- Logging ---
    "DEBUG": False,
}
# =========================
# ====== CONFIG END =======
# =========================

import json
import os
import re
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlparse, urlunparse

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Response, sync_playwright
from tqdm import tqdm

JS_CONTENT_TYPE_TOKENS = (
    "javascript",
    "ecmascript",
    "application/x-javascript",
    "text/jscript",
    "text/javascript1.",
)
CSS_CONTENT_TYPE_TOKENS = ("text/css", "css")

DOM_SNAPSHOT_SCRIPT = r"""
() => {
  const normalizeLines = (input) => {
    return String(input || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  };

  const uniqueStrings = (values) => {
    const output = [];
    const seen = new Set();
    for (const value of values) {
      const cleaned = String(value || "").trim();
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      output.push(cleaned);
    }
    return output;
  };

  const uniqueBlocks = (items, keyBuilder) => {
    const output = [];
    const seen = new Set();
    for (const item of items) {
      if (!item) continue;
      const key = keyBuilder(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  };

  const body = document.body || document.documentElement;
  const visibleText = normalizeLines(body ? body.innerText : document.documentElement.innerText);

  const hiddenParts = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest("script, style, noscript, template")) continue;

    const raw = String(node.nodeValue || "");
    if (!raw.trim()) continue;

    let current = parent;
    let hidden = false;
    while (current) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") {
        hidden = true;
        break;
      }
      if (current.matches && current.matches("details:not([open]) *")) {
        hidden = true;
        break;
      }
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        hidden = true;
        break;
      }
      current = current.parentElement;
    }

    if (hidden) {
      hiddenParts.push(raw);
    }
  }

  const meta = Array.from(document.querySelectorAll("meta"))
    .map((node) => {
      const key =
        node.getAttribute("name") ||
        node.getAttribute("property") ||
        node.getAttribute("http-equiv") ||
        (node.hasAttribute("charset") ? "charset" : "");
      const content = node.getAttribute("content") || node.getAttribute("charset") || "";
      if (!key || !content) return null;
      return { key, content };
    })
    .filter(Boolean);

  const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
    .map((node, index) => {
      const text = String(node.textContent || "").trim();
      if (!text) return null;
      return {
        index,
        type: node.getAttribute("type") || "text/javascript",
        text,
      };
    })
    .filter(Boolean);

  const inlineStyles = Array.from(document.querySelectorAll("style"))
    .map((node, index) => {
      const text = String(node.textContent || "").trim();
      if (!text) return null;
      return { index, text };
    })
    .filter(Boolean);

  const styleAttributes = uniqueStrings(
    Array.from(document.querySelectorAll("[style]")).map((node) => node.getAttribute("style") || "")
  );

  const eventHandlers = uniqueBlocks(
    Array.from(document.querySelectorAll("*")).flatMap((node) =>
      Array.from(node.attributes || [])
        .filter((attr) => attr.name.toLowerCase().startsWith("on") && String(attr.value || "").trim())
        .map((attr) => ({
          event: attr.name.toLowerCase(),
          text: String(attr.value || "").trim(),
        }))
    ),
    (item) => `${item.event}:::${item.text}`
  );

  const links = uniqueStrings(
    Array.from(document.querySelectorAll("a[href]"))
      .map((node) => node.href)
      .filter(Boolean)
  );

  const externalScriptUrls = uniqueStrings(
    Array.from(document.querySelectorAll("script[src]"))
      .map((node) => node.src)
      .filter(Boolean)
  );

  const externalStyleUrls = uniqueStrings(
    Array.from(document.querySelectorAll("link[href]"))
      .filter((node) => {
        const rel = String(node.getAttribute("rel") || "").toLowerCase();
        const asValue = String(node.getAttribute("as") || "").toLowerCase();
        const href = String(node.href || "").toLowerCase();
        return rel.includes("stylesheet") || asValue === "style" || href.endsWith(".css");
      })
      .map((node) => node.href)
      .filter(Boolean)
  );

  return {
    title: document.title || "",
    meta,
    visible_text: visibleText,
    hidden_text: normalizeLines(hiddenParts.join("\n")),
    links,
    inline_scripts: inlineScripts,
    external_script_urls: externalScriptUrls,
    inline_styles: inlineStyles,
    external_style_urls: externalStyleUrls,
    style_attributes: styleAttributes,
    event_handlers: eventHandlers,
  };
}
"""


class NonHtmlPageError(RuntimeError):
    pass


@dataclass
class CrawlTask:
    url: str
    depth: int
    discovered_from: Optional[str] = None


def get_conf(key: str, default=None):
    value = CONFIG.get(key)
    if value is None:
        env_value = os.getenv(key)
        return env_value if env_value is not None else default
    return value


def debug(*args) -> None:
    if get_conf("DEBUG", False):
        print("[DEBUG]", *args)


def normalize_url(url: str, strip_query_override: Optional[bool] = None) -> str:
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "https").lower()
    hostname = (parsed.hostname or "").lower()
    port = parsed.port

    netloc = hostname
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"

    path = parsed.path or "/"
    if get_conf("NORMALIZE_TRAILING_SLASH", True) and path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    strip_query = bool(get_conf("STRIP_QUERY", False)) if strip_query_override is None else bool(strip_query_override)
    query = "" if strip_query else parsed.query
    normalized = parsed._replace(
        scheme=scheme,
        netloc=netloc,
        path=path,
        query=query,
        fragment="",
    )
    return urlunparse(normalized)


def derive_allowed_domains(start_urls: Sequence[str]) -> List[str]:
    configured = [
        str(domain).strip().lower()
        for domain in (get_conf("ALLOWED_DOMAINS", []) or [])
        if str(domain).strip()
    ]
    if configured:
        return configured
    if not get_conf("STAY_WITHIN_START_DOMAINS", True):
        return []
    derived: List[str] = []
    for url in start_urls:
        host = (urlparse(url).hostname or "").strip().lower()
        if host and host not in derived:
            derived.append(host)
    return derived


def host_allowed(hostname: str, allowed_domains: Sequence[str], allow_subdomains: bool) -> bool:
    if not allowed_domains:
        return True
    host = hostname.strip().lower()
    if not host:
        return False
    for domain in allowed_domains:
        domain = domain.strip().lower()
        if not domain:
            continue
        if host == domain:
            return True
        if allow_subdomains and host.endswith(f".{domain}"):
            return True
    return False


def url_allowed(url: str, allowed_domains: Sequence[str]) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    if not host_allowed(parsed.hostname or "", allowed_domains, bool(get_conf("ALLOW_SUBDOMAINS", True))):
        return False

    include_patterns = get_conf("INCLUDE_PATTERNS", []) or []
    exclude_patterns = get_conf("EXCLUDE_PATTERNS", []) or []

    if include_patterns and not any(token in url for token in include_patterns):
        return False
    if exclude_patterns and any(token in url for token in exclude_patterns):
        return False

    return True


def has_blocked_extension(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    blocked = [str(token).lower() for token in (get_conf("SKIP_EXTENSIONS", []) or [])]
    return any(path.endswith(token) for token in blocked)


def normalize_multiline_text(raw_text: str) -> str:
    lines = []
    for line in str(raw_text or "").replace("\u00a0", " ").splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


def dedupe_strings(items: Sequence[str]) -> List[str]:
    output: List[str] = []
    seen: Set[str] = set()
    for item in items:
        normalized = str(item or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


def limit_text(text: str, limit: Optional[int]) -> Tuple[str, bool]:
    if limit is None:
        return text, False
    try:
        max_chars = int(limit)
    except (TypeError, ValueError):
        return text, False
    if max_chars <= 0 or len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def build_meta_lines(meta_entries: Sequence[Dict[str, str]]) -> str:
    lines = []
    for entry in meta_entries:
        key = str(entry.get("key", "")).strip()
        content = normalize_multiline_text(entry.get("content", ""))
        if key and content:
            lines.append(f"{key}: {content}")
    return "\n".join(lines)


def append_section(sections: List[str], heading: str, body: str) -> None:
    content = str(body or "").strip()
    if not content:
        return
    sections.append(f"## {heading}\n{content}")


def build_record_text(record: Dict[str, Any]) -> str:
    sections: List[str] = []
    append_section(sections, "Page Title", record.get("title", ""))
    if get_conf("CAPTURE_META_TAGS", True):
        append_section(sections, "Meta Tags", build_meta_lines(record.get("meta", []) or []))

    if get_conf("CAPTURE_VISIBLE_TEXT", True):
        append_section(sections, "Visible DOM Text", record.get("visible_text", ""))
    if get_conf("CAPTURE_HIDDEN_TEXT", True):
        append_section(sections, "Hidden DOM Text", record.get("hidden_text", ""))
    if get_conf("CAPTURE_STYLE_ATTRIBUTES", True):
        append_section(sections, "Inline Style Attributes", "\n\n".join(record.get("style_attributes", []) or []))
    if get_conf("CAPTURE_EVENT_HANDLERS", True):
        event_handler_lines = [
            f"{entry.get('event', 'handler')}: {entry.get('text', '').strip()}"
            for entry in (record.get("event_handlers", []) or [])
            if str(entry.get("text", "")).strip()
        ]
        append_section(sections, "Inline Event Handlers", "\n\n".join(event_handler_lines))

    if get_conf("CAPTURE_INLINE_SCRIPTS", True):
        for idx, entry in enumerate(record.get("inline_scripts", []) or [], start=1):
            script_type = str(entry.get("type", "text/javascript")).strip()
            body = str(entry.get("text", "")).strip()
            append_section(sections, f"Inline Script {idx} ({script_type})", body)

    if get_conf("CAPTURE_EXTERNAL_SCRIPTS", True):
        for idx, entry in enumerate(record.get("external_scripts", []) or [], start=1):
            label = str(entry.get("url", f"external-script-{idx}")).strip()
            body = str(entry.get("text", "")).strip()
            append_section(sections, f"External Script {idx}: {label}", body)

    if get_conf("CAPTURE_INLINE_STYLES", True):
        for idx, entry in enumerate(record.get("inline_styles", []) or [], start=1):
            body = str(entry.get("text", "")).strip()
            append_section(sections, f"Inline Style {idx}", body)

    if get_conf("CAPTURE_EXTERNAL_STYLES", True):
        for idx, entry in enumerate(record.get("external_styles", []) or [], start=1):
            label = str(entry.get("url", f"external-style-{idx}")).strip()
            body = str(entry.get("text", "")).strip()
            append_section(sections, f"External Style {idx}: {label}", body)

    if get_conf("INCLUDE_RENDERED_HTML", False):
        append_section(sections, "Rendered HTML", str(record.get("rendered_html", "")).strip())

    return "\n\n".join(sections).strip()


def write_records(path: Path, records: Sequence[Dict[str, Any]], output_format: str) -> None:
    if output_format == "jsonl":
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return

    with path.open("w", encoding="utf-8") as handle:
        json.dump(list(records), handle, ensure_ascii=False, indent=2)


class PlaywrightCrawler:
    def __init__(self) -> None:
        self.browser = None
        self.context = None
        self.page = None
        self.pw = None
        self.network_scripts: Dict[str, Dict[str, Any]] = {}
        self.network_styles: Dict[str, Dict[str, Any]] = {}

    def __enter__(self) -> "PlaywrightCrawler":
        self.pw = sync_playwright().start()
        browser_name = str(get_conf("PLAYWRIGHT_BROWSER", "chromium") or "chromium").lower()
        launcher = getattr(self.pw, browser_name, None)
        if launcher is None:
            raise RuntimeError(f"Unsupported PLAYWRIGHT_BROWSER '{browser_name}'")

        headers = get_conf("PLAYWRIGHT_EXTRA_HEADERS", None)
        if headers is None:
            headers = {}

        self.browser = launcher.launch(headless=bool(get_conf("PLAYWRIGHT_HEADLESS", True)))
        self.context = self.browser.new_context(
            user_agent=str(get_conf("USER_AGENT", "RendyCrawler/2.0")),
            extra_http_headers=headers or {},
            ignore_https_errors=not bool(get_conf("VERIFY_SSL", True)),
        )
        self.page = self.context.new_page()
        self.page.set_default_timeout(int(get_conf("PLAYWRIGHT_TIMEOUT_MS", 45000)))
        self.page.on("response", self._handle_response)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self.context is not None:
                self.context.close()
            if self.browser is not None:
                self.browser.close()
        finally:
            if self.pw is not None:
                self.pw.stop()

    def _handle_response(self, response: Response) -> None:
        try:
            request = response.request
            resource_type = str(request.resource_type or "").lower()
            url = normalize_url(response.url, strip_query_override=False)
            headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
            content_type = headers.get("content-type", "").lower()

            capture_as_script = (
                resource_type == "script"
                or url.endswith((".js", ".mjs", ".cjs"))
                or any(token in content_type for token in JS_CONTENT_TYPE_TOKENS)
            )
            capture_as_style = (
                resource_type == "stylesheet"
                or url.endswith(".css")
                or any(token in content_type for token in CSS_CONTENT_TYPE_TOKENS)
            )

            if not capture_as_script and not capture_as_style:
                return

            text = response.text()
            if not text or not text.strip():
                return

            limit = get_conf("RESOURCE_TEXT_CHAR_LIMIT", None)
            limited_text, truncated = limit_text(text.strip(), limit)
            entry = {
                "url": url,
                "status": response.status,
                "content_type": content_type,
                "text": limited_text,
                "source": "network",
            }
            if truncated:
                entry["truncated"] = True

            if capture_as_script:
                self.network_scripts[url] = entry
            if capture_as_style:
                self.network_styles[url] = entry
        except Exception as exc:
            debug("Unable to capture resource response:", response.url, exc)

    def _apply_cookie_for_url(self, url: str) -> None:
        cookie_str = str(get_conf("COOKIE", "") or "").strip()
        if not cookie_str:
            return
        parsed = urlparse(url)
        domain = parsed.hostname or ""
        cookies = []
        for chunk in cookie_str.split(";"):
            chunk = chunk.strip()
            if not chunk or "=" not in chunk:
                continue
            name, value = chunk.split("=", 1)
            cookies.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": domain,
                "path": "/",
            })
        if cookies:
            try:
                self.context.add_cookies(cookies)
            except Exception as exc:
                debug("add_cookies failed:", exc)

    def _fetch_missing_resources(self, urls: Sequence[str], resource_type: str) -> List[Dict[str, Any]]:
        existing = self.network_scripts if resource_type == "script" else self.network_styles
        results = list(existing.values())
        timeout_ms = int(get_conf("PLAYWRIGHT_TIMEOUT_MS", 45000))

        for raw_url in dedupe_strings(urls):
            normalized_url = normalize_url(raw_url, strip_query_override=False)
            if normalized_url in existing:
                continue
            try:
                response = self.page.request.get(normalized_url, timeout=timeout_ms)
                headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
                content_type = headers.get("content-type", "").lower()
                text = response.text()
                if not text or not text.strip():
                    continue

                limit = get_conf("RESOURCE_TEXT_CHAR_LIMIT", None)
                limited_text, truncated = limit_text(text.strip(), limit)
                entry = {
                    "url": normalized_url,
                    "status": response.status,
                    "content_type": content_type,
                    "text": limited_text,
                    "source": "dom_request",
                }
                if truncated:
                    entry["truncated"] = True

                existing[normalized_url] = entry
                results.append(entry)
            except Exception as exc:
                debug(f"Unable to fetch external {resource_type} resource:", normalized_url, exc)

        return results

    def fetch_page(self, url: str) -> Dict[str, Any]:
        max_retries = max(1, int(get_conf("MAX_RETRIES", 3)))
        wait_until = str(get_conf("PLAYWRIGHT_WAIT_UNTIL", "networkidle") or "networkidle")
        timeout_ms = int(get_conf("PLAYWRIGHT_TIMEOUT_MS", 45000))
        post_load_wait_ms = max(0, int(get_conf("PLAYWRIGHT_POST_LOAD_WAIT_MS", 0)))
        last_error: Optional[Exception] = None

        for attempt in range(1, max_retries + 1):
            self.network_scripts = {}
            self.network_styles = {}
            try:
                self._apply_cookie_for_url(url)
                response = self.page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                if response is None:
                    raise RuntimeError(f"No navigation response for {url}")
                if response.status >= 400:
                    raise RuntimeError(f"Navigation returned HTTP {response.status} for {url}")

                content_type = str((response.headers or {}).get("content-type", "")).lower()
                if content_type and "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                    raise NonHtmlPageError(f"Non-HTML page at {url}: {content_type}")

                if post_load_wait_ms > 0:
                    self.page.wait_for_timeout(post_load_wait_ms)

                snapshot = self.page.evaluate(DOM_SNAPSHOT_SCRIPT)
                final_url = normalize_url(self.page.url)

                inline_limit = get_conf("INLINE_CODE_CHAR_LIMIT", None)
                inline_scripts = []
                for entry in snapshot.get("inline_scripts", []) or []:
                    text, truncated = limit_text(str(entry.get("text", "")).strip(), inline_limit)
                    if not text:
                        continue
                    item = {
                        "index": entry.get("index"),
                        "type": str(entry.get("type", "text/javascript")),
                        "text": text,
                    }
                    if truncated:
                        item["truncated"] = True
                    inline_scripts.append(item)

                inline_styles = []
                for entry in snapshot.get("inline_styles", []) or []:
                    text, truncated = limit_text(str(entry.get("text", "")).strip(), inline_limit)
                    if not text:
                        continue
                    item = {
                        "index": entry.get("index"),
                        "text": text,
                    }
                    if truncated:
                        item["truncated"] = True
                    inline_styles.append(item)

                rendered_html = None
                if get_conf("INCLUDE_RENDERED_HTML", False):
                    html_limit = get_conf("HTML_CHAR_LIMIT", None)
                    html_value, truncated = limit_text(self.page.content(), html_limit)
                    rendered_html = html_value
                    if truncated:
                        snapshot["rendered_html_truncated"] = True

                external_scripts = self._fetch_missing_resources(
                    snapshot.get("external_script_urls", []) or [],
                    "script",
                ) if get_conf("CAPTURE_EXTERNAL_SCRIPTS", True) else []

                external_styles = self._fetch_missing_resources(
                    snapshot.get("external_style_urls", []) or [],
                    "style",
                ) if get_conf("CAPTURE_EXTERNAL_STYLES", True) else []

                visible_text = normalize_multiline_text(snapshot.get("visible_text", "")) if get_conf("CAPTURE_VISIBLE_TEXT", True) else ""
                hidden_text = normalize_multiline_text(snapshot.get("hidden_text", "")) if get_conf("CAPTURE_HIDDEN_TEXT", True) else ""
                meta_entries = (snapshot.get("meta", []) or []) if get_conf("CAPTURE_META_TAGS", True) else []
                style_attributes = dedupe_strings(snapshot.get("style_attributes", []) or [])
                event_handlers = [
                    {
                        "event": str(entry.get("event", "")).strip(),
                        "text": str(entry.get("text", "")).strip(),
                    }
                    for entry in (snapshot.get("event_handlers", []) or [])
                    if str(entry.get("text", "")).strip()
                ]

                payload: Dict[str, Any] = {
                    "url": final_url,
                    "title": normalize_multiline_text(snapshot.get("title", "")),
                    "meta": meta_entries,
                    "visible_text": visible_text,
                    "hidden_text": hidden_text,
                    "links": [normalize_url(link) for link in dedupe_strings(snapshot.get("links", []) or [])],
                    "inline_scripts": inline_scripts if get_conf("CAPTURE_INLINE_SCRIPTS", True) else [],
                    "external_scripts": external_scripts if get_conf("CAPTURE_EXTERNAL_SCRIPTS", True) else [],
                    "inline_styles": inline_styles if get_conf("CAPTURE_INLINE_STYLES", True) else [],
                    "external_styles": external_styles if get_conf("CAPTURE_EXTERNAL_STYLES", True) else [],
                    "style_attributes": style_attributes if get_conf("CAPTURE_STYLE_ATTRIBUTES", True) else [],
                    "event_handlers": event_handlers if get_conf("CAPTURE_EVENT_HANDLERS", True) else [],
                }
                if rendered_html is not None:
                    payload["rendered_html"] = rendered_html
                    if snapshot.get("rendered_html_truncated"):
                        payload["rendered_html_truncated"] = True

                payload["text"] = build_record_text(payload)
                return payload
            except NonHtmlPageError:
                raise
            except Exception as exc:
                last_error = exc
                if attempt >= max_retries:
                    break
                print(f"[WARN] Playwright fetch failed on attempt {attempt} for {url}: {exc}")
                time.sleep(min(2 ** (attempt - 1), 8))

        raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def main() -> None:
    start_urls = [normalize_url(url) for url in (get_conf("START_URLS", []) or []) if str(url).strip()]
    if not start_urls:
        print("ERROR: START_URLS must contain at least one URL.", file=sys.stderr)
        sys.exit(2)

    output_path = Path(str(get_conf("OUTPUT_PATH", "crawl_output.json")))
    output_format = str(get_conf("OUTPUT_FORMAT", "json")).strip().lower()
    overwrite_output = bool(get_conf("OVERWRITE_OUTPUT", True))
    max_depth = max(0, int(get_conf("MAX_DEPTH", 2)))
    max_pages = max(1, int(get_conf("MAX_PAGES", 100)))
    max_links_per_page = max(1, int(get_conf("MAX_LINKS_PER_PAGE", 250)))
    save_empty_text = bool(get_conf("SAVE_EMPTY_TEXT", False))

    if output_format not in {"json", "jsonl"}:
        print("ERROR: OUTPUT_FORMAT must be 'json' or 'jsonl'.", file=sys.stderr)
        sys.exit(2)

    if output_path.exists() and not overwrite_output:
        print(f"ERROR: OUTPUT_PATH already exists and OVERWRITE_OUTPUT is False: {output_path}", file=sys.stderr)
        sys.exit(2)

    allowed_domains = derive_allowed_domains(start_urls)
    debug("Allowed domains:", allowed_domains or "[any]")

    invalid_starts = [url for url in start_urls if not url_allowed(url, allowed_domains)]
    if invalid_starts:
        print("ERROR: Some START_URLS are outside the configured domain/filter rules:", file=sys.stderr)
        for url in invalid_starts:
            print(f"  - {url}", file=sys.stderr)
        sys.exit(2)

    queue: Deque[CrawlTask] = deque(CrawlTask(url=url, depth=0) for url in start_urls)
    scheduled: Set[str] = set(start_urls)
    visited: Set[str] = set()
    records: List[Dict[str, Any]] = []

    skipped_non_html = 0
    skipped_empty = 0
    skipped_filtered = 0
    failed = 0

    progress = tqdm(total=max_pages, desc="Pages saved")
    try:
        with PlaywrightCrawler() as crawler:
            while queue and len(records) < max_pages:
                task = queue.popleft()

                if task.url in visited:
                    continue
                if has_blocked_extension(task.url):
                    debug("Skipping blocked extension:", task.url)
                    visited.add(task.url)
                    skipped_filtered += 1
                    continue

                try:
                    page = crawler.fetch_page(task.url)
                except NonHtmlPageError as exc:
                    debug(exc)
                    visited.add(task.url)
                    skipped_non_html += 1
                    continue
                except PlaywrightError as exc:
                    print(f"[WARN] Playwright error for {task.url}: {exc}")
                    visited.add(task.url)
                    failed += 1
                    continue
                except Exception as exc:
                    print(f"[WARN] {exc}")
                    visited.add(task.url)
                    failed += 1
                    continue

                final_url = str(page.get("url", task.url))
                visited.add(task.url)
                visited.add(final_url)
                scheduled.add(final_url)

                if has_blocked_extension(final_url) or not url_allowed(final_url, allowed_domains):
                    debug("Skipping disallowed final URL:", final_url)
                    skipped_filtered += 1
                    continue

                page_text = str(page.get("text", "")).strip()
                if not page_text and not save_empty_text:
                    debug("Skipping empty text page:", final_url)
                    skipped_empty += 1
                else:
                    record: Dict[str, Any] = {
                        "url": final_url,
                        "text": page_text,
                        "depth": task.depth,
                    }
                    for key in (
                        "title",
                        "meta",
                        "visible_text",
                        "hidden_text",
                        "inline_scripts",
                        "external_scripts",
                        "inline_styles",
                        "external_styles",
                        "style_attributes",
                        "event_handlers",
                        "rendered_html",
                        "rendered_html_truncated",
                    ):
                        if key in page:
                            record[key] = page[key]
                    if task.discovered_from:
                        record["discovered_from"] = task.discovered_from

                    records.append(record)
                    progress.update(1)

                if task.depth >= max_depth:
                    continue

                accepted_links = 0
                for candidate in page.get("links", []) or []:
                    if accepted_links >= max_links_per_page:
                        break
                    if candidate in scheduled or candidate in visited:
                        continue
                    if has_blocked_extension(candidate):
                        continue
                    if not url_allowed(candidate, allowed_domains):
                        continue

                    queue.append(CrawlTask(url=candidate, depth=task.depth + 1, discovered_from=final_url))
                    scheduled.add(candidate)
                    accepted_links += 1
    finally:
        progress.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_records(output_path, records, output_format)

    print()
    print("Crawl complete.")
    print(f"Saved pages: {len(records)}")
    print(f"Output: {output_path}")
    print(f"Allowed domains: {allowed_domains or ['<any>']}")
    print(f"Skipped non-HTML: {skipped_non_html}")
    print(f"Skipped empty text: {skipped_empty}")
    print(f"Skipped filtered URLs: {skipped_filtered}")
    print(f"Fetch failures: {failed}")


if __name__ == "__main__":
    main()
