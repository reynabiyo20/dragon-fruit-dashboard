import type { KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: { value: number; label: string };
  /** Tailwind text-color class for the title, e.g. 'text-red-600'. Defaults to a muted gray. */
  titleColor?: string;
  /** Tailwind text-color class for the value, e.g. 'text-red-600'. Defaults to near-black. */
  valueColor?: string;
  /**
   * When provided, the whole card becomes an interactive button — clickable and
   * keyboard-focusable — typically used to drill into a filtered view.
   */
  onClick?: () => void;
  /**
   * Override the card's surface (background + border) classes. Defaults to a
   * white card with a gray border. Use to tint the whole card, e.g. for
   * currency color-coding.
   */
  surfaceClassName?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary-600',
  iconBg = 'bg-primary-50',
  trend,
  titleColor = 'text-gray-500',
  valueColor = 'text-gray-900',
  onClick,
  surfaceClassName = 'bg-white border-gray-200',
}: StatCardProps) {
  const interactive = !!onClick;
  return (
    <div
      {...(interactive
        ? {
            role: 'button' as const,
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            },
          }
        : {})}
      className={[
        'rounded-xl border p-5 shadow-sm transition-shadow',
        surfaceClassName,
        interactive
          ? 'cursor-pointer hover:shadow-md hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'
          : 'hover:shadow-md',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${titleColor}`}>{title}</p>
          <p className={`mt-1 text-2xl font-bold truncate ${valueColor}`}>{value}</p>
          {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
          {trend && (
            <p className={`mt-2 text-xs font-medium ${trend.value >= 0 ? 'text-leaf-600' : 'text-red-500'}`}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        <div className={`ml-4 flex-shrink-0 p-3 rounded-xl ${iconBg}`}>
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}
