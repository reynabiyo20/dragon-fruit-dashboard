import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount any React trees and clear persisted state between tests so each test
// starts from a clean slate (zustand persist writes to localStorage under jsdom).
afterEach(() => {
  cleanup();
  localStorage.clear();
});
