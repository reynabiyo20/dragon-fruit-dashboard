import { useState, type ReactNode } from 'react';
import { ChevronDown, BarChart2 } from 'lucide-react';

interface CollapsibleSectionProps {
  /** Header label, e.g. "Analytics". */
  title: string;
  /** Optional short hint shown next to the title when expanded. */
  subtitle?: string;
  children: ReactNode;
  /** Whether the section starts collapsed. Default: false (expanded). */
  defaultCollapsed?: boolean;
  /**
   * When set, the collapsed/expanded state is persisted in localStorage under
   * this key so the user's choice sticks across visits (per page/section).
   */
  storageKey?: string;
  /** Optional icon override for the header. Defaults to a bar-chart glyph. */
  icon?: ReactNode;
}

/**
 * A lightweight wrapper that lets the user collapse/expand a block of content
 * (typically the charts/visuals on a store page) to reclaim vertical space.
 * The toggle is a full-width header bar; the body simply unmounts when collapsed.
 */
export function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultCollapsed = false,
  storageKey,
  icon,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'collapsed') return true;
      if (saved === 'expanded') return false;
    }
    return defaultCollapsed;
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (storageKey) localStorage.setItem(storageKey, next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-gray-400 flex-shrink-0">{icon ?? <BarChart2 className="w-4 h-4" />}</span>
          <span className="text-sm font-semibold text-primary-800 truncate">{title}</span>
          {subtitle && <span className="hidden sm:inline text-xs text-gray-400 truncate">· {subtitle}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 flex-shrink-0">
          {collapsed ? 'Show' : 'Hide'}
          <ChevronDown
            className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
          />
        </span>
      </button>
      {!collapsed && children}
    </section>
  );
}
