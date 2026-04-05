/* eslint-disable */
const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@apex/api-e2e',
  preset: '../../jest.preset.js',
  globalSetup: '<rootDir>/src/support/global-setup.ts',
  globalTeardown: '<rootDir>/src/support/global-teardown.ts',
  setupFiles: ['<rootDir>/src/support/test-setup.ts'],
  testEnvironment: 'node',
  // Run test files sequentially — proxy tests modify shared state (secrets DB)
  // and parallel execution causes cross-contamination between suites.
  maxWorkers: 1,
  testMatch: [
    '**/?(*.)+(spec|test).?([mc])[jt]s?(x)',
    '**/*.e2e-spec.[jt]s?(x)',
  ],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
