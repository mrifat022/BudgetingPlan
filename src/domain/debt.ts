import type {
  Budget,
  Debt,
  DebtInstallment,
  DebtType,
} from '../models';

export function addMonthsToPeriod(startPeriodId: string, offsetMonths: number): string {
  const [year, month] = startPeriodId.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + offsetMonths;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export interface BuildInstallmentParams {
  debtId: string;
  debtType: DebtType;
  inputMode: 'total' | 'monthly';
  inputAmount: number;
  tenor: number;
  startPeriodId: string;
}

export function buildInstallmentSchedule({
  debtId,
  debtType,
  inputMode,
  inputAmount,
  tenor,
  startPeriodId,
}: BuildInstallmentParams): { totalAmount: number; installments: DebtInstallment[] } {
  if (debtType === 'one_time') {
    return {
      totalAmount: inputAmount,
      installments: [
        {
          index: 1,
          periodId: startPeriodId,
          amount: inputAmount,
          budgetId: `debt-${debtId}-1`,
          status: 'unpaid',
        },
      ],
    };
  }

  const safeTenor = Math.max(1, Math.floor(tenor));
  let totalAmount = 0;
  const installments: DebtInstallment[] = [];

  if (inputMode === 'total') {
    totalAmount = inputAmount;
    const base = Math.floor(inputAmount / safeTenor);
    const remainder = inputAmount - base * safeTenor;

    for (let index = 1; index <= safeTenor; index++) {
      const isLast = index === safeTenor;
      const amount = isLast ? base + remainder : base;
      installments.push({
        index,
        periodId: addMonthsToPeriod(startPeriodId, index - 1),
        amount,
        budgetId: `debt-${debtId}-${index}`,
        status: 'unpaid',
      });
    }
  } else {
    totalAmount = inputAmount * safeTenor;
    for (let index = 1; index <= safeTenor; index++) {
      installments.push({
        index,
        periodId: addMonthsToPeriod(startPeriodId, index - 1),
        amount: inputAmount,
        budgetId: `debt-${debtId}-${index}`,
        status: 'unpaid',
      });
    }
  }

  return { totalAmount, installments };
}

export function formatDebtBudgetName(
  debtName: string,
  debtType: DebtType,
  index: number,
  effectiveTenor: number,
): string {
  if (debtType === 'one_time') {
    return debtName;
  }
  return `${debtName} (${index}/${effectiveTenor})`;
}

export function calculateAcceleratedPayoff(debt: Debt, targetIndex: number) {
  if (targetIndex < 1 || targetIndex >= debt.effectiveTenor) {
    throw new Error('Termin target tidak valid untuk percepatan pelunasan.');
  }

  const targetInstallment = debt.installments[targetIndex - 1];
  if (!targetInstallment) {
    throw new Error('Termin target tidak ditemukan.');
  }

  if (targetInstallment.status === 'paid') {
    throw new Error('Termin target sudah berstatus lunas.');
  }

  const futureInstallments = debt.installments.slice(
    targetIndex,
    debt.effectiveTenor,
  );
  const remainingAmount = futureInstallments.reduce(
    (sum, inst) => sum + inst.amount,
    0,
  );

  const combinedAmount = targetInstallment.amount + remainingAmount;
  const updatedTargetInstallment: DebtInstallment = {
    ...targetInstallment,
    amount: combinedAmount,
  };

  const updatedInstallments: DebtInstallment[] = [
    ...debt.installments.slice(0, targetIndex - 1),
    updatedTargetInstallment,
  ];

  const removedInstallments = debt.installments.slice(targetIndex);

  const totalAmount = updatedInstallments.reduce(
    (sum, inst) => sum + inst.amount,
    0,
  );

  return {
    effectiveTenor: targetIndex,
    installments: updatedInstallments,
    totalAmount,
    removedInstallments,
    targetInstallment: updatedTargetInstallment,
  };
}

export function canEditOrDeleteDebt(
  debt: Debt,
  relatedBudgets: Budget[] = [],
): boolean {
  const debtBudgets = relatedBudgets.filter(b => b.debtId === debt.id);
  const hasPaidInstallment = debt.installments.some(
    inst => inst.status === 'paid',
  );
  const hasRealizedBudget = debtBudgets.some(
    budget => (budget.realizedAmount ?? 0) > 0,
  );
  return !hasPaidInstallment && !hasRealizedBudget;
}
