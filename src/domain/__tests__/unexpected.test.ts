import {displayUnexpected, unexpectedBudgetId, isUnexpectedBudget, unexpectedAvailable} from '../unexpected';
import type {PeriodData} from '../../models';

const audit = {createdBy: 'u1', createdAt: null, updatedBy: 'u1', updatedAt: null};

test('mempertahankan ID Debit lama dan memisahkan setiap kartu kredit', () => {
  expect(unexpectedBudgetId({id: 'debit', type: 'debit'})).toBe('dana-darurat');
  expect(unexpectedBudgetId({id: 'bca', type: 'credit_card'})).not.toBe(unexpectedBudgetId({id: 'mandiri', type: 'credit_card'}));
  expect(isUnexpectedBudget('unexpected-credit-bca')).toBe(true);
  expect(isUnexpectedBudget('regular-budget')).toBe(false);
});

test('riwayat lama tampil dengan nama baru tanpa mengubah hubungan atau nominal', () => {
  const old = {id: 'expense-1', budgetId: 'dana-darurat', budgetName: 'Dana Darurat', categoryId: 'dana-darurat', categoryName: 'Dana Darurat', amount: 50000};
  expect(displayUnexpected(old)).toEqual({...old, budgetName: 'Belanja Tak Terduga', categoryName: 'Belanja Tak Terduga'});
  expect(old.budgetName).toBe('Dana Darurat');
});

test('piutang tanpa flag memotong kapasitas debit, tetapi piutang lama yang ditandai tidak', () => {
  const receivable = {
    id: 'legacy', householdId: 'h1', debtorName: 'A', amount: 125_000,
    paidAmount: 0, date: '2026-08-02', periodId: '2026-08', note: '',
    status: 'unpaid' as const, payments: [], ...audit,
  };
  const skippedReceivable = {
    ...receivable, id: 'historical', amount: 275_000, skipBalanceDeduction: true,
  };
  const data: PeriodData = {
    incomes: [{id: 'income', householdId: 'h1', periodId: '2026-08', categoryId: 'salary', categoryName: 'Gaji', amount: 1_000_000, date: '2026-08-01', note: '', ...audit}],
    budgets: [], expenses: [], creditPayments: [], creditLimits: [],
  };
  const debit = {id: 'debit', type: 'debit' as const};

  expect(unexpectedAvailable(data, debit, [], [receivable, skippedReceivable], '2026-08')).toBe(875_000);
});
