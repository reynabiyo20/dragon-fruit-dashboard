import { ArrowRight, ArrowDown, Workflow, Info, ListTree, GitBranch } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';

/**
 * A read-only reference page that documents, for each store (data domain), its
 * process flow from start to finish and how actions cascade into other stores.
 *
 * Each process is shown as a visual flow chart (the numbered steps as connected
 * nodes); the detailed cross-store effects live in a collapsible section per
 * process so the user can scan the flow first and expand for depth.
 *
 * This mirrors the actual cascade behavior implemented in src/store/* (notably
 * entityNameCascade.ts, inventoryLink.ts, cuttingStore.ts, customerStore.ts,
 * productUnitCascade.ts, taxonomySync.ts, expenseCategoryStore.ts, optionStores.ts)
 * and the form-level orchestration in the sales/expenses/cuttings/customers forms.
 *
 * CONVENTION: every per-store flow below must document BOTH directions of every
 * cascade that touches it — the effects it triggers in other stores AND the
 * updates it receives from parent stores (shown as a "Receives … renames" step).
 * Keep this page in sync whenever a cross-store cascade is added or changed.
 */

interface FlowStep {
  /** Short label shown inside the flow-chart node. */
  label: string;
  /** What the user does / what happens at this step (shown in details). */
  action: string;
  /** The cross-store effects this step triggers, in plain language. */
  effects?: string[];
}

interface StoreFlow {
  name: string;
  purpose: string;
  /** Store names this flow reads from or writes to, for the "touches" chips. */
  touches: string[];
  steps: FlowStep[];
}

