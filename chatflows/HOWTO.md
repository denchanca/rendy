# How To Configure And Use These Chatflow Templates

This guide walks through the two checked-in Flowise templates in the order you should use them:

1. Import and configure `pgvector-template.json`
2. Run an ingest into your chosen vector store
3. Import and configure `assistant-template.json`
4. Test the assistant in Flowise
5. Point the Rendy UI at the assistant chatflow

The checked-in templates use Flowise's `Postgres` vector store node with `pgvector`, a `Json File` loader, `OpenAI Embeddings`, and `ChatOpenAI` because that matches the default Rendy example. Those are template defaults, not required choices. You can swap to any Flowise-supported vector store, document loader/source, embeddings model, or LLM you want.

If you customize the templates, keep the same overall contract: the ingest flow must write to the same corpus that the assistant flow retrieves from, both flows must use compatible embeddings, and the assistant LLM must support tool calling because this template uses a `Tool Agent` plus `Retriever Tool`.

## Prerequisites

Before importing either template, make sure you have:

- A working Flowise instance
- A reachable vector store backend
- An OpenAI API key
- Connection details for the vector store you plan to use
- A document source your chosen loader can read

For the checked-in templates specifically, that means:

- A reachable Postgres database with the `vector` extension enabled
- Postgres connection details:
  host, database, port, username, password, and SSL setting
- A JSON dataset to ingest

If you are using Render Postgres, use the managed database connection values that Render provides for the database service.

## Step 1: Prepare The Checked-In Vector Store

If you are keeping the checked-in `Postgres` vector store node, enable `pgvector` in the target database if you have not already:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The checked-in templates default to these table names:

- Vector table: `website`
- Record manager table: `web_history`

You can keep those names or change them, but if you change the vector table name you must update both templates.

If you are using another vector store, do the equivalent setup for that backend instead and make sure both flows point at the same collection, namespace, or index.

## Step 2: Import `pgvector-template.json`

In Flowise, use the chatflow import action and import:

```text
chatflows/pgvector-template.json
```

This template contains the checked-in example nodes:

- `Json File`
- `Recursive Character Text Splitter`
- `OpenAI Embeddings`
- `Postgres Record Manager`
- `Postgres`

## Step 3: Configure The Ingest Chatflow

If you plan to keep the template structure but swap components, this is the step where you would replace `Json File`, `Postgres Record Manager`, or `Postgres` with the loader and vector-store nodes you actually want.

### `OpenAI Embeddings`

Set:

- `Connect Credential`: your OpenAI credential
- `Model Name`: keep `text-embedding-3-small` unless you want a different embedding size

The checked-in template uses `text-embedding-3-small`. If you change it, the assistant template must use the same embeddings family and dimensions for retrieval against the same corpus.

### `Postgres Record Manager`

This node is part of the checked-in Postgres example. If you switch vector stores, replace it with whatever record-manager or ingestion-tracking approach fits that backend, or remove it if your setup does not need one.

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

`Json File` is just the checked-in loader example. You can replace it with any Flowise document loader or source node that emits documents for downstream chunking and embedding.

If you keep the checked-in node, upload your JSON file to the `Json File` node.

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

If you swap in another loader, make sure it still emits the document text and metadata your vector store and any record-manager node expect.

## Step 4: Run The Ingest Chatflow

Save the chatflow and run it once against your chosen document source. In the checked-in example, that means the uploaded JSON file.

After a successful run, your vector store should contain the embedded chunks. In the checked-in example, the Postgres vector table should contain the chunks and the Postgres record-manager table should contain write history.

If this step fails, do not configure the assistant until the ingest chatflow is working end to end.

## Step 5: Import `assistant-template.json`

In Flowise, import:

```text
chatflows/assistant-template.json
```

This template contains the checked-in example nodes:

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

This is just the default template choice. You can replace it with another model or provider, but for this assistant flow the LLM must support tool calling. Without tool calling, the `Tool Agent` cannot invoke the `Retriever Tool`.

### `OpenAI Embeddings`

Set:

- `Connect Credential`: your OpenAI credential
- `Model Name`: the same embedding model used by the ingest chatflow

The default is `text-embedding-3-small`. This is just the checked-in template choice. You can change it, but keep it aligned with the ingest flow on the same embeddings family and dimensions.

### `Postgres`

This node is the checked-in retriever backend. If you switch vector stores, replace it with the matching vector-store or retriever node for the corpus you ingested.

Set:

- `Connect Credential`: your Postgres credential
- `Host`
- `Database`
- `Port`
- `SSL`
- `Table Name`: the same vector table used by ingest, `website` by default

This node must point at the exact same vectorized corpus created by the ingest flow.

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

That is fine. Flowise's `Buffer Memory` stores conversation history in Flowise's own `chat_message` table. It is separate from your retrieval corpus and vector store.

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

- The assistant is pointed at the wrong vector store target
- The ingest and assistant flows use different embeddings models
- The selected LLM does not support tool calling
- The Retriever Tool name/description is too vague
- The document loader did not extract the intended text field

## Step 8: Connect The Rendy UI

Once the assistant chatflow works in Flowise:

1. Copy the assistant chatflow ID
2. Set `VITE_FLOWISE_CHATFLOW_ID` on the `rendy-web` service
3. Redeploy the UI

This repo's UI calls Flowise through the same-origin proxy in `UI/rendy_rt/api/flowiseProxy.js`, which forwards requests to the configured assistant chatflow.

## Step 9: Troubleshooting Checklist

### Ingest Works, But The Assistant Finds Nothing

Check:

- Both templates use the same vector store target
- For the checked-in Postgres example, both templates use the same `Host`, `Database`, `Port`, `SSL`, and vector `Table Name`
- Both templates use the same embeddings model
- The assistant LLM supports tool calling
- Your document loader extracted the intended text into documents

### Record Manager Cleanup Does Not Behave The Way You Expect

Check:

- `SourceId Key` is still `source`
- The checked-in `Json File` node is actually emitting `source` metadata

If not, set `Additional Metadata` like:

```json
{
  "source": "/url",
  "url": "/url"
}
```

### Dimension Mismatch Or Retrieval Errors After Changing Models

If you change embeddings model families or dimensions, re-ingest the corpus before testing the assistant against the same retrieval target.

### The Assistant Never Calls The Retriever Tool

Check:

- The selected LLM supports tool calling
- You did not replace the `Tool Agent` with an agent or chain that cannot call tools
- The `Retriever Tool` name and description are specific enough for the model to know when to use it

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

If you swap loaders or vector stores, use the Flowise docs for the specific nodes you choose in place of the checked-in `Json File` and `Postgres` nodes.

- [Json File](https://docs.flowiseai.com/integrations/langchain/document-loaders/json-file)
- [Postgres vector store](https://docs.flowiseai.com/integrations/langchain/vector-stores/postgres)
- [Buffer Memory](https://docs.flowiseai.com/integrations/langchain/memory/buffer-memory)
- [Retriever Tool](https://docs.flowiseai.com/integrations/langchain/tools/retriever-tool)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Chatflow-level access control](https://docs.flowiseai.com/configuration/authorization/chatflow-level)
