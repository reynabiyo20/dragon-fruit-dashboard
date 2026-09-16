import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Layout } from './components/layout/Layout';
import { RouteFallback } from './components/layout/RouteFallback';
// Dashboard is the landing route — keep it eager so first paint has no spinner
import { DashboardPage } from './pages/dashboard/DashboardPage';

// Lazy-load the rest so each page is a separate chunk fetched on demand.
// The pages use named exports, so map them to `default` for React.lazy.
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const PriceHistoryPage = lazy(() => import('./pages/price-history/PriceHistoryPage').then((m) => ({ default: m.PriceHistoryPage })));
const SalesPage = lazy(() => import('./pages/sales/SalesPage').then((m) => ({ default: m.SalesPage })));
const ExpensesPage = lazy(() => import('./pages/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const PayrollPage = lazy(() => import('./pages/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const CommissionsPage = lazy(() => import('./pages/commissions/CommissionsPage').then((m) => ({ default: m.CommissionsPage })));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const VendorsPage = lazy(() => import('./pages/vendors/VendorsPage').then((m) => ({ default: m.VendorsPage })));
const ProductsPage = lazy(() => import('./pages/products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const CuttingsPage = lazy(() => import('./pages/cuttings/CuttingsPage').then((m) => ({ default: m.CuttingsPage })));
const WholesaleForecastPage = lazy(() => import('./pages/wholesale/WholesaleForecastPage').then((m) => ({ default: m.WholesaleForecastPage })));
const EmployeesPage = lazy(() => import('./pages/employees/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const ProductionPage = lazy(() => import('./pages/production/ProductionPage').then((m) => ({ default: m.ProductionPage })));
const FarmPage = lazy(() => import('./pages/farm/FarmPage').then((m) => ({ default: m.FarmPage })));
const BusinessPage = lazy(() => import('./pages/business/BusinessPage').then((m) => ({ default: m.BusinessPage })));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: '14px', borderRadius: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
          success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
        }}
      />
      <Layout>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/"                    element={<DashboardPage />} />
            <Route path="/reports"             element={<ReportsPage />} />
            <Route path="/price-history"       element={<PriceHistoryPage />} />
            <Route path="/sales"               element={<SalesPage />} />
            <Route path="/expenses"            element={<ExpensesPage />} />
            <Route path="/payroll"             element={<PayrollPage />} />
            <Route path="/commissions"         element={<CommissionsPage />} />
            <Route path="/customers"           element={<CustomersPage />} />
            <Route path="/vendors"             element={<VendorsPage />} />
            <Route path="/products"            element={<ProductsPage />} />
            <Route path="/inventory"           element={<InventoryPage />} />
            <Route path="/cuttings"            element={<CuttingsPage />} />
            <Route path="/wholesale-forecast"  element={<WholesaleForecastPage />} />
            <Route path="/employees"           element={<EmployeesPage />} />
            <Route path="/production"          element={<ProductionPage />} />
            <Route path="/farm"                element={<FarmPage />} />
            <Route path="/business"            element={<BusinessPage />} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="*"                    element={<DashboardPage />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