const FLOWS: StoreFlow[] = [
  {
    name: 'Sales',
    purpose: 'Record what you sell to customers, to whom, and whether it has been delivered and paid.',
    touches: ['Inventory', 'Commissions', 'Employees', 'Cuttings', 'Products', 'Customers'],
    steps: [
      {
        label: 'Create sale & add items',
        action: 'Create a sale and add line items (product, quantity, unit price).',
        effects: [
          'Lines are matched to Products so they can later affect Inventory. Unmatched lines only warn — they do not move stock.',
          'A sale does NOT deduct stock at creation time.',
        ],
      },
      {
        label: 'Assign salesperson',
        action: 'Assign a salesperson (an employee with a commission %).',
        effects: [
          'Commissions: a commission entry is created for this sale (amount = line subtotal × the employee\u2019s commission %). Removing the salesperson removes the entry.',
        ],
      },
      {
        label: 'Add cutting line (optional)',
        action: 'Add a cutting line (buying cuttings from a customer).',
        effects: [
          'Cuttings: a customer-sourced batch is created (or updated) so the purchase is tracked in the cutting lifecycle.',
        ],
      },
      {
        label: 'Mark received',
        action: 'Mark the sale "Received by Customer".',
        effects: [
          'Inventory: the sold quantity is now deducted (the row is created automatically if it does not exist). Cuttings additionally draw down the "available for sale" pool.',
        ],
      },
      {
        label: 'Edit / delete',
        action: 'Edit or delete the sale.',
        effects: [
          'Inventory: the previous delivery effect is reversed and re-applied, so toggling delivery or editing quantities always reconciles. Un-receiving or deleting a received sale returns the stock.',
          'Commissions: deleting a sale also removes its commission entry.',
        ],
      },
      {
        label: 'Receives parent renames',
        action: 'A linked customer, salesperson, or product is renamed in its own store.',
        effects: [
          'Customers: the sale\u2019s customerName is rewritten when the linked customer (by customerId) is renamed.',
          'Employees: the sale\u2019s soldByName is rewritten when the salesperson (by soldByEmployeeId) is renamed.',
          'Products: a line item\u2019s productName label is refreshed when the linked product (by productId) is renamed.',
        ],
      },
    ],
  },
  {
    name: 'Expenses',
    purpose: 'Log purchases and costs, including buying stock and services from vendors.',
    touches: ['Inventory', 'Vendors', 'Products', 'Taxonomy', 'Dashboard'],
    steps: [
      {
        label: 'Record purchase line',
        action: 'Record a purchase line (category, subcategory, quantity, unit, unit price).',
        effects: [
          'Inventory: the quantity is added to the "purchased" pool (the row is auto-created if new). Service categories are skipped.',
          'Cuttings purchases route by state: "packed" credits the packed / available pools, "bare" credits the needs-packing pool.',
          'Vendors: the vendor "learns" this supply, and the vendor-product catalog records a default price for it.',
          'Dashboard: the expense is attributed to its vendor\u2019s location (Province/Municipality) in the "Financial Performance by Location" charts. A vendor created on the fly here starts with no location until edited in Vendors.',
        ],
      },
      {
        label: 'Flag "we resell this"',
        action: 'Flag an item as "we resell this".',
        effects: [
          'Products: a sellable product is created (or found) from the purchase, seeding its cost. Un-flagging removes the auto-created product only when it is safe (not priced and not referenced by a sale).',
        ],
      },
      {
        label: 'Use new category',
        action: 'Use a brand-new category or subcategory.',
        effects: [
          'Taxonomy: the new category/variety is registered so it becomes selectable across Products, Expenses, and Cuttings.',
        ],
      },
      {
        label: 'Edit / delete',
        action: 'Edit or delete the expense.',
        effects: [
          'Inventory: reconciled by reversing the old effect and applying the new — but only when the purchase actually changed (notes-only edits skip the churn). Deleting reverses the purchased quantity.',
        ],
      },
      {
        label: 'Receives parent renames',
        action: 'The linked vendor or a linked product is renamed, or a category/subcategory/unit is renamed in Settings.',
        effects: [
          'Vendors: the expense\u2019s vendorName is rewritten when the linked vendor (by vendorId) is renamed.',
          'Products: a line item\u2019s name/category/subcategory is refreshed when the linked product (by productId) is renamed; a unit change on the product cascades to the matching lines.',
          'Taxonomy / options: renaming a category, subcategory, unit, accounting classification or expense type in Settings rewrites the matching values here (flat fields and per-item).',
        ],
      },
    ],
  },
  {
    name: 'Cuttings',
    purpose: 'Manage dragon fruit cutting batches through their lifecycle: sourced, rooted, packed, reserved, or planted.',
    touches: ['Inventory', 'Products', 'Taxonomy', 'Supply Forecast', 'Customers'],
    steps: [
      {
        label: 'Create batch',
        action: 'Create a new internal batch for a variety.',
        effects: [
          'Products: a sellable Cuttings product is created and seeded with cost (existing prices are never overwritten).',
          'Inventory: a Cuttings row is created for the variety.',
          'Taxonomy: the variety is registered everywhere.',
        ],
      },
      {
        label: 'Reserve or pack',
        action: 'Reserve for the farm (replant) or pack for delivery.',
        effects: [
          'Inventory: "reserve for replant" moves quantity into the breeding-stock pool; "pack for delivery" moves it into the needs-packing pool. Re-allocating reverses the previous pool first.',
        ],
      },
      {
        label: 'Mark packed',
        action: 'Mark a batch packed.',
        effects: [
          'Inventory: credits the packed and "available for sale" pools. Un-packing is blocked if the stock has already been sold or allocated.',
        ],
      },
      {
        label: 'Mark planted',
        action: 'Mark a replant batch planted.',
        effects: [
          'Inventory: draws down the breeding-stock pool.',
          'Supply Forecast: the planting date feeds the projected supply windows.',
        ],
      },
      {
        label: 'Receives customer renames',
        action: 'The customer on a customer-sourced batch is renamed in the Customers store.',
        effects: [
          'The batch\u2019s customerName is rewritten automatically (matched by customerId).',
        ],
      },
    ],
  },
  {
    name: 'Farm Production',
    purpose: 'Record farm harvest output — fruit in kilograms or cuttings in pieces.',
    touches: ['Inventory', 'Cuttings', 'Employees'],
    steps: [
      {
        label: 'Log fruit harvest',
        action: 'Log a fruit harvest for a variety.',
        effects: [
          'Inventory: credits the Fruit row\u2019s "harvested" pool in kilograms (row auto-created).',
        ],
      },
      {
        label: 'Log cuttings harvest',
        action: 'Log a cuttings harvest.',
        effects: [
          'Cuttings: creates an internal cutting batch instead of crediting inventory directly (the batch then owns the stock across its lifecycle, avoiding double-counting).',
        ],
      },
      {
        label: 'Edit / delete',
        action: 'Edit or delete a production entry.',
        effects: [
          'Reconciled only when the harvest actually changed. Deleting reverses the harvested quantity and removes any linked cutting batch.',
        ],
      },
      {
        label: 'Receives employee renames',
        action: 'The harvester employee is renamed in the Employees store.',
        effects: [
          'The entry\u2019s harvestedByName is rewritten automatically (matched by harvestedById).',
        ],
      },
    ],
  },
  {
    name: 'Customers',
    purpose: 'Manage customer contacts and their location. A customer flagged as a Farm Partner also becomes a vendor.',
    touches: ['Sales', 'Cuttings', 'Vendors', 'Dashboard'],
    steps: [
      {
        label: 'Add / edit customer',
        action: 'Add or edit a customer, including a required location.',
        effects: [
          'Location: Province is required; Municipality is optional. The Municipality choices cascade from the selected Province (only that province\u2019s municipalities are offered), and when the province changes the municipality resets.',
          'Contact Person defaults to the customer name (it mirrors the name as you type and stays editable), so a customer is never left without a contact.',
          'Dashboard: the customer\u2019s Province/Municipality is where that customer\u2019s Sales are counted in the "Financial Performance by Location" charts (also rolled up to a derived Region).',
        ],
      },
      {
        label: 'Rename a customer',
        action: 'Change the customer\u2019s name on an existing record.',
        effects: [
          'Sales: every sale linked to this customer (by customerId) has its stored customerName rewritten to match.',
          'Cuttings: any customer-sourced cutting batch linked to this customer (by customerId) has its customerName rewritten.',
          'Matching is by id, not the old name — so the rename can\u2019t miss a record or touch an unrelated one. Point-in-time contact snapshots on past sales (phone/address) are preserved.',
        ],
      },
      {
        label: 'Flag as Farm Partner',
        action: 'Flag the customer as a Farm Partner (with a category / subcategory).',
        effects: [
          'Location: Province becomes strictly required for a Farm Partner, so our supply-partner footprint can be mapped.',
          'Vendors: a matching vendor is created or updated with supplies derived from the partner category, and the customer\u2019s location is synced onto that vendor. Existing vendor supplies are merged, not replaced.',
          'Dashboard: Farm Partners are counted by Province in the "Farm Partners by Location" chart (Supply Chain & Partner Mix).',
        ],
      },
      {
        label: 'Un-flag Farm Partner',
        action: 'Uncheck Farm Partner on a customer that has an auto-linked vendor.',
        effects: [
          'Vendors: you are warned and asked to confirm first — confirming removes the auto-linked vendor record (matched by name); cancelling leaves everything unchanged and does not save.',
          'The Customers table shows a "Farm Partner" badge so you can see at a glance which customers are also vendors.',
        ],
      },
    ],
  },
  {
    name: 'Vendors',
    purpose: 'Manage the suppliers you buy from, what they supply, and where they are located.',
    touches: ['Expenses', 'Customers', 'Dashboard'],
    steps: [
      {
        label: 'Add / edit vendor',
        action: 'Add or edit a vendor, including a required location.',
        effects: [
          'Location: Province is required; Municipality is optional and its choices cascade from the selected Province.',
          'Contact Person defaults to the vendor name (mirrored as you type, still editable), so a vendor always has a contact.',
          'Dashboard: the vendor\u2019s location is where its Expenses are counted in the "Financial Performance by Location" charts (rolled up to Province and a derived Region).',
        ],
      },
      {
        label: 'Rename a vendor',
        action: 'Change the vendor\u2019s name on an existing record.',
        effects: [
          'Expenses: every expense linked to this vendor (by vendorId) has its stored vendorName rewritten to match. Matched by id, so no record is missed and none unrelated is touched.',
        ],
      },
      {
        label: 'Auto-created from Expenses / Customers',
        action: 'A vendor can also be created automatically — inline while recording an expense, or when a customer is flagged a Farm Partner.',
        effects: [
          'From an expense: the vendor starts with an empty location until you edit it in Vendors, so its expenses sit under "Unspecified" on the location charts until then.',
          'From a Farm Partner: the partner customer\u2019s location is synced onto the vendor automatically. Un-flagging the partner removes this vendor (after a confirmation).',
        ],
      },
    ],
  },
  {
    name: 'Employees',
    purpose: 'Manage staff, their roles, pay rates, and commission %. The source of truth for a worker\u2019s name and rates.',
    touches: ['Payroll', 'Commissions', 'Sales', 'Farm Production'],
    steps: [
      {
        label: 'Add / edit employee',
        action: 'Add or edit an employee (role, employment/labor type, daily rate, commission %).',
        effects: [
          'Weekly and monthly rates are auto-calculated from the daily rate.',
          'Labor type and accounting classification default from the role but can be overridden.',
        ],
      },
      {
        label: 'Rename an employee',
        action: 'Change the employee\u2019s name on an existing record.',
        effects: [
          'Payroll: every payroll entry for this employee (by employeeId) has its stored employeeName rewritten.',
          'Commissions: every commission entry (by employeeId) has its employeeName rewritten.',
          'Sales: any sale where they were the salesperson (by soldByEmployeeId) has its soldByName rewritten.',
          'Farm Production: any harvest they logged (by harvestedById) has its harvestedByName rewritten.',
          'Timesheets keep no name (they link by employee id alone), so they need no cascade. Snapshots like a payroll entry\u2019s rate/labor type are preserved.',
        ],
      },
      {
        label: 'Set active / inactive',
        action: 'Toggle an employee active or inactive.',
        effects: [
          'Inactive employees drop out of the timesheet and Run-Payroll pool, but their historical payroll, commission, sales and harvest records are unchanged.',
        ],
      },
    ],
  },
  {
    name: 'Products',
    purpose: 'Define sellable products — the source of truth for a variety\u2019s unit and cost.',
    touches: ['Inventory', 'Vendors', 'Expenses', 'Sales'],
    steps: [
      {
        label: 'Create / edit product',
        action: 'Create or edit a product.',
        effects: ['The join key is the (category, subcategory) pair, matched across the app.'],
      },
      {
        label: 'Rename a product\u2019s identity',
        action: 'Change a product\u2019s category or subcategory.',
        effects: [
          'Sales: sale line items linked to this product (by productId) have their displayed "Category – Subcategory" productName label refreshed.',
          'Expenses: expense line items linked to this product (by productId) have their name, category and subcategory refreshed.',
          'Price snapshots on those historical lines are preserved — only the identity label changes.',
        ],
      },
      {
        label: 'Add from Inventory',
        action: 'Products can also be created in bulk from the Inventory page (select rows → "Add to Products").',
        effects: [
          'Each selected inventory item is matched by (category, subcategory): a new sellable product is created with its cost seeded from the inventory unit cost and a blank selling price, while an existing product is left untouched.',
          'Items without a subcategory are skipped. Newly-created products have no selling price yet, so they appear under the Products page\u2019s "Products without Price" count until priced.',
        ],
      },
      {
        label: 'Change unit',
        action: 'Change a product\u2019s unit.',
        effects: [
          'The unit cascades to the matching inventory row, all vendor-catalog entries, and expenses for the same category/subcategory. Product is the source of truth for the unit.',
        ],
      },
    ],
  },
  {
    name: 'Inventory',
    purpose: 'The central hub: one stock row per (category, subcategory), tracking multiple quantity pools. Its numbers are computed from what the other stores do.',
    touches: ['Expenses', 'Sales', 'Cuttings', 'Farm Production', 'Manufacturing', 'Products', 'Taxonomy'],
    steps: [
      {
        label: 'Quantities are computed',
        action: 'Stock levels are computed, not typed directly.',
        effects: [
          'Ending quantity = beginning + purchased − used − sold + packed + needs-packing + produced + harvested. Each pool is driven by a different store, listed below.',
          'A row is auto-created the first time any store references its (category, subcategory) — you rarely add rows by hand.',
        ],
      },
      {
        label: 'Receives purchases (from Expenses)',
        action: 'An expense purchase line is recorded, edited, or deleted.',
        effects: [
          'Credits the "purchased" pool for the line\u2019s (category, subcategory); service categories are skipped.',
          'Cuttings purchases route by state: "packed" credits the packed / available pools, "bare" credits the needs-packing pool.',
          'Edits reconcile by reversing the old purchase and applying the new one; deleting reverses it. Only fires when a purchase-relevant field changed.',
        ],
      },
      {
        label: 'Receives sales (from Sales)',
        action: 'A sale is marked "Received by Customer" (or un-received / edited / deleted).',
        effects: [
          'Deducts the sold quantity from the "sold" pool on receipt; cuttings additionally draw down the "available for sale" pool.',
          'Un-receiving, editing quantities, or deleting a received sale reverses and re-applies the effect so the balance always reconciles. A sale does not touch stock until it is received.',
        ],
      },
      {
        label: 'Receives harvests (from Farm Production)',
        action: 'A fruit harvest is logged, edited, or deleted.',
        effects: [
          'Credits the Fruit row\u2019s "harvested" pool in kilograms (reconciled on edit, reversed on delete).',
          'Cuttings harvests do NOT credit inventory here — they create a cutting batch that owns the stock across its lifecycle, so nothing is double-counted.',
        ],
      },
      {
        label: 'Receives cutting-lifecycle moves (from Cuttings)',
        action: 'A cutting batch is reserved, packed, or planted.',
        effects: [
          '"Reserve for replant" credits the breeding-stock pool; "pack for delivery" credits needs-packing; "mark packed" credits the packed / available-for-sale pools; "mark planted" draws down breeding stock.',
          'Re-allocating reverses the previous pool first, and un-packing is blocked if the stock was already sold or allocated.',
        ],
      },
      {
        label: 'Manufacturing run (from Manufacturing)',
        action: 'Run a manufacturing / production run.',
        effects: [
          'Deducts raw materials from the "used" pool and credits the finished good to the "produced" pool.',
        ],
      },
      {
        label: 'Receives unit & taxonomy renames',
        action: 'A product\u2019s unit changes, or a category/subcategory/unit is renamed in Settings.',
        effects: [
          'Products: the row\u2019s unit is updated to match (Products is the source of truth for a variety\u2019s unit).',
          'Taxonomy / options: renaming an inventory category or a unit in Settings rewrites the matching rows here.',
        ],
      },
      {
        label: 'Add to Products (bulk)',
        action: 'Select one or more inventory rows and use the "Add to Products" bulk action.',
        effects: [
          'Products: each selected item is turned into a sellable product, matched by (category, subcategory) — cost is seeded from the inventory unit cost and the selling price is left blank. Existing products are never overwritten, and items without a subcategory are skipped.',
          'The action is undoable (undo removes only the products it just created) and reports how many were created versus already existed. Inventory quantities are not changed.',
        ],
      },
    ],
  },
  {
    name: 'Payroll',
    purpose: 'Run wage payments per period, snapshotted from timesheets.',
    touches: ['Timesheets', 'Employees', 'Commissions'],
    steps: [
      {
        label: 'Run payroll',
        action: 'Run payroll for a period.',
        effects: [
          'Reads worked days from Timesheets and pay rates from Employees, then snapshots the result so paid entries stay trustworthy.',
          'May fold in commission amounts for the period.',
        ],
      },
      {
        label: 'Timesheet edited later',
        action: 'Edit a timesheet after payroll was run.',
        effects: [
          'The affected payroll entry is flagged stale — delete and re-run rather than silently changing a recorded payment.',
        ],
      },
      {
        label: 'Receives employee renames',
        action: 'An employee is renamed in the Employees store.',
        effects: [
          'The employeeName on this employee\u2019s payroll entries is rewritten automatically (matched by employeeId). The rate and labor-type snapshots on the entry are left untouched.',
        ],
      },
    ],
  },
  {
    name: 'Commissions',
    purpose: 'A ledger of commissions earned by employees on sales.',
    touches: ['Sales', 'Employees', 'Payroll'],
    steps: [
      {
        label: 'Created from Sales',
        action: 'Entries are created from Sales.',
        effects: [
          'One entry per sale that has a salesperson. Managed automatically as sales are created, edited, or deleted.',
        ],
      },
      {
        label: 'Receives employee renames',
        action: 'An employee is renamed in the Employees store.',
        effects: [
          'The employeeName on this employee\u2019s commission entries is rewritten automatically (matched by employeeId).',
        ],
      },
    ],
  },
  {
    name: 'Supply Forecast',
    purpose: 'A read-only projection of upcoming dragon fruit supply windows.',
    touches: ['Cuttings', 'Sales', 'Products', 'Farm Info'],
    steps: [
      {
        label: 'Derived automatically',
        action: 'The forecast is derived automatically.',
        effects: [
          'Aggregates planted replant batches, delivered customer cutting sales, and standing farm plantings — using saved yield and timeline assumptions. It reads from other stores and never writes to them.',
        ],
      },
    ],
  },
];

