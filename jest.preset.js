/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
  resolver: '@nx/jest/plugins/resolver',
  moduleFileExtensions: ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs', 'html'],
  coverageReporters: ['html'],
  testEnvironment: 'node',
};
