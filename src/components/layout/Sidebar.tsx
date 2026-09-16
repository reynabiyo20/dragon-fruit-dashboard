import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Receipt, Users, Truck,
  Package, Sprout, Banknote, UserCheck, Factory, TreePine,
  Settings, SlidersHorizontal, ChevronLeft, ChevronRight, BarChart2, Percent, LineChart, Scissors,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',                    label: 'Dashboard',          icon: LayoutDashboard, end: true },
  { to: '/reports',             label: 'Reports',            icon: BarChart2 },
  { to: '/price-history',       label: 'Price History',      icon: LineChart },
  { to: '/sales',               label: 'Sales',              icon: ShoppingCart },
  { to: '/expenses',            label: 'Expenses',           icon: Receipt },
  { to: '/payroll',             label: 'Payroll',            icon: Banknote },
  { to: '/commissions',         label: 'Commissions',        icon: Percent },
  { to: '/customers',           label: 'Customers',          icon: Users },
  { to: '/vendors',             label: 'Vendors',            icon: Truck },
  { to: '/products',            label: 'Products',           icon: Package },
  { to: '/inventory',           label: 'Inventory',          icon: Sprout },
  { to: '/cuttings',            label: 'Cuttings',           icon: Scissors },
  { to: '/wholesale-forecast',  label: 'Wholesale Forecast', icon: TrendingUp },
  { to: '/employees',           label: 'Employees',          icon: UserCheck },
  { to: '/production',          label: 'Production',         icon: Factory },
  { to: '/farm',                label: 'Farm Info',          icon: TreePine },
  { to: '/business',            label: 'Business Info',      icon: Settings },
  { to: '/settings',            label: 'Settings',           icon: SlidersHorizontal },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={[
        'relative flex flex-col bg-white border-r border-gray-200 h-screen sticky top-0',
        'transition-all duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-100 overflow-hidden flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
          <TreePine className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="truncate">
            <p className="text-sm font-bold text-gray-900 leading-tight">Dragon Fruit</p>
            <p className="text-xs text-gray-400 leading-tight">Depot</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => [
              'flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 text-sm font-medium transition-colors',
              'group whitespace-nowrap overflow-hidden',
              isActive
                ? 'bg-green-50 text-green-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            ].join(' ')}
            title={collapsed ? label : undefined}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-gray-100 px-2 py-3 flex-shrink-0">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center w-full px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