/* ── Unified cross-store cascade map ──────────────────────────────────────────
 * Every cross-store ripple in the app, grouped by KIND and color-coded. This is
 * a documentation model mirroring the real wiring in src/store/* — keep it in
 * sync when cascades change. Sources:
 *   - name:     entityNameCascade.ts
 *   - quantity: inventoryLink.ts, cuttingStore.ts, productionStore.ts, saleStore.ts (commissions)
 *   - creation: customerStore.ts (Farm Partner→vendor), productLink.ts (resell→product), cuttingStore.ts
 *   - taxonomy: expenseCategoryStore.ts, taxonomySync.ts
 *   - unit:     productUnitCascade.ts
 *   - option:   optionStores.ts
 *   - input:    payrollStore.ts (reads timesheets/employees/commissions)
 */
type CascadeKind = 'name' | 'quantity' | 'creation' | 'taxonomy' | 'unit' | 'option' | 'input';

interface CascadeKindMeta {
  kind: CascadeKind;
  label: string;
  /** What triggers this kind of cascade. */
  trigger: string;
  /** Tailwind classes for the edge chip / swatch. */
  dot: string;
  chip: string;
}

const CASCADE_KINDS: CascadeKindMeta[] = [
  { kind: 'name',     label: 'Name / identity', trigger: 'Renaming a parent record',              dot: 'bg-leaf-500',    chip: 'bg-leaf-50 text-leaf-700 border-leaf-200' },
  { kind: 'quantity', label: 'Quantity / lifecycle', trigger: 'Recording sales, purchases, harvests, cuttings', dot: 'bg-primary-500', chip: 'bg-primary-50 text-primary-700 border-primary-200' },
  { kind: 'creation', label: 'Auto-creation', trigger: 'Flags that spawn a linked record',        dot: 'bg-berry-500',   chip: 'bg-berry-50 text-berry-700 border-berry-200' },
  { kind: 'taxonomy', label: 'Taxonomy rename', trigger: 'Renaming a category / subcategory',     dot: 'bg-gold-500',    chip: 'bg-gold-50 text-gold-700 border-gold-200' },
  { kind: 'unit',     label: 'Unit rename', trigger: 'Changing a product / option unit',          dot: 'bg-purple-500',  chip: 'bg-purple-50 text-purple-700 border-purple-200' },
  { kind: 'option',   label: 'Option-list rename', trigger: 'Renaming a Settings option',         dot: 'bg-gray-400',    chip: 'bg-gray-100 text-gray-600 border-gray-200' },
  { kind: 'input',    label: 'Read-only input', trigger: 'One store reads another (no write back)', dot: 'bg-sky-500',   chip: 'bg-sky-50 text-sky-700 border-sky-200' },
];

