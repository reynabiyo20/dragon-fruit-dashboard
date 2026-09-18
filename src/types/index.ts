// ─── Shared ───────────────────────────────────────────────────────────────────
import type {
  PAYMENT_METHODS, EMPLOYEE_TYPES, SALE_TYPES, CUTTING_STATUSES,
  FARM_PARTNER_CATEGORIES, CUTTING_SOURCES, CUTTING_TYPES, CUTTING_ALLOCATIONS,
} from '../constants';

export type Currency = 'PHP' | 'USD';

/** Derived from the single source of truth in src/constants */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ─── Business Information ─────────────────────────────────────────────────────

export interface BusinessInfo {
  businessName: string;
  owner: string;
  farmAddress: string;
  startedYear: number;
  fiscalYear: number;
  banks: string[];
  notes: string;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  /**
   * Two-level taxonomy shared across every entity:
   *  - category: coarse category, e.g. "Cuttings", "Fruit", "Drink", "Fertilizer"
   *  - subcategory: the variety / specific item within the category, e.g. "Thai White"
   */
  category: string;
  subcategory: string;
  costPHP: number;
  sellingPricePHP: number;
  costUSD: number;
  sellingPriceUSD: number;
  unit: string;           // e.g. "Kg", "piece"
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Employees ────────────────────────────────────────────────────────────────

export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export interface Employee {
  id: string;
  name: string;
  position: string;
  employeeType: EmployeeType | string;
  dailyRate: number;
  weeklyRate: number;       // auto-calculated: dailyRate * 5
  monthlySalary: number;    // auto-calculated: weeklyRate * 4
  commission: number;
  /**
   * Whether the employee is currently active. Inactive employees are hidden from
   * the timesheet and payroll run but keep their history. Optional for
   * back-compat — treat `undefined` as active.
   */
  active?: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Customers ────────────────────────────────────────────────────────────────

/** How a single sale happened. A customer isn't a type — a sale is. */
export type SaleType = (typeof SALE_TYPES)[number];

/** What a Farm Partner supplies. Scopes the subcategory options. */
export type FarmPartnerCategory = (typeof FARM_PARTNER_CATEGORIES)[number];

export interface Customer {
  id: string;
  customerName: string;
  contactPerson: string;
  phone: string;
  fbMessengerName: string;
  email: string;
  address: string;
  /**
   * A Farm Partner is a customer the business ALSO buys from (fruit/cuttings).
   * When true, the customer cascades into the Vendors module and the two fields
   * below describe what they supply. Optional for back-compat — treat
   * `undefined` as not a partner.
   */
  farmPartner?: boolean;
  /** What the partner supplies: Fruit | Cuttings | Both ('' when not a partner). */
  farmPartnerCategory?: FarmPartnerCategory | string;
  /** Specific fruit colour / variety they supply ('' = whole category / unspecified). */
  farmPartnerSubcategory?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

/** A single supply a vendor provides — category + optional subcategory */
export interface VendorSupply {
  category: string;
  subcategory: string; // '' when the category has no subcategory
}

export interface Vendor {
  id: string;
  vendor: string;
  contact: string;
  phone: string;
  supplies: VendorSupply[];        // structured list of what this vendor provides
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /**
   * Per-unit surcharge added to this line (e.g. the small-order fee on cuttings
   * bought below the threshold). 0 for normal lines. Editable so it can be waived.
   */
  surcharge: number;
  total: number;            // auto-calculated: quantity * (unitPrice + surcharge)
}

export interface Sale {
  id: string;
  date: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  /** How this sale happened — walk-in, online, wholesale, … (see SALE_TYPES). '' if unspecified. */
  saleType: string;
  items: SaleItem[];
  subtotal: number;         // auto-calculated: sum of item totals
  paymentMethod: PaymentMethod | string;
  paymentDetails: string;
  paid: boolean;
  /**
   * Fulfillment flag for cutting orders. When set TRUE the sold cutting quantity
   * is permanently deducted from the Available-Stock-for-Sale inventory pool.
   * Optional for back-compat — treat `undefined` as not delivered.
   */
  delivered?: boolean;
  /**
   * Date the order was marked delivered. Used as the deployment date for partner
   * cuttings in the wholesale harvest forecast. Set when `delivered` flips true,
   * cleared when it flips back to false.
   */
  deliveredDate?: string;
  soldByEmployeeId: string;   // optional salesperson who made the sale (for commission)
  soldByName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

/**
 * Expense categories are user-editable at runtime (see expenseCategoryStore),
 * so this is a free string rather than a fixed union.
 */
export type ExpenseCategory = string;

/**
 * A single line item on a multi-item expense. Snapshots the product's name,
 * category, unit and price at save time so later catalog edits never rewrite
 * historical records. Items may span different categories within one expense.
 */
/**
 * For a CUTTINGS purchase, whether the cuttings arrive ready to sell or still
 * need packing. Drives which inventory pool the purchased quantity lands in:
 *  - 'packed': into the `packed` / Ready-for-Sale pool (sellable immediately).
 *  - 'bare':   into the `needsPacking` pool (on hand but not yet sellable).
 * Only meaningful for the Cuttings category; ignored otherwise.
 */
export type CuttingPurchaseState = 'packed' | 'bare';

export interface ExpenseItem {
  productId: string;      // '' for ad-hoc lines not tied to a catalog product
  name: string;           // product / line name
  category: string;       // top-level category
  subcategory: string;    // subcategory / supply name ('' when none)
  quantity: number;
  unit: string;           // unit of measure ('' when not applicable)
  unitPrice: number;      // price per unit at time of purchase
  total: number;          // auto-calculated: quantity * unitPrice
  /**
   * Whether the business resells this item — when true it cascades into the
   * sellable Products list on save. Editable per line in the itemized picker so a
   * mis-flag can be corrected. Cuttings/Fruit/Fertilizer always cascade regardless.
   */
  resell?: boolean;
  /** Cuttings only: whether this line arrives packed or bare (needs packing). */
  cuttingState?: CuttingPurchaseState;
}

export interface Expense {
  id: string;
  date: string;
  vendorId: string;
  vendorName: string;
  category: ExpenseCategory | string; // top-level category (for price-history grouping). Combined "Category – Subcategory" is a derived display label, see categoryLabel().
  subcategory: string;                // subcategory / supply name (for price-history grouping)
  description: string;
  quantity: number;                   // 0 when not applicable
  unit: string;                       // '' when not applicable — unit of measure for the quantity (Kg, sack…)
  unitPrice: number;                  // 0 when not applicable — a price observation for the supply
  /**
   * Line items for multi-item purchases. Optional / empty for single-line
   * expenses (services, lump sums, legacy records) which use the flat
   * quantity/unit/unitPrice/category fields above instead.
   */
  items?: ExpenseItem[];
  amount: number;                     // for multi-item expenses this equals the sum of item totals
  paymentMethod: PaymentMethod | string;
  paid: boolean;
  /**
   * Bookkeeping attributes (optional for back-compat with older records):
   *  - accountingClassification: how the expense is treated in the books
   *    (CapEx / OpEx / COGS / …). Editable option list, cascades on rename.
   *  - expenseType: cost behavior (Fixed / Variable / Semi-Variable / …).
   */
  accountingClassification?: string;
  expenseType?: string;
  /** Cuttings only (single-line expense): whether it arrives packed or bare. */
  cuttingState?: CuttingPurchaseState;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Payroll ──────────────────────────────────────────────────────────────────

/** A single worked day on a timesheet. fraction is 1 (full) or 0.5 (half). */
export interface WorkedDay {
  date: string;        // YYYY-MM-DD
  fraction: 0.5 | 1;
}

export interface PayrollEntry {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  employeeId: string;
  employeeName: string;
  daysWorked: number;       // source of truth for pay math; derived from workedDays when present
  /**
   * Per-day timesheet detail (full/half days). Optional — legacy entries and
   * quick manual entries may set daysWorked directly without this breakdown.
   */
  workedDays?: WorkedDay[];
  rate: number;             // daily rate at time of payment
  grossPay: number;         // auto-calculated: daysWorked*rate + commission + bonus
  deductions: number;
  netPay: number;           // auto-calculated: grossPay - deductions
  commissionAmount: number; // commission payout in this period (from sales)
  bonus: number;            // optional bonus / incentive
  /** Whether this payroll entry has been paid out to the employee */
  paid?: boolean;
  /** Date the entry was actually paid (defaults to the pay week's Saturday, but can be earlier) */
  paidDate?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Commission Log ───────────────────────────────────────────────────────────

export interface CommissionEntry {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  saleId: string;
  saleAmount: number;
  commissionPct: number;    // percentage (e.g. 3 = 3%)
  commissionAmount: number; // auto-calculated: saleAmount * commissionPct / 100
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

/** User-editable at runtime (see inventoryCategoryStore), so a free string. */
export type InventoryCategory = string;

export interface InventoryItem {
  id: string;
  category: InventoryCategory;
  subcategory: string;
  unit: string;
  beginningQty: number;
  purchased: number;
  used: number;
  sold: number;
  endingQty: number;        // auto-calc: beginning + purchased - used - sold + packed + needsPacking + produced
  unitCost: number;
  /**
   * Cuttings-specific allocation pools, driven by the Cuttings Store post-rooting
   * allocation, cutting purchases, and the Sales delivery flow. Independent of the
   * purchase/sale math above. Optional for back-compat — treat `undefined` as 0.
   *  - packed:           cuttings ready to sell — farm-packed from a rooted batch
   *                      ("Mark as Packed") OR bought from a customer already
   *                      packed. Counts as on-hand stock, so it feeds endingQty.
   *  - needsPacking:     bare cuttings bought from a customer that still need
   *                      packing before they can be sold. On hand (feeds
   *                      endingQty) but NOT sellable until packed (see packCuttings).
   *  - breedingStock:    rooted cuttings reserved for our own farm ("Reserve for Farm").
   *  - availableForSale: the "Ready for Sale" pool — still-unsold packed cuttings
   *                      (packed − delivered). Decremented when a cutting sale is
   *                      marked received.
   *  - produced:         finished goods manufactured in-house from other inventory
   *                      inputs (e.g. a drink pressed from fruit, our own fertilizer
   *                      blend). Credited by the Produce step and feeds endingQty.
   */
  packed?: number;
  needsPacking?: number;
  breedingStock?: number;
  availableForSale?: number;
  produced?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Manufacturing / transformation (making one product from others) ──────────
// Distinct from the harvest ProductionEntry below — this models turning existing
// inventory inputs into a NEW finished product (Fruit → Drink, ingredients → own
// Fertilizer brand).

/** A single raw-material input consumed by a manufacturing run. */
export interface ManufactureInput {
  category: string;
  subcategory: string;
  quantity: number;
  unit: string;
}

/**
 * A manufacturing run: staged inputs consumed from inventory to make a target
 * product. While `status` is 'staged' the run accumulates inputs (each also
 * incremented the input row's `used`, lowering its ending qty). Producing it
 * credits the target inventory row's `produced` pool with `producedQty` and
 * closes the run.
 */
export interface ManufactureRun {
  id: string;
  targetCategory: string;
  targetSubcategory: string;
  inputs: ManufactureInput[];
  producedQty: number;        // finished units credited on Produce (0 while staged)
  producedUnit: string;       // unit of the finished target product
  status: 'staged' | 'produced';
  stagedDate: string;         // ISO date the run was opened / first input staged
  producedDate: string;       // ISO date it was produced ('' while staged)
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Production ───────────────────────────────────────────────────────────────

export interface ProductionEntry {
  id: string;
  date: string;
  farmBlock: string;
  /**
   * The employee who did the harvest. Optional for back-compat — legacy entries
   * predate worker attribution. `harvestedByName` snapshots the name at save time
   * so later employee edits/deletes never rewrite historical records; the id links
   * back to the employee for per-worker performance rollups (see Payroll).
   */
  harvestedById?: string;
  harvestedByName?: string;
  plants: number;
  /**
   * Date the plants/batch flowered. Dragon fruit ripens ~30 days after
   * flowering, so this drives the estimated harvest window used to highlight
   * rows entering their harvest window. Optional / '' for legacy or
   * harvest-only records.
   */
  floweringDate?: string;
  fruitsHarvested: number;
  goodFruits: number;
  damaged: number;          // auto-calculated: fruitsHarvested - goodFruits
  weightKg: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Farm Information ─────────────────────────────────────────────────────────

export type SectionType = 'Greenhouse' | 'Post' | 'Open Field' | 'Nursery' | 'Other';

export interface FarmSection {
  id: string;
  sectionType: SectionType | string;
  area: number;
  unit: string;             // e.g. "Sqm", "Hectare"
  currentPlantCapacity: number;
  plantSubcategory: string;
  pic: string;              // Person-in-Charge
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Cuttings ─────────────────────────────────────────────────────────────────

/** Lifecycle status of a cutting batch (derived — see cuttingStore). */
export type CuttingStatus = (typeof CUTTING_STATUSES)[number];

/**
 * A batch of dragon-fruit cuttings grafted and grown until rooted.
 *
 * This tracks the *growing* side only — cost, rooting, and readiness. Selling
 * cuttings happens in the Sales flow (unified with all other products), so a
 * batch has no sales/revenue of its own. `quantitySold` is recorded manually to
 * reflect how many have left the batch.
 */
/** Where a Cuttings Store record came from — our nursery, or a customer purchase. */
export type CuttingSource = (typeof CUTTING_SOURCES)[number];

/** Rooted vs. unrooted — drives the estimated-ready-date calculation. */
export type CuttingType = (typeof CUTTING_TYPES)[number];

/** Where a rooted-ready internal batch is allocated. */
export type CuttingAllocation = (typeof CUTTING_ALLOCATIONS)[number];

export interface CuttingBatch {
  id: string;
  subcategory: string;         // dragon-fruit variety (e.g. "Thai White"); category is implicitly "Cuttings"
  /**
   * Origin of this record:
   *  - "Internal Batch": our own nursery propagation (manually created).
   *  - "Customer": cascaded automatically from a cutting sale in the Sales module.
   * Optional for back-compat — treat `undefined` as "Internal Batch".
   */
  source?: CuttingSource | string;
  /** Cutting type — affects the estimated ready date. */
  cuttingType?: CuttingType | string;
  /** For "Customer" records: who bought the cuttings (links back to the sale). */
  customerId?: string;
  customerName?: string;
  saleId?: string;
  /**
   * Internal batches only: the date the cuttings were harvested (user input).
   * Cuttings then callus/heal for a fixed hold (CUTTING_CALLUSING_DAYS) before
   * their growth countdown begins, so the planting/acquisition date below is
   * derived as harvestDate + the callusing hold. '' for customer records.
   */
  harvestDate?: string;
  dateSourced: string;         // planting / acquisition date. Internal: derived (harvest + callusing hold). Customer: the purchase date.
  dateGrafted: string;         // when grafting/planting happened ('' if not yet)
  quantitySourced: number;     // number of cuttings in the batch
  sourceCostPerCutting: number; // ₱ paid per cutting to source it
  graftCostPerCutting: number;  // optional extra prep cost per cutting (₱)
  rootWeeks: number;           // expected weeks to root (2–4)
  quantitySold: number;        // how many have been sold/left the batch (manual)
  /**
   * Post-rooting destination for an internal rooted-ready batch. '' / undefined
   * until the user flags it. Setting it cascades the quantity into the matching
   * inventory pool (breeding stock for replant, available-for-sale for delivery).
   */
  allocation?: CuttingAllocation | string;
  /**
   * Set true once staff click "Mark as Packed" on a rooted-ready batch. Packing
   * releases the quantity into the Available-Stock-for-Sale inventory pool and
   * moves the status to "Packed & Ready for Delivery".
   */
  packed?: boolean;
  /**
   * The exact quantity credited to inventory when the batch was packed. Captured
   * at pack time so "Undo Packed" subtracts precisely the same amount back out,
   * even if the available quantity changes afterwards. 0 when not packed.
   */
  packedQty?: number;
  /**
   * Set true when a replant-flagged internal batch is deployed into the field via
   * "Mark as Planted". This moves it out of the Farm Breeding Stock pool and
   * feeds the wholesale harvest forecast.
   */
  planted?: boolean;
  /**
   * Deployment date — when the cuttings went into the ground. For internal
   * batches this is set on "Mark as Planted"; it seeds the harvest-window
   * forecast. '' until deployed.
   */
  deploymentDate?: string;
  // ── Derived (recomputed on write) ──
  readyDate: string;           // auto = dateGrafted + rootWeeks (ISO, '' if not grafted)
  /**
   * Estimated date the cuttings are ready, derived from the acquisition date and
   * the variety + cutting-type growth cycle. Complements `readyDate` (which is
   * driven by the graft date + rooting window for internal batches) so customer
   * records with no graft date still get a readiness estimate.
   */
  estimatedReadyDate: string;
  totalCost: number;           // auto = quantitySourced * (sourceCost + graftCost)
  quantityAvailable: number;   // auto = quantitySourced - quantitySold
  status: CuttingStatus;       // auto from dates + quantities
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Summary / Dashboard ──────────────────────────────────────────────────────

export interface DashboardSummary {
  totalSales: number;
  totalExpenses: number;
  totalPayroll: number;
  profit: number;           // totalSales - totalExpenses - totalPayroll
  totalEmployees: number;
  totalProducts: number;
  totalCustomers: number;
  totalVendors: number;
  totalInventoryItems: number;
  recentSales: Sale[];
  recentExpenses: Expense[];
  salesByMonth: { month: string; amount: number }[];
  expensesByCategory: { category: string; amount: number }[];
}
