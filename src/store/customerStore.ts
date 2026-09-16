import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Customer, VendorSupply } from '../types';
import { generateId, now } from '../utils/id';
import { seededPersist } from './persistHelpers';
import { useVendorStore } from './vendorStore';
import {
  CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, FARM_PARTNER_CATEGORY_BOTH,
} from '../constants';

// v3: "type" moved off the Customer entirely — it belongs to each Sale now.
const SEED_VERSION = 3;

function c(customerName: string): Customer {
  return {
    id: generateId(),
    customerName,
    contactPerson: '',
    phone: '',
    fbMessengerName: '',
    email: '',
    address: '',
    farmPartner: false,
    farmPartnerCategory: '',
    farmPartnerSubcategory: '',
    notes: '',
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * Translate a Farm Partner's category + subcategory into the vendor's structured
 * supplies list. "Both" expands to one supply per product type so the vendor is
 * discoverable under Fruit and Cuttings alike.
 */
function partnerSupplies(customer: Customer): VendorSupply[] {
  const sub = customer.farmPartnerSubcategory?.trim() ?? '';
  if (customer.farmPartnerCategory === FARM_PARTNER_CATEGORY_BOTH) {
    return [
      { category: FRUIT_PRODUCT_TYPE, subcategory: sub },
      { category: CUTTINGS_PRODUCT_TYPE, subcategory: sub },
    ];
  }
  const category = (customer.farmPartnerCategory ?? '').trim();
  if (!category) return [];
  return [{ category, subcategory: sub }];
}

/**
 * Cascade a Farm Partner customer into the Vendors module: create a matching
 * vendor (or update the existing one, matched by name case-insensitively) so the
 * business can record purchases from them. Identity + supplies are kept in sync.
 */
function cascadeToVendor(customer: Customer): void {
  if (!customer.farmPartner) return;
  const vendorStore = useVendorStore.getState();
  const nameKey = customer.customerName.trim().toLowerCase();
  if (!nameKey) return;

  const supplies = partnerSupplies(customer);
  const existing = vendorStore.vendors.find(
    (v) => v.vendor.trim().toLowerCase() === nameKey,
  );

  if (existing) {
    // Merge supplies (union, case-insensitive) so manual vendor supplies aren't lost.
    const norm = (s: string) => s.trim().toLowerCase();
    const merged: VendorSupply[] = [...existing.supplies];
    supplies.forEach((sup) => {
      const dup = merged.some(
        (m) => norm(m.category) === norm(sup.category) && norm(m.subcategory) === norm(sup.subcategory),
      );
      if (!dup) merged.push(sup);
    });
    vendorStore.updateVendor(existing.id, {
      contact: customer.contactPerson || existing.contact,
      phone: customer.phone || existing.phone,
      supplies: merged,
    });
  } else {
    vendorStore.addVendor({
      vendor: customer.customerName.trim(),
      contact: customer.contactPerson,
      phone: customer.phone,
      supplies,
      notes: customer.notes ? `Farm Partner. ${customer.notes}` : 'Farm Partner (auto-linked from Customers).',
    });
  }
}

const SEED_CUSTOMERS: Customer[] = [
  c('Walk-In Consumer'),
  c('S&R'),
  c('Online Orders'),
];

interface CustomerState {
  customers: Customer[];
  _seeded: number;
  addCustomer: (data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>) => Customer;
  updateCustomer: (id: string, data: Partial<Omit<Customer, 'id' | 'createdAt'>>) => void;
  deleteCustomer: (id: string) => void;
  getCustomer: (id: string) => Customer | undefined;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      customers: SEED_CUSTOMERS,
      _seeded: SEED_VERSION,

      addCustomer: (data) => {
        const customer: Customer = { ...data, id: generateId(), createdAt: now(), updatedAt: now() };
        set((state) => ({ customers: [...state.customers, customer] }));
        // Farm Partners cascade into the Vendors module.
        cascadeToVendor(customer);
        return customer;
      },

      updateCustomer: (id, data) => {
        let updated: Customer | undefined;
        set((state) => ({
          customers: state.customers.map((cust) => {
            if (cust.id !== id) return cust;
            updated = { ...cust, ...data, updatedAt: now() };
            return updated;
          }),
        }));
        // Keep the linked vendor in sync when a partner's profile changes.
        if (updated) cascadeToVendor(updated);
      },

      deleteCustomer: (id) =>
        set((state) => ({ customers: state.customers.filter((cust) => cust.id !== id) })),

      getCustomer: (id) => get().customers.find((cust) => cust.id === id),
    }),
    {
      ...seededPersist<CustomerState>('dfd-customers', 'customers', SEED_CUSTOMERS, SEED_VERSION),
      // The customer no longer carries a type. Strip the legacy `customerType`
      // (v1) / `customerTypes` (v2) fields so records match the identity-only
      // shape. Existing customers keep their identity; their historical types now
      // live on the sales made under them.
      migrate: (persisted: unknown, version: number): CustomerState => {
        const state = persisted as CustomerState;
        if (version < 3 && Array.isArray(state?.customers)) {
          state.customers = state.customers.map((raw) => {
            const { customerType: _t, customerTypes: _ts, ...rest } =
              raw as Customer & { customerType?: string; customerTypes?: string[] };
            return rest as Customer;
          });
        }
        // Default the Farm Partner fields on any pre-existing customer.
        if (Array.isArray(state?.customers)) {
          state.customers = state.customers.map((cust) => ({
            farmPartner: cust.farmPartner ?? false,
            farmPartnerCategory: cust.farmPartnerCategory ?? '',
            farmPartnerSubcategory: cust.farmPartnerSubcategory ?? '',
            ...cust,
          }));
        }
        return state;
      },
    }
  )
);
