# How To Configure And Use These Chatflow Templates

This guide walks through the two checked-in Flowise templates in the order you should use them:

1. Import and configure `pgvector-template.json`
2. Run an ingest into Postgres/pgvector
3. Import and configure `assistant-template.json`
4. Test the assistant in Flowise
5. Point the Rendy UI at the assistant chatflow

## Prerequisites

Before importing either template, make sure you have:

- A working Flowise instance
- A reachable Postgres database with the `vector` extension enabled
- An OpenAI API key
- Postgres connection details:
  host, database, port, username, password, and SSL setting
- A JSON dataset to ingest

If you are using Render Postgres, use the managed database connection values that Render provides for the database service.

## Step 1: Prepare Postgres

Enable `pgvector` in the target database if you have not already:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The templates default to these table names:

- Vector table: `website`
- Record manager table: `web_history`

You can keep those names or change them, but if you change the vector table name you must update both templates.

## Step 2: Import `pgvector-template.json`

In Flowise, use the chatflow import action and import:

```text
chatflows/pgvector-template.json
```

This template contains:

- `Json File`
- `Recursive Character Text Splitter`
- `OpenAI Embeddings`
- `Postgres Record Manager`
- `Postgres`

## Step 3: Configure The Ingest Chatflow

### `OpenAI Embeddings`

Set:

- `Connect Credential`: your OpenAI credential
- `Model Name`: keep `text-embedding-3-small` unless you want a different embedding size

The checked-in template uses `text-embedding-3-small`. If you change it, the assistant template must use the same embeddings family for retrieval against the same table.

### `Postgres Record Manager`

Set:

- `Connect Credential`: your Postgres credential
- `Host`
- `Database`
- `Port`
- `SSL`

Defaults worth understanding:

- `Table Name`: `web_history`
- `Cleanup`: `incremental`
- `SourceId Key`: `source`

`incremental` cleanup works best when each document has stable metadata under the configured `sourceIdKey`.

### `Postgres`

Set the same connection values as the record manager node:

- `Connect Credential`
- `Host`
- `Database`
- `Port`
- `SSL`

Defaults worth understanding:

- `Table Name`: `website`
- `Distance Strategy`: `cosine`

This is the vector table that the assistant template must query later.

### `Json File`

Upload your JSON file to the `Json File` node.

The checked-in template already enables:

- `Separate by JSON Object = true`

That means Flowise will process each top-level object separately.

If your dataset needs explicit field extraction, configure:

- `Pointers Extraction`
- `Additional Metadata`

Recommended shape for URL-backed content:

Input JSON:

```json
[
  {
    "url": "https://example.com/docs/page-1",
    "body": "Your actual page content goes here."
  }
]
```

Recommended node settings:

- `Pointers Extraction`

```text
body
```

- `Additional Metadata`

```json
{
  "source": "/url",
  "url": "/url"
}
```

That keeps `sourceIdKey = source` meaningful for record-manager cleanup and also preserves the URL as metadata for retrieved documents.

### `Recursive Character Text Splitter`

The checked-in defaults are:

- `Chunk Size`: `1000`
- `Chunk Overlap`: `200`

Those are reasonable defaults for general text corpora. Change them only if your documents are unusually short, long, or highly structured.

## Step 4: Run The Ingest Chatflow

Save the chatflow and run it once against your uploaded JSON file.

After a successful run, your Postgres vector table should contain the embedded chunks, and the record manager table should contain write history.

If this step fails, do not configure the assistant until the ingest chatflow is working end to end.

## Step 5: Import `assistant-template.json`

In Flowise, import:

```text
chatflows/assistant-template.json
```

This template contains:

- `ChatOpenAI`
- `OpenAI Embeddings`
- `Postgres`
- `Retriever Tool`
- `Buffer Memory`
- `Tool Agent`

## Step 6: Configure The Assistant Chatflow

### `ChatOpenAI`

Set:

- `Connect Credential`: your OpenAI credential
- `Model Name`: the chat model you want to use

Checked-in defaults:

- `Model Name`: `gpt-5.4`
- `Temperature`: `0.2`
- `Streaming`: enabled

### `OpenAI Embeddings`

Set:

