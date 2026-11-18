import {
  addMonthsToPeriod,
  buildInstallmentSchedule,
  formatDebtBudgetName,
  calculateAcceleratedPayoff,
  canEditOrDeleteDebt,
} from '../debt';
import type { Budget, Debt } from '../../models';

describe('debt domain logic', () => {
  describe('addMonthsToPeriod', () => {
    it('correctly shifts months within the same year', () => {
      expect(addMonthsToPeriod('2026-01', 0)).toBe('2026-01');
      expect(addMonthsToPeriod('2026-01', 5)).toBe('2026-06');
    });

    it('correctly handles crossing year boundaries', () => {
      expect(addMonthsToPeriod('2026-11', 1)).toBe('2026-12');
      expect(addMonthsToPeriod('2026-11', 2)).toBe('2027-01');
      expect(addMonthsToPeriod('2026-11', 14)).toBe('2028-01');
    });
  });

  describe('buildInstallmentSchedule', () => {
    it('creates single installment for one_time debt', () => {
      const schedule = buildInstallmentSchedule({
        debtId: 'debt-1',
        debtType: 'one_time',
        inputMode: 'total',
        inputAmount: 500_000,
        tenor: 1,
        startPeriodId: '2026-11',
      });

      expect(schedule.totalAmount).toBe(500_000);
      expect(schedule.installments).toHaveLength(1);
      expect(schedule.installments[0]).toEqual({
        index: 1,
        periodId: '2026-11',
        amount: 500_000,
        budgetId: 'debt-debt-1-1',
        status: 'unpaid',
      });
    });

    it('allocates remainder rounding to the last installment for total mode', () => {
      // 1,000,000 / 3 = 333,333 with remainder 1
      const schedule = buildInstallmentSchedule({
        debtId: 'debt-2',
        debtType: 'installment',
        inputMode: 'total',
        inputAmount: 1_000_000,
        tenor: 3,
        startPeriodId: '2026-11',
      });

      expect(schedule.totalAmount).toBe(1_000_000);
      expect(schedule.installments).toHaveLength(3);
      expect(schedule.installments[0].amount).toBe(333_333);
      expect(schedule.installments[0].periodId).toBe('2026-11');
      expect(schedule.installments[1].amount).toBe(333_333);
      expect(schedule.installments[1].periodId).toBe('2026-12');
      expect(schedule.installments[2].amount).toBe(333_334);
      expect(schedule.installments[2].periodId).toBe('2027-01');
      expect(
        schedule.installments.reduce((sum, item) => sum + item.amount, 0),
      ).toBe(1_000_000);
    });

    it('multiplies amount per tenor in monthly mode', () => {
      const schedule = buildInstallmentSchedule({
        debtId: 'debt-3',
        debtType: 'installment',
        inputMode: 'monthly',
        inputAmount: 250_000,
        tenor: 4,
        startPeriodId: '2026-11',
      });

      expect(schedule.totalAmount).toBe(1_000_000);
      expect(schedule.installments).toHaveLength(4);
      schedule.installments.forEach((inst, i) => {
        expect(inst.amount).toBe(250_000);
        expect(inst.index).toBe(i + 1);
      });
      expect(schedule.installments[3].periodId).toBe('2027-02');
    });
  });

  describe('formatDebtBudgetName', () => {
    it('formats one_time debt without index label', () => {
      expect(formatDebtBudgetName('Pinjam Teman', 'one_time', 1, 1)).toBe(
        'Pinjam Teman',
      );
    });

    it('formats installment debt with (index/tenor) labels from 1/6 to 6/6', () => {
      expect(formatDebtBudgetName('Kulkas', 'installment', 1, 6)).toBe(
        'Kulkas (1/6)',
      );
      expect(formatDebtBudgetName('Kulkas', 'installment', 6, 6)).toBe(
        'Kulkas (6/6)',
      );
    });
  });

  describe('calculateAcceleratedPayoff', () => {
    const createDebtFixture = (): Debt => ({
      id: 'debt-100',
      householdId: 'h-1',
      name: 'Motor',
      debtType: 'installment',
      originType: 'purchase',
      fundSourceId: 'debit',
      fundSourceName: 'Debit',
      fundSourceType: 'debit',
      totalAmount: 6_000_000,
      tenor: 6,
      effectiveTenor: 6,
      startPeriodId: '2026-01',
      installments: [
        { index: 1, periodId: '2026-01', amount: 1_000_000, budgetId: 'b-1', status: 'paid' },
        { index: 2, periodId: '2026-02', amount: 1_000_000, budgetId: 'b-2', status: 'paid' },
        { index: 3, periodId: '2026-03', amount: 1_000_000, budgetId: 'b-3', status: 'paid' },
        { index: 4, periodId: '2026-04', amount: 1_000_000, budgetId: 'b-4', status: 'unpaid' },
        { index: 5, periodId: '2026-05', amount: 1_000_000, budgetId: 'b-5', status: 'unpaid' },
        { index: 6, periodId: '2026-06', amount: 1_000_000, budgetId: 'b-6', status: 'unpaid' },
      ],
      note: '',
      status: 'active',
      createdBy: 'u-1',
      createdAt: null,
      updatedBy: 'u-1',
      updatedAt: null,
    });

    it('accelerates debt payoff at target index (4/4) and combines remaining amounts', () => {
      const debt = createDebtFixture();
      const result = calculateAcceleratedPayoff(debt, 4);

      expect(result.effectiveTenor).toBe(4);
      expect(result.installments).toHaveLength(4);
      // Index 4 now has 1,000,000 + 1,000,000 (from 5) + 1,000,000 (from 6) = 3,000,000
      expect(result.targetInstallment.amount).toBe(3_000_000);
      expect(result.installments[3].amount).toBe(3_000_000);
      expect(result.removedInstallments).toHaveLength(2);
      expect(result.removedInstallments[0].index).toBe(5);
      expect(result.removedInstallments[1].index).toBe(6);
      expect(result.totalAmount).toBe(6_000_000);

      const label = formatDebtBudgetName(
        debt.name,
        debt.debtType,
        result.targetInstallment.index,
        result.effectiveTenor,
      );
      expect(label).toBe('Motor (4/4)');
    });

    it('throws error when target index is already paid or out of bounds', () => {
      const debt = createDebtFixture();
      expect(() => calculateAcceleratedPayoff(debt, 1)).toThrow();
      expect(() => calculateAcceleratedPayoff(debt, 6)).toThrow();
      expect(() => calculateAcceleratedPayoff(debt, 7)).toThrow();
    });
  });

  describe('canEditOrDeleteDebt', () => {
    const baseDebt: Debt = {
      id: 'debt-101',
      householdId: 'h-1',
      name: 'Laptop',
      debtType: 'installment',
      originType: 'purchase',
      fundSourceId: 'debit',
      fundSourceName: 'Debit',
      fundSourceType: 'debit',
      totalAmount: 3_000_000,
      tenor: 3,
      effectiveTenor: 3,
      startPeriodId: '2026-11',
      installments: [
        { index: 1, periodId: '2026-11', amount: 1_000_000, budgetId: 'b-1', status: 'unpaid' },
        { index: 2, periodId: '2026-12', amount: 1_000_000, budgetId: 'b-2', status: 'unpaid' },
        { index: 3, periodId: '2027-01', amount: 1_000_000, budgetId: 'b-3', status: 'unpaid' },
      ],
      note: '',
      status: 'active',
      createdBy: 'u-1',
      createdAt: null,
      updatedBy: 'u-1',
      updatedAt: null,
    };

    it('returns true when no installments are paid and budgets have 0 realizedAmount', () => {
      const budgets = [
        { id: 'b-1', debtId: baseDebt.id, realizedAmount: 0 } as Budget,
        { id: 'b-2', debtId: baseDebt.id, realizedAmount: 0 } as Budget,
        { id: 'b-3', debtId: baseDebt.id, realizedAmount: 0 } as Budget,
      ];
      expect(canEditOrDeleteDebt(baseDebt, budgets)).toBe(true);
    });

    it('returns false when at least one installment is marked paid', () => {
      const modifiedDebt: Debt = {
        ...baseDebt,
        installments: [
          { ...baseDebt.installments[0], status: 'paid' },
          baseDebt.installments[1],
          baseDebt.installments[2],
        ],
      };
      const budgets = [
        { id: 'b-1', realizedAmount: 0 } as Budget,
      ];
      expect(canEditOrDeleteDebt(modifiedDebt, budgets)).toBe(false);
    });

    it('returns false when any related budget has realizedAmount > 0', () => {
      const budgets = [
        { id: 'b-1', debtId: baseDebt.id, realizedAmount: 500_000 } as Budget,
        { id: 'b-2', debtId: baseDebt.id, realizedAmount: 0 } as Budget,
      ];
      expect(canEditOrDeleteDebt(baseDebt, budgets)).toBe(false);
    });

    it('ignores realized budgets belonging to another debt', () => {
      const budgets = [
        { id: 'other-budget', debtId: 'different-debt', realizedAmount: 500_000 } as Budget,
      ];
      expect(canEditOrDeleteDebt(baseDebt, budgets)).toBe(true);
    });
  });
});
