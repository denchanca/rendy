import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRouter } from './api/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use('/api', apiRouter)

const distDir = path.resolve(__dirname, 'dist')
app.use(express.static(distDir))

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(distDir, 'index.html'))
    return
  }
  next()
})

const port = Number(process.env.PORT || 4173)
app.listen(port, () => {
  console.log(`Rendy production server listening on port ${port}`)
})
