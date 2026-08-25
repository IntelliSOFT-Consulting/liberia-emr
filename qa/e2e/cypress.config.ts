import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'https://liberiaemrfacilitydev.intellisoftkenya.com/',

    setupNodeEvents(on, config) {
      // implement node event listeners here
      return config
    },
  },
})