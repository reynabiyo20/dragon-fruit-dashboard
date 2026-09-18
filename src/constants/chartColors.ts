/**
 * Centralized chart color palette for the Bulacan Dragon Fruit Depot dashboard.
 *
 * These hex values mirror the brand `@theme` tokens defined in `src/index.css`
 * (primary = plum, berry = magenta, gold = amber, leaf = green). Recharts cannot
 * read Tailwind utility classes, so charts consume these constants directly.
 * Keep these in sync with the CSS `@theme` block if the brand palette changes.
 */

// ── Brand hues (match src/index.css @theme) ──────────────────────────────────
export const BRAND = {
  primary: '#6a3a67', // plum (accent)
  primaryDark: '#542e54',
  berry: '#d81b74', // dragon-fruit magenta
  gold: '#d9941a', // amber
  goldLight: '#e9ad2e',
  leaf: '#6b9835', // dragon-fruit green
  leafDark: '#537928',
} as const;

// ── Semantic colors shared across financial charts ───────────────────────────
export const CHART_REVENUE = BRAND.leaf; // money in / positive
export const CHART_EXPENSE = '#ef4444'; // red — expenses
export const CHART_PAYROLL = BRAND.gold; // amber — payroll
export const CHART_PROFIT = BRAND.primary; // plum — profit / net
export const CHART_GRID = '#f0f0f0';

/**
 * Categorical palette for pie / multi-series charts. Ordered so adjacent slices
 * stay visually distinct, led by the brand hues (magenta, plum, gold, leaf).
 */
export const PIE_COLORS = [
  BRAND.berry, // #d81b74 magenta
  BRAND.primary, // #6a3a67 plum
  BRAND.gold, // #d9941a amber
  BRAND.leaf, // #6b9835 green
  '#3b82f6', // blue
  '#ef4444', // red
  BRAND.goldLight, // #e9ad2e light amber
  '#06b6d4', // cyan
];

/**
 * Palette for multi-line charts (price history etc.). Led by the brand plum so
 * the primary series reads as "on brand".
 */
export const LINE_COLORS = [
  BRAND.primary, // plum
  BRAND.berry, // magenta
  BRAND.gold, // amber
  BRAND.leaf, // green
  '#3b82f6', // blue
  '#06b6d4', // cyan
];
