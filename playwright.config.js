// playwright.config.js
//
// Static site — Playwright spins up a local HTTP server (python's stdlib
// http.server, no node dependency for serving) and runs the suite against it.
// One project per breakpoint we actually care about: desktop, mobile,
// and a reduced-motion lane to verify the @media query works.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 15_000,

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    // Static-file serving via Python's stdlib — no extra deps to install.
    command: `python3 -m http.server ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      // iPhone 13-ish viewport; tests in tests/mobile.spec.js gate on this name.
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      },
    },
  ],
});