interface CascadeEdge {
  kind: CascadeKind;
  from: string;
  to: string;
  /** The field(s) / effect propagated. */
  via: string;
}

const CASCADE_EDGES: CascadeEdge[] = [
  // Name / identity (entityNameCascade.ts) — matched by linking id.
  { kind: 'name', from: 'Customers', to: 'Sales', via: 'customerName (by customerId)' },
  { kind: 'name', from: 'Customers', to: 'Cuttings', via: 'customerName (by customerId)' },
  { kind: 'name', from: 'Vendors', to: 'Expenses', via: 'vendorName (by vendorId)' },
  { kind: 'name', from: 'Employees', to: 'Payroll', via: 'employeeName (by employeeId)' },
  { kind: 'name', from: 'Employees', to: 'Commissions', via: 'employeeName (by employeeId)' },
  { kind: 'name', from: 'Employees', to: 'Sales', via: 'soldByName (by soldByEmployeeId)' },
  { kind: 'name', from: 'Employees', to: 'Production', via: 'harvestedByName (by harvestedById)' },
  { kind: 'name', from: 'Products', to: 'Sales', via: 'item productName (by productId)' },
  { kind: 'name', from: 'Products', to: 'Expenses', via: 'item name + category + subcategory (by productId)' },

  // Quantity / lifecycle (inventoryLink.ts, cuttingStore.ts, productionStore.ts, saleStore.ts).
  { kind: 'quantity', from: 'Sales', to: 'Inventory', via: 'sold pool (on Received)' },
  { kind: 'quantity', from: 'Expenses', to: 'Inventory', via: 'purchased pool' },
  { kind: 'quantity', from: 'Farm Production', to: 'Inventory', via: 'harvested pool (Fruit, kg)' },
  { kind: 'quantity', from: 'Cuttings', to: 'Inventory', via: 'packed / breeding / available pools' },
  { kind: 'quantity', from: 'Manufacturing', to: 'Inventory', via: 'used − produced pools' },
  { kind: 'quantity', from: 'Sales', to: 'Commissions', via: 'one entry per salesperson' },
  { kind: 'quantity', from: 'Farm Production', to: 'Cuttings', via: 'cuttings harvest → internal batch' },
  { kind: 'quantity', from: 'Cuttings', to: 'Supply Forecast', via: 'planting dates' },
  { kind: 'quantity', from: 'Sales', to: 'Supply Forecast', via: 'delivered customer cuttings' },

  // Auto-creation (customerStore.ts, productLink.ts, cuttingStore.ts).
  { kind: 'creation', from: 'Customers', to: 'Vendors', via: 'Farm Partner → vendor (+ location, merged supplies)' },
  { kind: 'creation', from: 'Expenses', to: 'Products', via: 'resell flag → sellable product' },
  { kind: 'creation', from: 'Cuttings', to: 'Products', via: 'new variety → Cuttings product' },
  { kind: 'creation', from: 'Cuttings', to: 'Inventory', via: 'new variety → Cuttings row' },

  // Taxonomy rename (expenseCategoryStore.ts).
  { kind: 'taxonomy', from: 'Taxonomy', to: 'Expenses', via: 'category / subcategory (flat + items)' },
  { kind: 'taxonomy', from: 'Taxonomy', to: 'Vendors', via: 'supplies[].category / subcategory' },
  { kind: 'taxonomy', from: 'Taxonomy', to: 'Vendor-Products', via: 'catalog category / subcategory' },

  // Unit rename (productUnitCascade.ts + Unit option list).
  { kind: 'unit', from: 'Products', to: 'Inventory', via: 'unit (source of truth)' },
  { kind: 'unit', from: 'Products', to: 'Vendor-Products', via: 'unit' },
  { kind: 'unit', from: 'Products', to: 'Expenses', via: 'unit (flat + items)' },

  // Option-list rename (optionStores.ts).
  { kind: 'option', from: 'Settings options', to: 'Sales', via: 'saleType' },
  { kind: 'option', from: 'Settings options', to: 'Employees', via: 'type / position / laborType / classification' },
  { kind: 'option', from: 'Settings options', to: 'Expenses', via: 'classification / expenseType' },
  { kind: 'option', from: 'Settings options', to: 'Inventory', via: 'category / unit' },

  // Read-only inputs (payrollStore.ts reads; never writes back).
  { kind: 'input', from: 'Timesheets', to: 'Payroll', via: 'worked days (snapshot at run)' },
  { kind: 'input', from: 'Employees', to: 'Payroll', via: 'pay rates (snapshot at run)' },
  { kind: 'input', from: 'Commissions', to: 'Payroll', via: 'period commission (folded in)' },
];

