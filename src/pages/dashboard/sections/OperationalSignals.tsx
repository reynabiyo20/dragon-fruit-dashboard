/**
 * Section 4 — Real-Time Operational Signals.
 *
 * A strict Green / Yellow / Red flag system so daily blockers (open harvest
 * windows, low stock, unpaid invoices, crop-quality drops) are visible at a
 * glance. Each flag links to the page where you act on it.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertOctagon, ArrowRight } from 'lucide-react';
import type { AlertLevel, AlertSignal } from '../useDashboardData';

const LEVEL_STYLES: Record<AlertLevel, { chip: string; dot: string; icon: typeof CheckCircle2; label: string }> = {
  good:   { chip: 'border-leaf-200 bg-leaf-50',   dot: 'text-leaf-600',  icon: CheckCircle2,  label: 'Good' },
  warn:   { chip: 'border-gold-200 bg-gold-50',   dot: 'text-gold-600',  icon: AlertTriangle, label: 'Monitor' },
  action: { chip: 'border-red-200 bg-red-50',     dot: 'text-red-600',   icon: AlertOctagon,  label: 'Action' },
};

interface OperationalSignalsProps {
  signals: AlertSignal[];
}

/** Sort priority so the most urgent flags lead: Red → Yellow → Green. */
const LEVEL_RANK: Record<AlertLevel, number> = { action: 0, warn: 1, good: 2 };

export function OperationalSignals({ signals }: OperationalSignalsProps) {
  // Stable sort: severity first, preserving the original category order within
  // each severity band so the layout doesn't jump around between renders.
  const ordered = [...signals].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {ordered.map((s) => {
        const style = LEVEL_STYLES[s.level];
        const Icon = style.icon;
        const body = (
          <div className={`h-full rounded-xl border p-4 transition-shadow ${style.chip} ${s.to ? 'hover:shadow-md' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon className={`w-5 h-5 flex-shrink-0 ${style.dot}`} />
                <span className="text-sm font-semibold text-gray-800">{s.title}</span>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${style.dot}`}>{style.label}</span>
            </div>
            <p className="mt-2 text-sm text-gray-600">{s.detail}</p>
            {s.to && (
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                Open <ArrowRight className="w-3 h-3" />
              </span>
            )}
          </div>
        );
        return s.to ? (
          <Link
            key={s.id}
            to={s.to}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-xl"
          >
            {body}
          </Link>
        ) : (
          <div key={s.id}>{body}</div>
        );
      })}
    </div>
  );
}
