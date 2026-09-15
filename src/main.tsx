import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SEED_SNAPSHOT } from './store/seedSnapshot'

/**
 * One-time storage reset + baseline seed when the persisted data schema changes.
 *
 * Our Zustand stores persist to localStorage under `dfd-*` keys. When store
 * shapes change between versions, old persisted state can be incompatible.
 * Bumping SCHEMA_VERSION discards all `dfd-*` keys once, then loads the baked-in
 * baseline dataset (SEED_SNAPSHOT) so every environment starts from the same
 * known data instead of the static per-store seed constants.
 *
 * This runs at module load, before any store's `create()` hydrates from
 * localStorage, so the stores pick up the snapshot on first render.
 *
 * Increment SCHEMA_VERSION whenever a store's shape changes OR whenever you want
 * to force every environment to reset to a freshly exported SEED_SNAPSHOT.
 */
const SCHEMA_VERSION = '4';
const SCHEMA_KEY = 'dfd-schema-version';

try {
  if (localStorage.getItem(SCHEMA_KEY) !== SCHEMA_VERSION) {
    // Clear any existing persisted store data so it can't shadow the snapshot.
    Object.keys(localStorage)
      .filter((k) => k.startsWith('dfd-') && k !== SCHEMA_KEY)
      .forEach((k) => localStorage.removeItem(k));
    // Load the baked-in baseline dataset. Stores whose key isn't in the snapshot
    // fall back to their own seed constants on first render.
    for (const [key, value] of Object.entries(SEED_SNAPSHOT)) {
      localStorage.setItem(key, value);
    }
    localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION);
  }
} catch {
  // localStorage unavailable (private mode, etc.) — app still works, just no persistence
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
