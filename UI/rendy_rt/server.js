import express from 'express'
import { createServer as createViteServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRouter } from './api/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function createServer() {
  const app = express()

  app.use('/api', apiRouter)

  const vite = await createViteServer({
    server: { middlewareMode: true },
    root: __dirname,
    appType: 'spa',
  })

  app.use(vite.middlewares)

  const port = Number(process.env.PORT || 5173)
  app.listen(port, () => {
    console.log(`HashiCorp Rendy dev server listening on http://localhost:${port}`)
  })
}

createServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
