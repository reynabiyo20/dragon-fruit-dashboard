import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Customer, VendorSupply } from '../types';
import { generateId, now } from '../utils/id';
import { seededPersist } from './persistHelpers';
import { useVendorStore } from './vendorStore';
import {
  CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, FARM_PARTNER_CATEGORY_BOTH,
} from '../constants';
import { PHILIPPINES } from '../constants/geography';
import { cascadeCustomerName } from './entityNameCascade';

// v3: "type" moved off the Customer entirely — it belongs to each Sale now.
// v4: adds a required { province, municipality } location.
// v5: adds `location.country` (defaults to Philippines for existing records).
const SEED_VERSION = 5;

function c(customerName: string): Customer {
  return {
    id: generateId(),
    customerName,
    contactPerson: '',
    phone: '',
    fbMessengerName: '',
    email: '',
    address: '',
    location: { country: PHILIPPINES, province: '', municipality: '' },
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
  // A partner can supply several varieties, stored comma-separated. Expand them
  // into one supply per variety (per category). An empty list yields a single
  // supply with a blank subcategory (whole-category / unspecified).
  const subs = (customer.farmPartnerSubcategory ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const forCategory = (category: string): VendorSupply[] =>
    subs.length > 0
      ? subs.map((subcategory) => ({ category, subcategory }))
      : [{ category, subcategory: '' }];

  if (customer.farmPartnerCategory === FARM_PARTNER_CATEGORY_BOTH) {
    return [...forCategory(FRUIT_PRODUCT_TYPE), ...forCategory(CUTTINGS_PRODUCT_TYPE)];
  }
  const category = (customer.farmPartnerCategory ?? '').trim();
  if (!category) return [];
  return forCategory(category);
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
      // Keep the linked vendor's location in sync with the partner customer's
      // (a country or a province counts as a set location).
      location: (customer.location?.country || customer.location?.province) ? customer.location : existing.location,
      supplies: merged,
    });
  } else {
    vendorStore.addVendor({
      vendor: customer.customerName.trim(),
      contact: customer.contactPerson,
      phone: customer.phone,
      location: customer.location ?? { country: PHILIPPINES, province: '', municipality: '' },
      supplies,
      notes: customer.notes ? `Farm Partner. ${customer.notes}` : 'Farm Partner (auto-linked from Customers).',
    });
  }
}

/**
 * The vendor auto-linked to a Farm Partner customer, matched by name
 * (case-insensitive) — the same key `cascadeToVendor` uses. Returns undefined
 * when the customer was never a partner or the vendor has since been removed.
 */
function findLinkedVendor(customerName: string) {
  const nameKey = customerName.trim().toLowerCase();
  if (!nameKey) return undefined;
  return useVendorStore
    .getState()
    .vendors.find((v) => v.vendor.trim().toLowerCase() === nameKey);
}

const SEED_CUSTOMERS: Customer[] = [
  c('Walk-In Consumer'),
  c('S&R'),
  c('Online Orders'),
];

interface CustomerState {
  customers: Customer[];
  _seeded: number;
  // `location` is optional here so customers auto-created inline (e.g. from a
  // one-off sale) default to an empty location; the Customer form requires it.
  addCustomer: (data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'location'> & { location?: Customer['location'] }) => Customer;
  updateCustomer: (id: string, data: Partial<Omit<Customer, 'id' | 'createdAt'>>) => void;
  deleteCustomer: (id: string) => void;
  getCustomer: (id: string) => Customer | undefined;
  /** Name of the vendor auto-linked to this partner customer, or undefined. */
  linkedVendorName: (customerName: string) => string | undefined;
  /**
   * Remove the vendor auto-linked to a Farm Partner customer (matched by name).
   * Used when a customer stops being a partner. Returns true if a vendor was
   * removed.
   */
  removeLinkedVendor: (customerName: string) => boolean;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      customers: SEED_CUSTOMERS,
      _seeded: SEED_VERSION,

      addCustomer: (data) => {
        const customer: Customer = {
          ...data,
          location: data.location ?? { country: PHILIPPINES, province: '', municipality: '' },
          id: generateId(), createdAt: now(), updatedAt: now(),
        };
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
        if (!updated) return;
        // Propagate a renamed customer to the sales & cutting records that
        // snapshot the customer name (matched by customerId).
        if (data.customerName !== undefined) {
          cascadeCustomerName(id, updated.customerName);
        }
        // Keep the linked vendor in sync when a partner's profile changes.
        cascadeToVendor(updated);
      },

      deleteCustomer: (id) =>
        set((state) => ({ customers: state.customers.filter((cust) => cust.id !== id) })),

      getCustomer: (id) => get().customers.find((cust) => cust.id === id),

      linkedVendorName: (customerName) => findLinkedVendor(customerName)?.vendor,

      removeLinkedVendor: (customerName) => {
        const vendor = findLinkedVendor(customerName);
        if (!vendor) return false;
        useVendorStore.getState().deleteVendor(vendor.id);
        return true;
      },
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
        // v4: default the new location on records that predate it.
        if (version < 4 && Array.isArray(state?.customers)) {
          state.customers = state.customers.map((cust) => ({
            ...cust,
            location: cust.location ?? { province: '', municipality: '' },
          }));
        }
        // v5: default the country on every location — existing customers are local.
        if (version < 5 && Array.isArray(state?.customers)) {
          state.customers = state.customers.map((cust) => ({
            ...cust,
            location: {
              country: cust.location?.country ?? PHILIPPINES,
              province: cust.location?.province ?? '',
              municipality: cust.location?.municipality ?? '',
            },
          }));
        }
        return state;
      },
    }
  )
);
