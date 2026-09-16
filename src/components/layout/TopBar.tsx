import { Bell, TreePine } from 'lucide-react';
import { useBusinessStore } from '../../store/businessStore';

export function TopBar() {
  const { info } = useBusinessStore();
  const year = new Date().getFullYear();

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <TreePine className="w-5 h-5 text-green-600" />
        <span className="text-sm font-semibold text-gray-700">{info.businessName}</span>
        <span className="text-xs text-gray-400 ml-1">FY {info.fiscalYear || year}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
          <span className="text-xs font-bold text-green-700">
            {info.owner.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </span>
        </div>
      </div>
    </header>
  );
}
