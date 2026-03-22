import { fetch as undiciFetch, Headers, Request, Response } from 'undici'

// Ensure global fetch is available in environments that don't provide it (Node < 18).
if (!globalThis.fetch) {
  globalThis.fetch = undiciFetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
}
