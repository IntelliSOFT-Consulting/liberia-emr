import { defineConfig } from 'cypress'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const envFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cypress.env.json')
const localEnv = fs.existsSync(envFilePath)
  ? JSON.parse(fs.readFileSync(envFilePath, 'utf8'))
  : {}

const defaultBaseUrl = process.env.CYPRESS_BASE_URL ?? process.env.BASE_URL ?? localEnv.baseUrl ?? 'http://localhost:8080'
const localAllowedHosts = localEnv.CYPRESS_BASE_URL_ALLOWLIST ?? localEnv.baseUrlAllowlist ?? localEnv.allowedBaseUrlHosts
const configuredAllowlist = [process.env.CYPRESS_BASE_URL_ALLOWLIST, process.env.BASE_URL_ALLOWLIST, localAllowedHosts]
  .find((value) => {
    if (Array.isArray(value)) {
      return value.length > 0
    }

    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return value !== undefined && value !== null
  })

const parseHostAllowlist = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim().toLowerCase())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  }

  return []
}

const assertApprovedBaseUrl = (baseUrl: string, allowlistedHosts: string[]) => {
  let hostname: string

  try {
    hostname = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    throw new Error(
      `[Cypress safety check] Invalid base URL: "${baseUrl}". ` +
      'Set CYPRESS_BASE_URL or BASE_URL to a valid absolute URL.'
    )
  }

  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const isAllowlisted = allowlistedHosts.includes(hostname)

  if (!isLocalhost && !isAllowlisted) {
    const allowlistMessage = allowlistedHosts.length > 0 ? allowlistedHosts.join(', ') : '(empty allowlist)'
    throw new Error(
      `[Cypress safety check] Refusing to run against unapproved host "${hostname}" from base URL "${baseUrl}". ` +
      'Only localhost is allowed by default. For demo/QA, set CYPRESS_BASE_URL_ALLOWLIST (or BASE_URL_ALLOWLIST) to approved hosts. ' +
      `Current allowlist: ${allowlistMessage}.`
    )
  }
}

assertApprovedBaseUrl(defaultBaseUrl, parseHostAllowlist(configuredAllowlist))

export default defineConfig({
  env: {
    ...localEnv,
    baseUrl: defaultBaseUrl,
  },
  e2e: {
    baseUrl: defaultBaseUrl,
    setupNodeEvents(on, config) {
      return config
    },
  },
})