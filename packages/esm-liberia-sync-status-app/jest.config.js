module.exports = {
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  // The framework ships its mock as TypeScript, so it has to be transformed too.
  transformIgnorePatterns: ['/node_modules/(?!(@openmrs|temporal-polyfill|temporal-utils))'],
  moduleNameMapper: {
    '\\.(s?css)$': 'identity-obj-proxy',
    '^@openmrs/esm-framework$': '@openmrs/esm-framework/mock',
    '^lodash-es$': 'lodash',
    '^lodash-es/(.*)$': 'lodash/$1',
    // dexie, pulled in by the framework, ships ES modules only.
    '^dexie$': require.resolve('dexie'),
  },
  setupFilesAfterEnv: ['<rootDir>/src/setup-tests.ts'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'http://localhost/' },
};
