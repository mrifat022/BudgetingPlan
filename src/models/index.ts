import type { Timestamp as FirestoreTimestamp } from '@react-native-firebase/firestore';

export type Timestamp = FirestoreTimestamp;
export type UserRole = 'owner' | 'member';
export type FundSourceType = 'debit' | 'credit_card' | 'cash' | 'other';
export type RealizationType =
  | 'transaction'
  | 'cash_allocation'
  | 'savings_allocation';
export type BudgetStatus =
  | 'unrealized'
  | 'partial'
  | 'realized'
  | 'cash_allocated'
  | 'savings_allocated';

export type DebtType = 'one_time' | 'installment';
export type DebtOriginType = 'cash_loan' | 'purchase';
export type DebtStatus = 'active' | 'paid';
export type ReceivableStatus = 'unpaid' | 'partial' | 'paid';

export interface AuditFields {
  createdBy: string;
  createdAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  householdId: string;
  role: UserRole;
  active: boolean;
}

export interface Household {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Timestamp | null;
}

export interface HouseholdMember {
  id: string;
  displayName: string;
  role: UserRole;
  joinedAt: Timestamp | null;
}

export interface ActivityLog {
  id: string;
  householdId: string;
  periodId: string;
  createdBy: string;
  createdAt: Timestamp | null;
  action: string;
  description: string;
}

export interface Period extends AuditFields {
  id: string;
  householdId: string;
  year: number;
  month: number;
  label: string;
  status: 'active' | 'closed' | 'archived';
}

export interface IncomeCategory extends AuditFields {
  id: string;
  householdId: string;
  name: string;
  active: boolean;
}

export interface BudgetCategory extends AuditFields {
  id: string;
  householdId: string;
  name: string;
  active: boolean;
}

export interface FundSource extends AuditFields {
  id: string;
  householdId: string;
  name: string;
  type: FundSourceType;
  monthlyLimit: number | null;
  active: boolean;
}

export interface CreditLimit extends AuditFields {
  id: string;
  householdId: string;
  periodId: string;
  fundSourceId: string;
  fundSourceName: string;
  amount: number;
  availableAmount?: number;
  openingAvailableAmount?: number;
  openingSource?: 'carry' | 'manual' | 'payment';
}

export interface CreditPayment extends AuditFields {
  id: string;
  householdId: string;
  periodId: string;
  fundSourceId: string;
  fundSourceName: string;
  amount: number;
  date: string;
  note: string;
  previousLimitAvailableAmount?: number;
  previousOpeningAvailableAmount?: number | null;
  previousOpeningSource?: 'carry' | 'manual' | 'payment' | null;
}

export interface Income extends AuditFields {
  id: string;
  householdId: string;
  periodId: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  date: string;
  note: string;
}

export interface Budget extends AuditFields {
  id: string;
  householdId: string;
  periodId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  fundSourceId: string;
  fundSourceName: string;
  fundSourceType?: FundSourceType;
  amount: number;
  realizedAmount: number;
  realizationType: RealizationType;
  cashAllocated: boolean;
  note: string;
  mergedInto?: string;
  debtId?: string;
  debtInstallmentIndex?: number;
  debtTotalInstallments?: number;
}

export interface Expense extends AuditFields {
  id: string;
  householdId: string;
  periodId: string;
  budgetId: string;
  budgetName: string;
  categoryId: string;
  categoryName: string;
  fundSourceId: string;
  fundSourceName: string;
  fundSourceType?: FundSourceType;
  amount: number;
  date: string;
  note: string;
  creditSettled?: boolean;
  creditSettlementId?: string;
}

export interface DebtInstallment {
  index: number;
  periodId: string;
  amount: number;
  budgetId: string;
  status: 'unpaid' | 'paid';
}

export interface Debt extends AuditFields {
  id: string;
  householdId: string;
  name: string;
  debtType: DebtType;
  originType: DebtOriginType;
  fundSourceId: string;
  fundSourceName: string;
  fundSourceType: FundSourceType;
  totalAmount: number;
  tenor: number;
  effectiveTenor: number;
  startPeriodId: string;
  installments: DebtInstallment[];
  linkedIncomeId?: string;
  note: string;
  status: DebtStatus;
}

export interface ReceivablePayment {
  id: string;
  amount: number;
  date: string;
  periodId: string;
  linkedIncomeId: string;
}

export interface Receivable extends AuditFields {
  id: string;
  householdId: string;
  debtorName: string;
  amount: number;
  paidAmount: number;
  date: string;
  periodId: string;
  dueDate?: string;
  note: string;
  status: ReceivableStatus;
  payments: ReceivablePayment[];
}

export interface PeriodData {
  incomes: Income[];
  budgets: Budget[];
  expenses: Expense[];
  creditLimits: CreditLimit[];
  creditPayments: CreditPayment[];
}

export interface FinancialSummary {
  totalIncome: number;
  totalCreditPayments: number;
  totalReceivablesOut: number;
  availableDebit: number;
  totalBudget: number;
  budgetRealized: number;
  totalRealized: number;
  remainingBudget: number;
  debitBudget: number;
  remainingDebitBudget: number;
  unallocatedDebit: number;
  totalCreditLimit: number;
  creditBudget: number;
  unallocatedCredit: number;
  progress: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  budget: number;
  realized: number;
  remaining: number;
}