- `Connect Credential`: your OpenAI credential
- `Model Name`: the same embedding model used by the ingest chatflow

The default is `text-embedding-3-small`. Keep it aligned with the ingest flow.

### `Postgres`

Set:

- `Connect Credential`: your Postgres credential
- `Host`
- `Database`
- `Port`
- `SSL`
- `Table Name`: the same vector table used by ingest, `website` by default

This node must point at the exact same vectorized corpus created by `pgvector-template.json`.

### `Retriever Tool`

Do not leave the checked-in placeholder values as-is.

Update:

- `Retriever Name`
- `Retriever Description`

Example:

```text
Retriever Name: render_docs_search
Retriever Description: Search the indexed Render product and deployment knowledge base when the user asks about documentation, platform behavior, configuration, troubleshooting, or architecture guidance.
```

This description matters because the agent uses it to decide when retrieval should be invoked.

### `Buffer Memory`

The checked-in template leaves `Session Id` blank and keeps:

- `Memory Key`: `chat_history`

That is fine. Flowise's `Buffer Memory` stores conversation history in Flowise's own `chat_message` table. It is separate from your Postgres vector table.

### `Tool Agent`

Tune as needed:

- `System Message`
- `Max Iterations`
- `Enable Detailed Streaming`

The checked-in system message is just a starting point. Replace it with instructions that match your real assistant.

## Step 7: Test In Flowise

Before wiring the UI, test the assistant chatflow directly in Flowise.

Recommended checks:

- Ask a question that should clearly hit your ingested corpus
- Confirm that the tool is used when retrieval is needed
- Confirm that returned answers contain the right context
- Confirm that repeated messages preserve history as expected

If answers are weak, the usual causes are:

- The assistant is pointed at the wrong Postgres table
- The ingest and assistant flows use different embeddings models
- The Retriever Tool name/description is too vague
- The JSON loader did not extract the intended text field

## Step 8: Connect The Rendy UI

Once the assistant chatflow works in Flowise:

1. Copy the assistant chatflow ID
2. Set `VITE_FLOWISE_CHATFLOW_ID` on the `rendy-web` service
3. Redeploy the UI

This repo's UI calls Flowise through the same-origin proxy in `UI/rendy_rt/api/flowiseProxy.js`, which forwards requests to the configured assistant chatflow.

## Step 9: Troubleshooting Checklist

### Ingest Works, But The Assistant Finds Nothing

Check:

- Both templates use the same `Host`, `Database`, `Port`, `SSL`, and vector `Table Name`
- Both templates use the same embeddings model
- Your JSON loader extracted the intended text into documents

### Record Manager Cleanup Does Not Behave The Way You Expect

Check:

- `SourceId Key` is still `source`
- The `Json File` node is actually emitting `source` metadata

If not, set `Additional Metadata` like:

```json
{
  "source": "/url",
  "url": "/url"
}
```

### Dimension Mismatch Or Retrieval Errors After Changing Models

If you change embeddings model families or dimensions, re-ingest the corpus before testing the assistant against the same table.

### Conversation History Does Not Feel Sticky

`Buffer Memory` depends on a stable session identifier across requests. The Rendy UI persists chat and session IDs and sends them with each request, so test the full browser flow after you validate the chatflow in Flowise.

## Step 10: Optional Hardening

Flowise supports chatflow-level API keys. By default, a chatflow is public to anyone who knows the chatflow ID.

If you enable chatflow-level protection:

- assign an API key to the chatflow in Flowise
- send `Authorization: Bearer <your-api-key>` with prediction requests

Important repo-specific note:

- the current Rendy proxy does not attach a Flowise API key automatically
- if you protect the chatflow, you must update the proxy or call Flowise through a path that includes the correct authorization header

## Official Flowise Docs

- [Json File](https://docs.flowiseai.com/integrations/langchain/document-loaders/json-file)
- [Postgres vector store](https://docs.flowiseai.com/integrations/langchain/vector-stores/postgres)
- [Buffer Memory](https://docs.flowiseai.com/integrations/langchain/memory/buffer-memory)
- [Retriever Tool](https://docs.flowiseai.com/integrations/langchain/tools/retriever-tool)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Chatflow-level access control](https://docs.flowiseai.com/configuration/authorization/chatflow-level)
