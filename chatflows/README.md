# Chatflow Templates

This folder contains the two Flowise chatflow exports used by Rendy.

These files are templates, not fixed requirements. The checked-in examples use Flowise's `Postgres` vector store node with `pgvector`, a `Json File` document loader, `OpenAI Embeddings`, and `ChatOpenAI` because that matches the default Rendy setup. You can swap in any Flowise-supported vector store, document loader/source, embeddings model, or LLM you want, as long as the ingest and assistant flows still target the same indexed corpus and use compatible embeddings.

The one hard requirement in the checked-in assistant pattern is that the chat model must support tool calling, because `assistant-template.json` uses a `Tool Agent` plus `Retriever Tool`.

| File | Purpose | Use When |
| --- | --- | --- |
| `pgvector-template.json` | Example ingest flow that loads JSON content into Postgres with `pgvector` using Flowise's `Postgres` vector store node. | You need a working ingest flow and want to start from the repo's default vector-store and loader choices. |
| `assistant-template.json` | Example assistant flow that queries that same Postgres vector store through a Retriever Tool inside a Tool Agent. | You want the UI or Flowise chat to answer questions over the ingested data. |
| `HOWTO.md` | Step-by-step setup and configuration guide for both templates. | You are importing these templates into a new Flowise instance. |

## How The Two Templates Fit Together

1. Import and run `pgvector-template.json` to load content into the checked-in Postgres/pgvector example flow.
2. Import `assistant-template.json` and point its retriever/vector-store node at the same indexed corpus. In the checked-in export, that means the `Postgres` node and the `website` table.
3. Test the assistant in Flowise.
4. Set the assistant chatflow ID on the UI with `VITE_FLOWISE_CHATFLOW_ID`.

If you swap nodes, keep the same pattern: one flow ingests into your chosen vector store, and the assistant flow retrieves from that exact same indexed corpus.

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

These are just the defaults checked into the exports. Change them freely if they fit your use case better.

## What Must Match Across Both Templates

- The vector store target used by both flows.
  In the checked-in exports, that means the Postgres connection details on the `Postgres` node: `host`, `database`, `port`, `ssl`, and credential.
- The storage location or collection name used by both flows.
  In the checked-in exports, that is the vector table name, `website`.
- The embeddings family and dimensions.
  Both exports default to `text-embedding-3-small`.
- The assistant LLM must support tool calling.
  The checked-in assistant flow uses a `Tool Agent` that calls a `Retriever Tool`, so a non-tool-calling model is not compatible with this template structure.

If you change the embeddings model after ingesting data, re-ingest your content before testing the assistant against the same corpus.

## Template Map

### `pgvector-template.json`

- `Json File`
  Uploads the example JSON dataset and optionally extracts specific fields. You can replace this with any Flowise document loader or source node that emits documents.
- `Recursive Character Text Splitter`
  Splits documents before embedding and upsert.
- `OpenAI Embeddings`
  Generates vectors for the documents.
- `Postgres Record Manager`
  Tracks document writes and cleanup history for the checked-in Postgres flow.
- `Postgres`
  Writes embeddings into the checked-in Postgres/pgvector vector store. You can swap this node for another Flowise vector store if you update the assistant flow to match.

### `assistant-template.json`

- `ChatOpenAI`
  Main chat model for the agent. You can replace it with another provider or model, but it must support tool calling.
- `OpenAI Embeddings`
  Embedding model used by the retriever. You can replace it, but keep ingest and retrieval aligned on the same embeddings family and dimensions.
- `Postgres`
  Reads from the same Postgres vector table populated by the ingest flow. If you swap vector stores, this node should be replaced with the matching retriever/vector-store node.
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
- If you replace `Json File` with another loader or source, make sure it emits the text and metadata your record-manager and vector-store nodes expect.
- If you replace `Postgres` with another vector store, update both chatflows together so ingest and retrieval still point at the same index, namespace, or collection.
- If you replace `ChatOpenAI`, choose an LLM that supports tool calling. That is required for the checked-in `Tool Agent` plus `Retriever Tool` setup.
- If you replace `OpenAI Embeddings`, update both flows together and re-ingest before testing against the same corpus.

## Render-Specific Reminder

These chatflows configure Flowise, not Render. The Render wiring still lives in the root Blueprint and UI:

- [`/mnt/d/rendy/render.yaml`](/mnt/d/rendy/render.yaml)
- [`/mnt/d/rendy/README.md`](/mnt/d/rendy/README.md)
- [`/mnt/d/rendy/UI/rendy_rt/README.md`](/mnt/d/rendy/UI/rendy_rt/README.md)

After importing the assistant chatflow, set its ID on the UI service with `VITE_FLOWISE_CHATFLOW_ID`.

## Official Flowise Docs

If you swap loaders or vector stores, use the Flowise docs for the specific nodes you choose in place of the checked-in `Json File` and `Postgres` nodes.

- [Json File node](https://docs.flowiseai.com/integrations/langchain/document-loaders/json-file)
- [Postgres vector store](https://docs.flowiseai.com/integrations/langchain/vector-stores/postgres)
- [Buffer Memory](https://docs.flowiseai.com/integrations/langchain/memory/buffer-memory)
- [Retriever Tool](https://docs.flowiseai.com/integrations/langchain/tools/retriever-tool)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Chatflow-level access control](https://docs.flowiseai.com/configuration/authorization/chatflow-level)

## Next

For the full import and configuration walkthrough, start with [`HOWTO.md`](HOWTO.md).
