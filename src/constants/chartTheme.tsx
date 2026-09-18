/**
 * Shared Recharts styling for the Bulacan Dragon Fruit Depot dashboard.
 *
 * Centralizes axis, grid, tooltip, and legend styling plus a reusable pie label
 * so every chart across the app looks identical and on-brand. Colors come from
 * `chartColors.ts` (which mirrors the CSS `@theme` brand palette).
 */
import type { CSSProperties } from 'react';
import { CHART_GRID } from './chartColors';

// ── Axis + grid ──────────────────────────────────────────────────────────────
/** Muted plum-gray tick labels, small and unobtrusive. */
export const AXIS_TICK = { fontSize: 11, fill: '#6b6570' } as const;
export const AXIS_LINE = { stroke: '#e5e0e6' } as const;
export const GRID_STROKE = CHART_GRID;

// ── Tooltip ────────────────────────────────────────────────────────────────
/** Soft card-like tooltip that matches the app's rounded, bordered surfaces. */
export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #efdfec', // primary-100
  boxShadow: '0 4px 14px rgba(46, 25, 47, 0.12)',
  fontSize: 12,
  padding: '8px 10px',
};
export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: '#402342', // primary-800
  fontWeight: 600,
  marginBottom: 2,
};
export const TOOLTIP_ITEM_STYLE: CSSProperties = { padding: 0 };

// ── Legend ───────────────────────────────────────────────────────────────────
/** Bottom legend with a little breathing room above it. */
export const LEGEND_STYLE: CSSProperties = { fontSize: 11, paddingTop: 8 };
export const LEGEND_ICON_SIZE = 10;

// ── Pie geometry (consistent across every pie) ───────────────────────────────
/** Leave headroom for the pie so on-slice labels never touch the card edge or
 *  the legend. Pies are rendered as donuts for a cleaner, modern look. */
export const PIE_OUTER_RADIUS = 70;
export const PIE_INNER_RADIUS = 38;
export const PIE_CENTER_Y = '45%'; // nudge up so the bottom legend has room

/**
 * Renders a slice's percentage INSIDE the slice (white text), only when the
 * slice is large enough to hold a readable label. Names live in the legend and
 * tooltip, so nothing spills outside the pie. Use with `labelLine={false}`.
 */
export function renderPieValueLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
}) {
  const {
    cx = 0,
    cy = 0,
    midAngle = 0,
    innerRadius = 0,
    outerRadius = 0,
    percent = 0,
  } = props;

  // Only label slices that are big enough to fit text without crowding.
  if (percent < 0.08) return null;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#ffffff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}
