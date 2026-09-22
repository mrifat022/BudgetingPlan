import {displayUnexpected, unexpectedBudgetId, isUnexpectedBudget} from '../unexpected';

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
