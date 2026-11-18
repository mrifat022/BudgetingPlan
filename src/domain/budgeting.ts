import type {
  Budget,
  BudgetStatus,
  CreditPayment,
  FinancialSummary,
  FundSource,
  FundSourceType,
  GroupSummary,
  PeriodData,
  Receivable,
} from '../models';

export function remainingForBudget(
  budget: Pick<Budget, 'amount' | 'realizedAmount'>,
) {
  return Math.max(0, budget.amount - budget.realizedAmount);
}

export function isSavingsCategory(category: {
  categoryId?: string;
  categoryName?: string;
}) {
  const categoryId = category.categoryId?.trim().toLowerCase() ?? '';
  const categoryName = category.categoryName?.trim().toLowerCase() ?? '';
  return categoryId === 'tabungan' || categoryName.includes('tabungan');
}

export function isSavingsBudget(
  budget: Pick<Budget, 'categoryId' | 'categoryName' | 'realizationType'>,
) {
  return (
    budget.realizationType === 'savings_allocation' || isSavingsCategory(budget)
  );
}

export function isUnexpectedBudgetItem(
  budget: Pick<Budget, 'id' | 'categoryId'>,
) {
  return (
    budget.id === 'dana-darurat' ||
    budget.id.startsWith('unexpected-credit-') ||
    budget.categoryId === 'dana-darurat'
  );
}

