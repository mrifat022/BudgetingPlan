import type {Budget, FundSource, PeriodData, Receivable} from '../models';
import {
  fundSourceTypeForBudget,
  receivablesDeductedAmount,
  uniqueCreditPayments,
} from './budgeting';

// Keep the existing Debit document ID so old expenses retain their budget link.
export const UNEXPECTED_CATEGORY_ID = 'dana-darurat';
export const UNEXPECTED_NAME = 'Belanja Tak Terduga';
export const unexpectedBudgetId = (source: {id: string; type: string}) =>
  source.type === 'debit' ? 'dana-darurat' : `unexpected-credit-${source.id}`;
export const isUnexpectedBudget = (id: string) =>
  id === 'dana-darurat' || id.startsWith('unexpected-credit-');

// Unused legacy allocations are available again; only actual spending is allocated.
export function normalizeUnexpectedBudget(budget: Budget): Budget {
  return isUnexpectedBudget(budget.id)
    ? {...displayUnexpected(budget), amount: budget.realizedAmount}
    : budget;
}

export function unexpectedAvailable(
  data: PeriodData,
  source: Pick<FundSource, 'id' | 'type'>,
  sources: FundSource[],
  receivables: Receivable[] = [],
  periodId?: string,
): number {
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
  const budgets = data.budgets.map(normalizeUnexpectedBudget);
  const capacity = source.type === 'debit'
    ? data.incomes.reduce((sum, item) => sum + item.amount, 0)
      - uniqueCreditPayments(data.creditPayments).reduce((sum, item) => sum + item.amount, 0)
      - totalReceivablesOut
    : data.creditLimits.find(item => item.fundSourceId === source.id)?.amount ?? 0;
  const allocated = budgets.filter(item => source.type === 'debit'
    ? fundSourceTypeForBudget(item, sources) === 'debit'
    : item.fundSourceId === source.id && !isUnexpectedBudget(item.id)).reduce((sum, item) => sum + item.amount, 0);
  const unsettledUnexpected = source.type === 'credit_card'
    ? data.expenses
      .filter(item => item.fundSourceId === source.id && isUnexpectedBudget(item.budgetId) && !item.creditSettled)
      .reduce((sum, item) => sum + item.amount, 0)
    : 0;
  return capacity - allocated - unsettledUnexpected;
}

export function displayUnexpected<T extends {categoryId?: string; categoryName?: string; id: string; name?: string; budgetId?: string; budgetName?: string}>(item: T): T {
  return {
    ...item,
    ...(item.categoryId === UNEXPECTED_CATEGORY_ID ? {categoryName: UNEXPECTED_NAME} : {}),
    ...(isUnexpectedBudget(item.id) && item.name !== undefined ? {name: UNEXPECTED_NAME} : {}),
    ...(item.budgetId && isUnexpectedBudget(item.budgetId) ? {budgetName: UNEXPECTED_NAME} : {}),
  };
}
