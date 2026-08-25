import { defineConfig } from 'cypress'
import fs from 'node:fs'
import path from 'node:path'

const envFilePath = path.resolve(__dirname, 'cypress.env.json')
const localEnv = fs.existsSync(envFilePath)
  ? JSON.parse(fs.readFileSync(envFilePath, 'utf8'))
  : {}

const defaultBaseUrl = process.env.CYPRESS_BASE_URL ?? process.env.BASE_URL ?? localEnv.baseUrl ?? 'http://localhost:8080'
const defaultUsername = process.env.CYPRESS_USERNAME ?? localEnv.USERNAME
const defaultPassword = process.env.CYPRESS_PASSWORD ?? localEnv.PASSWORD

export default defineConfig({
  allowCypressEnv: false,
  env: {
    ...localEnv,
    USERNAME: defaultUsername,
    PASSWORD: defaultPassword,
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