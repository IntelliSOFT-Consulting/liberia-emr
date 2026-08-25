import { defineConfig } from 'cypress'
import fs from 'fs'
import path from 'path'

const envFilePath = path.resolve(__dirname, 'cypress.env.json')
const localEnv = fs.existsSync(envFilePath)
  ? JSON.parse(fs.readFileSync(envFilePath, 'utf8'))
  : {}

const defaultBaseUrl = process.env.CYPRESS_BASE_URL ?? process.env.BASE_URL ?? localEnv.baseUrl ?? 'http://localhost:8080'

export default defineConfig({
  env: {
    ...localEnv,
    baseUrl: defaultBaseUrl,
    RUN_LIVE_REGISTRATION: process.env.RUN_LIVE_REGISTRATION === 'true',
  },
  e2e: {
    baseUrl: defaultBaseUrl,
    setupNodeEvents(on, config) {
      return config
    },
  },
})