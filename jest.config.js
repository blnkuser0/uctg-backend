/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  globalSetup: "<rootDir>/tests/jest.globalSetup.js",
  globalTeardown: "<rootDir>/tests/jest.globalTeardown.js",
  setupFiles: ["<rootDir>/tests/jest.setupEnv.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 30000,
  forceExit: true,
};