function kindMeta(kind: CascadeKind): CascadeKindMeta {
  return CASCADE_KINDS.find((k) => k.kind === kind)!;
}

/** A single directed edge rendered as: From → [chip: via] → To, color-coded by kind. */
function CascadeEdgeRow({ edge }: { edge: CascadeEdge }) {
  const meta = kindMeta(edge.kind);
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
      <span className="sm:w-40 flex-shrink-0 text-sm font-semibold text-gray-800">{edge.from}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <ArrowRight className="hidden sm:block w-4 h-4 text-gray-300 flex-shrink-0" aria-hidden="true" />
        <ArrowDown className="sm:hidden w-4 h-4 text-gray-300" aria-hidden="true" />
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {edge.via}
        </span>
        <ArrowRight className="hidden sm:block w-4 h-4 text-gray-300 flex-shrink-0" aria-hidden="true" />
      </div>
      <span className="sm:w-44 flex-shrink-0 text-sm font-medium text-gray-700 sm:text-right">{edge.to}</span>
    </li>
  );
}

function CascadeLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {CASCADE_KINDS.map((k) => (
        <span
          key={k.kind}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${k.chip}`}
          title={k.trigger}
        >
          <span className={`w-2 h-2 rounded-full ${k.dot}`} aria-hidden="true" />
          {k.label}
        </span>
      ))}
    </div>
  );
}

function UnifiedCascadeSection() {
  return (
    <SectionCard
      title="Unified Cross-Store Cascade Map"
      subtitle="Every cross-store ripple, grouped by kind. Inventory is the hub most quantity cascades flow into."
    >
      <CascadeLegend />

      <div className="mt-4 space-y-5">
        {CASCADE_KINDS.map((k) => {
          const edges = CASCADE_EDGES.filter((e) => e.kind === k.kind);
          if (edges.length === 0) return null;
          return (
            <div key={k.kind}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${k.dot}`} aria-hidden="true" />
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k.label}</h4>
                <span className="text-xs text-gray-400">· {k.trigger}</span>
              </div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 px-3">
                {edges.map((e) => (
                  <CascadeEdgeRow key={`${e.from}-${e.to}-${e.via}`} edge={e} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/70 p-3 text-xs text-gray-500">
        <Info className="w-4 h-4 flex-shrink-0 text-gray-400 mt-0.5" aria-hidden="true" />
        <p>
          Name cascades match by the linking id (never the old name) and refresh only the display
          name — deliberate snapshots (a sale's contact & prices, a payroll entry's rate & labor type)
          are preserved. Quantity cascades reconcile on edit (reverse then re-apply). Timesheets keep
          no name, so they need no name cascade.
        </p>
      </div>
    </SectionCard>
  );
}

function TouchChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-100">
      {label}
    </span>
  );
}

