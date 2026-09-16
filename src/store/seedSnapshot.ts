/**
 * Baseline data snapshot baked into the repo so a fresh (or reset) browser
 * starts from a known dataset instead of empty stores.
 *
 * Each value is the exact string Zustand's `persist` middleware writes to
 * localStorage under its `dfd-*` key (shape: `{"state":{...},"version":N}`).
 * The bootstrap in `main.tsx` writes these into localStorage on a schema bump.
 *
 * NOTE: This snapshot was intentionally cleared during the taxonomy migration to
 * the unified `category` / `subcategory` model. With no per-store overrides here,
 * every store falls back to its own (updated) seed constants on first load, so
 * the seeded data always matches the current store shapes. To re-bake a real
 * dataset later: edit data in the running app, export the `dfd-*` localStorage
 * keys, paste them here, and bump SCHEMA_VERSION in main.tsx.
 */
export const SEED_SNAPSHOT: Record<string, string> = {};
