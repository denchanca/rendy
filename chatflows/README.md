# Chatflow Templates

This folder contains the two Flowise chatflow exports used by Rendy:

| File | Purpose | Use When |
| --- | --- | --- |
| `pgvector-template.json` | Ingest JSON content into Postgres with `pgvector` using Flowise's Postgres vector store node. | You need to chunk and upsert source content before asking questions. |
| `assistant-template.json` | Query the Postgres vector store through a Retriever Tool inside a Tool Agent. | You want the UI or Flowise chat to answer questions over the ingested data. |
| `HOWTO.md` | Step-by-step setup and configuration guide for both templates. | You are importing these templates into a new Flowise instance. |

## How The Two Templates Fit Together

1. Import and run `pgvector-template.json` to load content into Postgres/pgvector.
2. Import `assistant-template.json` and point its Postgres node at the same vector table.
3. Test the assistant in Flowise.
4. Set the assistant chatflow ID on the UI with `VITE_FLOWISE_CHATFLOW_ID`.

## Defaults Checked Into These Exports

| Setting | `pgvector-template.json` | `assistant-template.json` |
| --- | --- | --- |
| Embeddings model | `text-embedding-3-small` | `text-embedding-3-small` |
| Chat model | n/a | `gpt-5.4` |
| Vector table | `website` | `website` |
| Record manager table | `web_history` | n/a |
| SSL | `true` | `true` |
| Chunking | `1000` size / `200` overlap | n/a |
| Memory | n/a | `Buffer Memory` with `chat_history` |

## What Must Match Across Both Templates

- The Postgres connection details on the Postgres vector store node:
  `host`, `database`, `port`, `ssl`, and credential.
- The vector table name:
  `website` by default in both exports.
- The embeddings family and dimensions:
  both exports default to `text-embedding-3-small`.

If you change the embeddings model after ingesting data, re-ingest your content before testing the assistant against the same table.

## Template Map

### `pgvector-template.json`

- `Json File`
  Upload the JSON dataset and optionally extract specific fields.
- `Recursive Character Text Splitter`
  Splits documents before embedding and upsert.
- `OpenAI Embeddings`
  Generates vectors for the documents.
- `Postgres Record Manager`
  Tracks document writes and cleanup history.
- `Postgres`
  Writes embeddings into the Postgres/pgvector vector store.

### `assistant-template.json`

- `ChatOpenAI`
  Main chat model for the agent.
- `OpenAI Embeddings`
  Embedding model used by the Postgres retriever.
- `Postgres`
  Reads from the same Postgres vector table populated by the ingest flow.
- `Retriever Tool`
  Exposes retrieval as a tool the agent can call.
- `Buffer Memory`
  Stores and retrieves conversation history from Flowise's own `chat_message` table.
- `Tool Agent`
  Orchestrates the model, memory, and retriever tool.

## Important Configuration Notes

- The checked-in `pgvector-template.json` uses `cleanup: incremental` and `sourceIdKey: source` on the `Postgres Record Manager` node.
- If your JSON data has a URL field, set the `Json File` node's `Additional Metadata` so each document includes `source`, for example:

```json
{
  "source": "/url",
  "url": "/url"
}
```

- If your text lives under a field such as `body`, set `Pointers Extraction` to that field name, for example:

```text
body
```

- The `Retriever Tool` in `assistant-template.json` ships with placeholder name and description. Replace both with something specific to your corpus so the agent knows when to call it.

## Render-Specific Reminder

These chatflows configure Flowise, not Render. The Render wiring still lives in the root Blueprint and UI:

- [`/mnt/d/rendy/render.yaml`](/mnt/d/rendy/render.yaml)
- [`/mnt/d/rendy/README.md`](/mnt/d/rendy/README.md)
- [`/mnt/d/rendy/UI/rendy_rt/README.md`](/mnt/d/rendy/UI/rendy_rt/README.md)

After importing the assistant chatflow, set its ID on the UI service with `VITE_FLOWISE_CHATFLOW_ID`.

## Official Flowise Docs

- [Json File node](https://docs.flowiseai.com/integrations/langchain/document-loaders/json-file)
- [Postgres vector store](https://docs.flowiseai.com/integrations/langchain/vector-stores/postgres)
- [Buffer Memory](https://docs.flowiseai.com/integrations/langchain/memory/buffer-memory)
- [Retriever Tool](https://docs.flowiseai.com/integrations/langchain/tools/retriever-tool)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Chatflow-level access control](https://docs.flowiseai.com/configuration/authorization/chatflow-level)

## Next

For the full import and configuration walkthrough, start with [`HOWTO.md`](HOWTO.md).
