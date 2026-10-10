import { defineConfig } from '@playwright/test';

// Software rendering is for functional/rendering/UI acceptance, never benchmarks.
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