// Older builds could save the same full card payment more than once when the
// button was tapped again before realtime data refreshed. Treat identical
// source/date/amount records as one logical payment in every calculation.
export function uniqueCreditPayments(payments: PeriodData['creditPayments']) {
  const seen = new Set<string>();
  return payments.filter(payment => {
    const key = `${payment.fundSourceId}|${payment.date}|${payment.amount}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function receivablesDeductedAmount(
  receivables: Receivable[],
  periodId: string,
) {
  return receivables
    .filter(
      item =>
        item.periodId === periodId && item.skipBalanceDeduction !== true,
    )
    .reduce((sum, item) => sum + item.amount, 0);
}

const SYSTEM_CREDIT_PAYMENT_PREFIX = '__system-credit-payment-';
export const SYSTEM_CREDIT_PAYMENT_CATEGORY_ID = '__system-credit-card-bill__';

/**
 * Payments remain stored only in creditPayments. This stable, virtual budget row
 * lets Budgeting display them without depending on editable category masters or
 * writing a duplicate expense/budget transaction.
 */
export function creditPaymentBudgetItems(
  payments: CreditPayment[],
): Budget[] {
  return uniqueCreditPayments(payments).map(payment => ({
    id: `${SYSTEM_CREDIT_PAYMENT_PREFIX}${payment.id}`,
    householdId: payment.householdId,
    periodId: payment.periodId,
    name: `Pembayaran ${payment.fundSourceName}`,
    categoryId: SYSTEM_CREDIT_PAYMENT_CATEGORY_ID,
    categoryName: 'Tagihan Rutin',
    fundSourceId: 'debit',
    fundSourceName: 'Debit',
    fundSourceType: 'debit',
    amount: payment.amount,
    realizedAmount: payment.amount,
    realizationType: 'transaction',
    cashAllocated: false,
    note: payment.date,
    createdBy: payment.createdBy,
    createdAt: payment.createdAt,
    updatedBy: payment.updatedBy,
    updatedAt: payment.updatedAt,
  }));
}

export function isSystemCreditPaymentBudget(item: Pick<Budget, 'id'>) {
  return item.id.startsWith(SYSTEM_CREDIT_PAYMENT_PREFIX);
}

export function budgetStatus(
  budget: Pick<
    Budget,
    'amount' | 'realizedAmount' | 'realizationType' | 'cashAllocated'
  >,
): BudgetStatus {
  if (budget.realizationType === 'cash_allocation' && budget.cashAllocated) {
    return 'cash_allocated';
  }
  if (budget.realizationType === 'savings_allocation' && budget.cashAllocated) {
    return 'savings_allocated';
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
    case 'savings_allocated':
      return 'Ditabung';
    default:
      return 'Belum';
  }
}

export function validateExpense(
  amount: number,
  remaining: number,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Nominal pengeluaran harus lebih dari Rp0.';
  }
  if (amount > remaining) {
    const excess = amount - remaining;
    return `Nominal pengeluaran melebihi sisa budget sebesar Rp${excess.toLocaleString(
      'id-ID',
    )}.`;
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

export function summarizePeriod(
  data: PeriodData,
  fundSources: FundSource[],
  previousPeriodData?: PeriodData,
  receivables: Receivable[] = [],
  periodId?: string,
): FinancialSummary {
  const activePeriodId =
    periodId ??
    data.incomes[0]?.periodId ??
    data.budgets[0]?.periodId ??
    data.creditPayments[0]?.periodId ??
    data.creditLimits[0]?.periodId ??
    '';
  const totalReceivablesOut = activePeriodId
    ? receivablesDeductedAmount(receivables, activePeriodId)
    : 0;
  const totalIncome = data.incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalCreditPayments = uniqueCreditPayments(data.creditPayments).reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const expenseBudgets = data.budgets.filter(item => !isSavingsBudget(item));
  const plannedBudgets = expenseBudgets.filter(
    item => !isUnexpectedBudgetItem(item),
  );
  const totalBudget = plannedBudgets.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  // Capaian budgeting dihitung per item. Pengeluaran BTT dan kelebihan realisasi
  // pada satu item tidak boleh menutupi sisa budget item lain.
  const budgetRealized = plannedBudgets.reduce(
    (sum, item) => sum + Math.min(item.amount, item.realizedAmount),
    0,
  );
  const totalRealized = expenseBudgets.reduce(
    (sum, item) => sum + item.realizedAmount,
    0,
  );
  const plannedDebitBudget = data.budgets
    .filter(item => fundSourceTypeForBudget(item, fundSources) === 'debit')
    .reduce((sum, item) => sum + item.amount, 0);
  // Credit-card repayments use Debit funds without being regular expense items.
  // Include them in this card so the unallocated Debit remainder reflects cash
  // already committed to paying the card bill.
  const debitBudget = plannedDebitBudget + totalCreditPayments;
  const availableDebit = totalIncome - totalCreditPayments - totalReceivablesOut;
  const remainingDebitBudget = availableDebit - plannedDebitBudget;
  const unallocatedDebit = availableDebit - plannedDebitBudget;
  const plannedCreditBudget = data.budgets
    .filter(
      item =>
        fundSourceTypeForBudget(item, fundSources) === 'credit_card' &&
        !isUnexpectedBudgetItem(item),
    )
    .reduce((sum, item) => sum + item.amount, 0);
  const unexpectedCreditSpending = data.expenses
    .filter(
      item =>
        (item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type) === 'credit_card' &&
        isUnexpectedBudgetItem({
          id: item.budgetId,
          categoryId: item.categoryId,
        }),
    )
    .reduce((sum, item) => sum + item.amount, 0);
  const creditBudget = plannedCreditBudget + unexpectedCreditSpending;
  const totalCreditLimit = data.creditLimits.reduce((sum, limit) => {
    // For period planning, include the usable balance carried into the month
    // and credit actually restored by payments made during this month. A
    // payment amount is the restored capacity (not the card's full plafond).
    const priorLimit = previousPeriodData?.creditLimits.find(
      item => item.fundSourceId === limit.fundSourceId,
    );
    const sourcePayments = uniqueCreditPayments(data.creditPayments)
      .filter(payment => payment.fundSourceId === limit.fundSourceId)
      .sort((a, b) => a.date.localeCompare(b.date));
    const firstPayment = sourcePayments[0];
    const openingAvailable =
      limit.openingSource === 'manual'
        ? limit.openingAvailableAmount ?? limit.availableAmount ?? limit.amount
        : previousPeriodData && priorLimit
          ? endingCreditAvailability(previousPeriodData, limit.fundSourceId)
          : firstPayment?.previousLimitAvailableAmount ??
            limit.openingAvailableAmount ??
            (firstPayment
              ? Math.max(0, limit.amount - firstPayment.amount)
              : limit.availableAmount ?? limit.amount);
    const restoredDuringPeriod = sourcePayments.reduce(
      (paymentSum, payment) => paymentSum + payment.amount,
      0,
    );
    return sum + openingAvailable + restoredDuringPeriod;
  }, 0);
  return {
    totalIncome,
    totalCreditPayments,
    totalReceivablesOut,
    availableDebit,
    totalBudget,
    budgetRealized,
    totalRealized,
    remainingBudget: plannedBudgets.reduce(
      (sum, item) => sum + remainingForBudget(item),
      0,
    ),
    debitBudget,
    remainingDebitBudget,
    unallocatedDebit,
    totalCreditLimit,
    creditBudget,
    unallocatedCredit: totalCreditLimit - creditBudget,
    progress: totalBudget > 0 ? budgetRealized / totalBudget : 0,
  };
}

function creditAvailabilityAtDate(
  data: PeriodData,
  sourceId: string,
  previousPeriodData: PeriodData | undefined,
  throughDate: string | undefined,
): number {
  const limit = data.creditLimits.find(item => item.fundSourceId === sourceId);
  if (!limit) {
    return 0;
  }

  const payments = uniqueCreditPayments(data.creditPayments)
    .filter(
      payment =>
        payment.fundSourceId === sourceId &&
        (!throughDate || payment.date <= throughDate),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastPayment = payments[payments.length - 1];
  const priorLimit = previousPeriodData?.creditLimits.find(
    item => item.fundSourceId === sourceId,
  );

  let startingAvailable: number;
  if (lastPayment) {
    // Pembayaran penuh memulihkan limit ke plafon kartu.
    startingAvailable = limit.amount;
  } else if (limit.openingSource === 'manual') {
    startingAvailable = limit.openingAvailableAmount ?? limit.availableAmount ?? limit.amount;
  } else if (previousPeriodData && priorLimit) {
    startingAvailable = endingCreditAvailability(previousPeriodData, sourceId);
  } else {
    // Kompatibilitas untuk dokumen lama yang belum memiliki periode sebelumnya
    // atau belum memiliki penanda openingSource.
    startingAvailable = limit.openingAvailableAmount ?? limit.availableAmount ?? limit.amount;
  }

  const unsettled = data.expenses
    .filter(item => {
      if (
        item.fundSourceId !== sourceId ||
        item.fundSourceType !== 'credit_card' ||
        (throughDate && item.date > throughDate)
      ) {
        return false;
      }

      // A payment only settles expenses that existed when it was recorded and
      // were explicitly linked/marked as settled. Do not infer settlement from
      // transaction dates: a prior-period expense can be entered after the
      // payment and must reduce the carried/current available limit.
      return !item.creditSettled;
    })
    .reduce((sum, item) => sum + item.amount, 0);

  return Math.max(0, Math.min(limit.amount, startingAvailable) - unsettled);
}

export function endingCreditAvailability(
  data: PeriodData,
  sourceId: string,
): number {
  const limit = data.creditLimits.find(item => item.fundSourceId === sourceId);
  if (!limit) {
    return 0;
  }
  const unsettled = data.expenses
    .filter(
      item =>
        item.fundSourceId === sourceId &&
        item.fundSourceType === 'credit_card' &&
        !item.creditSettled,
    )
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, (limit.availableAmount ?? limit.amount) - unsettled);
}

export function availableCreditLimitAtDate(
  data: PeriodData,
  sourceId: string,
  previousPeriodData: PeriodData | undefined,
  date: string,
): number {
  return creditAvailabilityAtDate(data, sourceId, previousPeriodData, date);
}

export function availableCreditLimit(
  data: PeriodData,
  sourceId: string,
  previousPeriodData?: PeriodData,
): number {
  return creditAvailabilityAtDate(data, sourceId, previousPeriodData, undefined);
}

export function groupBudgets(
  budgets: Budget[],
  by: 'category' | 'fundSource',
): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();
  for (const budget of budgets.filter(item => !isSavingsBudget(item))) {
    const id = by === 'category' ? budget.categoryId : budget.fundSourceId;
    const name =
      by === 'category' ? budget.categoryName : budget.fundSourceName;
    const current = groups.get(id) ?? {
      id,
      name,
      budget: 0,
      realized: 0,
      remaining: 0,
    };
    current.budget += budget.amount;
    current.realized += budget.realizedAmount;
    current.remaining += remainingForBudget(budget);
    groups.set(id, current);
  }
  return [...groups.values()].sort((a, b) => b.budget - a.budget);
}