/**
 * The visual flow chart: step nodes connected by arrows. Arrows render
 * horizontally on wide screens (nodes wrap) and vertically when stacked, so the
 * chain reads correctly at any width.
 */
function FlowChart({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="flex flex-col sm:flex-row sm:flex-wrap sm:items-stretch gap-2">
      {steps.map((step, i) => (
        <li key={i} className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50/60 px-3 py-2 h-full">
            <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-primary-700 text-white text-[11px] font-bold">
              {i + 1}
            </span>
            <span className="text-sm font-medium text-primary-900">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <>
              <ArrowRight className="hidden sm:block w-4 h-4 text-gray-300 flex-shrink-0" aria-hidden="true" />
              <ArrowDown className="sm:hidden w-4 h-4 text-gray-300 self-center" aria-hidden="true" />
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function FlowCard({ flow }: { flow: StoreFlow }) {
  return (
    <SectionCard title={flow.name} subtitle={flow.purpose}>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-gray-400 mr-1">Affects:</span>
        {flow.touches.map((t) => (
          <TouchChip key={t} label={t} />
        ))}
      </div>

      {/* The at-a-glance flow chart */}
      <FlowChart steps={flow.steps} />

      {/* Details collapsed by default — expand for the per-step cross-store effects */}
      <div className="mt-4">
        <CollapsibleSection
          title="Step details & cross-store effects"
          defaultCollapsed
          storageKey={`process-flow-details-${flow.name}`}
          icon={<ListTree className="w-4 h-4" />}
        >
          <ol className="space-y-3 pt-1">
            {flow.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary-700 text-white text-xs font-bold">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{step.action}</p>
                  {step.effects && step.effects.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {step.effects.map((effect, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-sm text-gray-600">
                          <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-leaf-600" aria-hidden="true" />
                          <span>{effect}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      </div>
    </SectionCard>
  );
}

export function ProcessFlowsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Process Flows"
        subtitle="How each store works from start to finish, and how actions ripple into other stores."
      />

      <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/40 p-4">
        <Info className="w-5 h-5 flex-shrink-0 text-primary-600 mt-0.5" aria-hidden="true" />
        <div className="text-sm text-primary-900">
          <p className="font-medium">Scan the flow, expand for the details.</p>
          <p className="mt-1 text-primary-800/80">
            Each process below shows its steps as a flow chart. Open “Step details &amp; cross-store
            effects” under any process to see exactly how each step ripples into the other stores.
            The stores are connected by a shared key — the (category, subcategory) pair — so most
            stock rows are created automatically as you record purchases, sales, harvests, and
            cuttings. Inventory is the hub: its quantities are computed from what the other stores do.
          </p>
        </div>
      </div>

      {/* Unified cross-store cascade map */}
      <CollapsibleSection
        title="Cross-store cascades"
        subtitle="Every ripple between stores, color-coded by kind"
        storageKey="process-flows-cross-store"
        icon={<GitBranch className="w-4 h-4" />}
      >
        <UnifiedCascadeSection />
      </CollapsibleSection>

      {/* Per-store process flows */}
      <CollapsibleSection
        title="Per-store process flows"
        subtitle="How each store works, and the cascades it triggers and receives"
        storageKey="process-flows-per-store"
        icon={<Workflow className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {FLOWS.map((flow) => (
            <FlowCard key={flow.name} flow={flow} />
          ))}
        </div>
      </CollapsibleSection>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Workflow className="w-3.5 h-3.5" aria-hidden="true" />
        <span>This page is a reference guide and does not modify any data.</span>
      </div>
    </div>
  );
}
