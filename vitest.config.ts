import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Separate from vite.config.ts so the app build stays free of test concerns.
// Tailwind's Vite plugin is intentionally omitted — tests don't need CSS.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Reset spies/mocks between tests; store state is reset explicitly per-suite.
    clearMocks: true,
    restoreMocks: true,
  },
});
