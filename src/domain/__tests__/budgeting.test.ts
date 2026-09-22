import {
  budgetStatus,
  groupBudgets,
  summarizePeriod,
  validateExpense,
} from '../budgeting';
import type {Budget, FundSource, PeriodData} from '../../models';

const audit = {createdBy: 'u1', createdAt: null, updatedBy: 'u1', updatedAt: null};
const budget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'b1',
  householdId: 'h1',
  periodId: '2026-08',
  name: 'Listrik',
  categoryId: 'tagihan',
  categoryName: 'Tagihan Rutin',
  fundSourceId: 'cc',
  fundSourceName: 'Kartu Kredit',
  amount: 200_000,
  realizedAmount: 0,
  realizationType: 'transaction',
  cashAllocated: false,
  note: '',
  ...audit,
  ...overrides,
});
const source = (overrides: Partial<FundSource> = {}): FundSource => ({
  id: 'cc', householdId: 'h1', name: 'Kartu Kredit', type: 'credit_card',
  monthlyLimit: null, active: true, ...audit, ...overrides,
});

test('menolak realisasi yang melewati sisa budget', () => {
  expect(validateExpense(220_000, 200_000)).toBe(
    'Nominal pengeluaran melebihi sisa budget sebesar Rp20.000.',
  );
});

test('menghasilkan status bertahap dan alokasi cash', () => {
  expect(budgetStatus(budget())).toBe('unrealized');
  expect(budgetStatus(budget({realizedAmount: 100_000}))).toBe('partial');
  expect(budgetStatus(budget({realizedAmount: 200_000}))).toBe('realized');
  expect(
    budgetStatus(
      budget({realizationType: 'cash_allocation', cashAllocated: true, realizedAmount: 200_000}),
    ),
  ).toBe('cash_allocated');
});

test('meringkas periode dan kelompok sumber dana', () => {
  const data: PeriodData = {
    incomes: [{
      id: 'i1', householdId: 'h1', periodId: '2026-08', categoryId: 'gaji',
      categoryName: 'Gaji', amount: 1_000_000, date: '2026-08-01', note: '', ...audit,
    }],
    budgets: [
      budget({id: 'debit-budget', fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', amount: 400_000, realizedAmount: 250_000}),
      budget({id: 'credit-budget', fundSourceType: 'credit_card', amount: 300_000, realizedAmount: 100_000}),
    ],
    expenses: [],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-08', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 1_000_000, ...audit,
    }],
  };
  const sources = [
    source({id: 'debit', name: 'Debit', type: 'debit'}),
    source(),
  ];
  expect(summarizePeriod(data, sources)).toMatchObject({
    totalIncome: 1_000_000,
    totalBudget: 700_000,
    totalRealized: 350_000,
    remainingBudget: 350_000,
    debitBudget: 400_000,
    unallocatedDebit: 600_000,
    totalCreditLimit: 1_000_000,
    creditBudget: 300_000,
    unallocatedCredit: 700_000,
  });
  expect(groupBudgets(data.budgets, 'fundSource')[0].remaining).toBe(150_000);
});
