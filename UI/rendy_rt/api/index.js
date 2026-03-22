import './fetchPolyfill.js'
import express from 'express'
import flowiseRouter from './flowiseProxy.js'

export const apiRouter = express.Router()

apiRouter.use('/flowise', flowiseRouter)

const handlerApp = express()
handlerApp.use('/api', apiRouter)

handlerApp.use((error, req, res, next) => {
  console.error('API router error', error)
  if (res.headersSent) {
    return next(error)
  }
  res.status(500).json({ error: 'Internal server error' })
})

handlerApp.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

export const handler = handlerApp
export default handlerApp
