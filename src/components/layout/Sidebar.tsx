import { NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Receipt, Users, Truck,
  Package, Sprout, Banknote, UserCheck, Factory, TreePine,
  Settings, SlidersHorizontal, ChevronLeft, ChevronRight, Percent, LineChart, Scissors,
  TrendingUp, Workflow,
} from 'lucide-react';
import { useState } from 'react';
import logo from '../../assets/logo.jpg';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  /** Short hover tooltip describing what the page/store is for. */
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',                    label: 'Dashboard & Reports', icon: LayoutDashboard, end: true, description: 'At-a-glance metrics, analytics, and the monthly P&L summary.' },
  { to: '/price-history',       label: 'Price History',      icon: LineChart,       description: 'Track how product prices have changed over time.' },
  { to: '/sales',               label: 'Sales',              icon: ShoppingCart,    description: 'Record and review sales orders to customers.' },
  { to: '/expenses',            label: 'Expenses',           icon: Receipt,         description: 'Log business costs and purchases from vendors.' },
  { to: '/payroll',             label: 'Payroll',            icon: Banknote,        description: 'Run and review employee wage payments per period.' },
  { to: '/commissions',         label: 'Commissions',        icon: Percent,         description: 'Track commissions earned by employees on sales.' },
  { to: '/employees',           label: 'Employees',          icon: UserCheck,       description: 'Manage staff records, pay rates, and active status.' },
  { to: '/customers',           label: 'Customers',          icon: Users,           description: 'Manage customer contacts and farm-partner details.' },
  { to: '/vendors',             label: 'Vendors',            icon: Truck,           description: 'Manage suppliers and what products they provide.' },
  { to: '/products',            label: 'Products',           icon: Package,         description: 'Define products with pricing, cost, and margin.' },
  { to: '/inventory',           label: 'Inventory',          icon: Sprout,          description: 'Track stock levels and value of items on hand.' },
  { to: '/cuttings',            label: 'Propagation',        icon: Scissors,        description: 'Grow cutting batches from source to rooted & ready.' },
  { to: '/wholesale-forecast',  label: 'Dragon Fruit Supply Forecast', icon: TrendingUp, description: 'Project upcoming dragon fruit supply windows.' },
  { to: '/production',          label: 'Farm Production',    icon: Factory,         description: 'Record farm harvest and production output.' },
  { to: '/farm',                label: 'Farm Info',          icon: TreePine,        description: 'View and edit farm plots and growing details.' },
  { to: '/business',            label: 'Business Info',      icon: Settings,        description: 'Edit core business details used across the app.' },
  { to: '/process-flows',       label: 'Process Flows',      icon: Workflow,        description: 'How each store works and how it affects the others.' },
  { to: '/settings',            label: 'Settings',           icon: SlidersHorizontal, description: 'Configure app preferences and manage data.' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={[
        'relative flex flex-col bg-primary-50/40 border-r border-primary-100 h-screen sticky top-0',
        'transition-all duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      ].join(' ')}
    >
      {/* Logo — links back to the Dashboard */}
      <Link
        to="/"
        className="flex items-center gap-3 px-4 py-5 border-b border-primary-100 overflow-hidden flex-shrink-0 transition-colors hover:bg-primary-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
        aria-label="Go to Dashboard"
        title={collapsed ? 'Dashboard' : undefined}
      >
        <img
          src={logo}
          alt="Bulacan Dragon Fruit Depot logo"
          className="w-9 h-9 rounded-full object-cover flex-shrink-0 ring-1 ring-gold-300"
        />
        {!collapsed && (
          <div className="truncate">
            <p className="text-sm font-bold text-primary-800 leading-tight">Bulacan Dragon Fruit</p>
            <p className="text-xs text-gold-600 font-semibold leading-tight tracking-wide">DEPOT</p>
          </div>
        )}
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, description }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => [
              'flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 text-sm font-medium transition-colors',
              'group whitespace-nowrap overflow-hidden',
              isActive
                ? 'bg-primary-700 text-white shadow-sm'
                : 'text-primary-800/70 hover:bg-primary-100 hover:text-primary-900',
            ].join(' ')}
            title={collapsed ? `${label} — ${description}` : description}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-primary-100 px-2 py-3 flex-shrink-0">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center w-full px-3 py-2 rounded-xl text-primary-400 hover:bg-primary-100 hover:text-primary-700 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
