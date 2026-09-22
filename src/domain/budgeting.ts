import type {
  Budget,
  BudgetStatus,
  FinancialSummary,
  FundSource,
  FundSourceType,
  GroupSummary,
  PeriodData,
} from '../models';

export function remainingForBudget(budget: Pick<Budget, 'amount' | 'realizedAmount'>) {
  return Math.max(0, budget.amount - budget.realizedAmount);
}

export function budgetStatus(
  budget: Pick<Budget, 'amount' | 'realizedAmount' | 'realizationType' | 'cashAllocated'>,
): BudgetStatus {
  if (budget.realizationType === 'cash_allocation' && budget.cashAllocated) {
    return 'cash_allocated';
  }
  if (budget.realizedAmount <= 0) {
    return 'unrealized';
  }
  if (budget.realizedAmount < budget.amount) {
    return 'partial';
  }
  return 'realized';
}

export function statusLabel(status: BudgetStatus): string {
  switch (status) {
    case 'partial':
      return 'Sebagian';
    case 'realized':
      return 'Terealisasi';
    case 'cash_allocated':
      return 'Alokasi Cash';
    default:
      return 'Belum';
  }
}

export function validateExpense(amount: number, remaining: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Nominal pengeluaran harus lebih dari Rp0.';
  }
  if (amount > remaining) {
    const excess = amount - remaining;
    return `Nominal pengeluaran melebihi sisa budget sebesar Rp${excess.toLocaleString('id-ID')}.`;
  }
  return null;
}

export function fundSourceTypeForBudget(
  budget: Pick<Budget, 'fundSourceId' | 'fundSourceName' | 'fundSourceType'>,
  fundSources: FundSource[],
): FundSourceType {
  if (budget.fundSourceType) {
    return budget.fundSourceType;
  }
  const source = fundSources.find(item => item.id === budget.fundSourceId);
  if (source) {
    return source.type;
  }
  const normalizedName = budget.fundSourceName.toLowerCase();
  if (normalizedName.includes('kredit') || normalizedName.includes('credit')) {
    return 'credit_card';
  }
  if (normalizedName.includes('debit') || normalizedName.includes('rekening')) {
    return 'debit';
  }
  return 'other';
}

export function summarizePeriod(data: PeriodData, fundSources: FundSource[]): FinancialSummary {
  const totalIncome = data.incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalBudget = data.budgets.reduce((sum, item) => sum + item.amount, 0);
  const totalRealized = data.budgets.reduce(
    (sum, item) => sum + item.realizedAmount,
    0,
  );
  const debitBudget = data.budgets
    .filter(item => fundSourceTypeForBudget(item, fundSources) === 'debit')
    .reduce((sum, item) => sum + item.amount, 0);
  const creditBudget = data.budgets
    .filter(item => fundSourceTypeForBudget(item, fundSources) === 'credit_card')
    .reduce((sum, item) => sum + item.amount, 0);
  const totalCreditLimit = data.creditLimits.reduce((sum, item) => sum + item.amount, 0);
  return {
    totalIncome,
    totalBudget,
    totalRealized,
    remainingBudget: Math.max(0, totalBudget - totalRealized),
    debitBudget,
    unallocatedDebit: totalIncome - debitBudget,
    totalCreditLimit,
    creditBudget,
    unallocatedCredit: totalCreditLimit - creditBudget,
    progress: totalBudget > 0 ? Math.min(1, totalRealized / totalBudget) : 0,
  };
}

export function groupBudgets(
  budgets: Budget[],
  by: 'category' | 'fundSource',
): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();
  for (const budget of budgets) {
    const id = by === 'category' ? budget.categoryId : budget.fundSourceId;
    const name = by === 'category' ? budget.categoryName : budget.fundSourceName;
    const current = groups.get(id) ?? {id, name, budget: 0, realized: 0, remaining: 0};
    current.budget += budget.amount;
    current.realized += budget.realizedAmount;
    current.remaining = Math.max(0, current.budget - current.realized);
    groups.set(id, current);
  }
  return [...groups.values()].sort((a, b) => b.budget - a.budget);
}
