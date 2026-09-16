import { Loader2 } from 'lucide-react';

/**
 * Loading state shown while a lazy-loaded route chunk is being fetched.
 * Sized to fill the main content area so the layout doesn't jump.
 */
export function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-400" role="status" aria-live="polite">
      <Loader2 className="w-6 h-6 animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
