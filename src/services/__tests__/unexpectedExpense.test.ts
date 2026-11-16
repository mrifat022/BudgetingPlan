// In-memory transaction fixture: writes commit together only on success.
const mockStore = new Map<string, any>();
let mockId = 0;
let mockRevision = 0;
const mockSnapshot = (path: string) => {
  const value = mockStore.get(path);
  return {id: path.split('/').pop(), ref: {path}, exists: () => value !== undefined, data: () => value};
};
jest.mock('@react-native-firebase/app', () => ({getApps: () => [{}], getApp: () => ({})}));
jest.mock('@react-native-firebase/auth', () => ({getAuth: () => ({currentUser: {uid: 'u'}})}));
jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: (parent: any, ...parts: string[]) => ({path: [parent.path, ...parts].filter(Boolean).join('/')}),
  doc: (parent: any, ...parts: string[]) => {
    const path = [parent.path, ...(parts.length ? parts : [`auto-${++mockId}`])].filter(Boolean).join('/');
    return {path, id: path.split('/').pop()};
  },
  serverTimestamp: () => ++mockRevision,
  deleteField: () => '__DELETE_FIELD__',
  getDocsFromServer: async (ref: any) => ({docs: [...mockStore.keys()].filter(path => path.startsWith(ref.path + '/') && path.split('/').length === ref.path.split('/').length + 1).map(mockSnapshot)}),
  runTransaction: async (_db: any, callback: any) => {
    // Optimistic retry also checks a period revision, which protects query insertions.
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, any>();
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (ref: any) => { reads.set(ref.path, mockStore.get(ref.path)); return mockSnapshot(ref.path); },
        set: (ref: any, value: any, options?: any) => writes.push(() => mockStore.set(ref.path, options?.merge ? {...mockStore.get(ref.path), ...value} : value)),
        update: (ref: any, value: any) => writes.push(() => {
          const next = {...mockStore.get(ref.path), ...value};
          Object.entries(value).forEach(([key, entry]) => { if (entry === '__DELETE_FIELD__') { delete next[key]; } });
          mockStore.set(ref.path, next);
        }),
        delete: (ref: any) => writes.push(() => mockStore.delete(ref.path)),
      });
      if ([...reads].some(([path, value]) => mockStore.get(path) !== value)) { continue; }
      writes.forEach(write => write());
      return result;
    }
    throw new Error('Retry limit');
  },
}));

import {addUnexpectedExpense, cancelCreditPayment, deleteExpense, moveBudgetRemainderToSavings, moveUnexpectedExpenseToCredit, recordFullCreditPayment, releaseBudgetRemainder, setCashAllocationAmount, setPeriodClosed, updateExpense} from '../firebase';
import {availableCreditLimit} from '../../domain/budgeting';
import type {Expense} from '../../models';
const base = 'households/h/periods/2026-09';
const spend = (source: string, amount: number) => addUnexpectedExpense('h', '2026-09', 'u', source, {amount, date: '2026-09-13', note: 'Perbaikan'});
beforeEach(() => {
  mockStore.clear(); mockId = 0;
  mockStore.set(base, {householdId: 'h', status: 'active'});
  for (const [id, type] of [['debit', 'debit'], ['bca', 'credit_card'], ['mandiri', 'credit_card']]) {
    mockStore.set(`households/h/fundSources/${id}`, {name: id, type, active: true});
  }
  mockStore.set(`${base}/incomes/gaji`, {amount: 1000000});
  mockStore.set(`${base}/budgets/rutin`, {amount: 400000, realizedAmount: 100000, fundSourceType: 'debit', fundSourceId: 'debit'});
  mockStore.set(`${base}/creditLimits/bca`, {amount: 500000, fundSourceId: 'bca'});
});

test('debit langsung: budget dan transaksi dibuat bersama, hapus mengembalikan dana', async () => {
  const id = await spend('debit', 120000);
  expect([...mockStore.entries()].filter(([path]) => path.startsWith('households/h/activities/')).map(([, value]) => value)).toEqual([
    expect.objectContaining({periodId: '2026-09', createdBy: 'u', action: 'pengeluaran_ditambah'}),
  ]);
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 120000, realizedAmount: 120000});
  const expense = {...mockStore.get(`${base}/expenses/${id}`), id} as Expense;
  await deleteExpense('h', '2026-09', 'u', {...expense, amount: 1}); // use persisted amount, not stale UI
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 0, realizedAmount: 0});
  expect(mockStore.has(`${base}/expenses/${id}`)).toBe(false);
  expect([...mockStore.values()].filter(value => value?.action === 'pengeluaran_dihapus')).toHaveLength(1);
  await expect(spend('debit', 600000)).resolves.toBeDefined();
});

test('edit pengeluaran memperbarui transaksi dan realisasi budget secara atomik', async () => {
  mockStore.set(`${base}/budgets/rutin`, {
    name: 'Belanja', amount: 400000, realizedAmount: 100000,
    fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit',
    categoryId: 'bulanan', categoryName: 'Belanja Bulanan', realizationType: 'transaction',
  });
  mockStore.set(`${base}/expenses/e1`, {
    budgetId: 'rutin', budgetName: 'Belanja', amount: 100000, date: '2026-09-10', note: '',
    categoryId: 'bulanan', categoryName: 'Belanja Bulanan', fundSourceId: 'debit', fundSourceName: 'Debit',
  });
  await updateExpense('h', '2026-09', 'u', 'e1', {amount: 250000, date: '2026-09-11', note: 'Koreksi'});
  expect(mockStore.get(`${base}/expenses/e1`)).toMatchObject({amount: 250000, date: '2026-09-11', note: 'Koreksi'});
  expect(mockStore.get(`${base}/budgets/rutin`).realizedAmount).toBe(250000);
  await expect(updateExpense('h', '2026-09', 'u', 'e1', {amount: 450000, date: '2026-09-11', note: ''})).rejects.toThrow('melebihi');
  expect(mockStore.get(`${base}/budgets/rutin`).realizedAmount).toBe(250000);
});

test('edit Belanja Tak Terduga tetap boleh minus dan menyinkronkan nominal budget', async () => {
  const id = await spend('debit', 100000);
  await updateExpense('h', '2026-09', 'u', id, {amount: 700000, date: '2026-09-14', note: 'Perbaikan besar'});
  expect(mockStore.get(`${base}/expenses/${id}`)).toMatchObject({amount: 700000, note: 'Perbaikan besar'});
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 700000, realizedAmount: 700000});
});

test('periode yang ditutup menolak perubahan sampai dibuka kembali', async () => {
  await setPeriodClosed('h', '2026-09', 'u', true);
  expect(mockStore.get(base).status).toBe('closed');
  await expect(spend('debit', 1000)).rejects.toThrow('ditutup');
  await setPeriodClosed('h', '2026-09', 'u', false);
  await expect(spend('debit', 1000)).resolves.toBeDefined();
});

test('Belanja Tak Terduga dapat membuat saldo Debit minus', async () => {
  mockStore.set(`${base}/budgets/dana-darurat`, {amount: 600000, realizedAmount: 100000, fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', realizationType: 'transaction'});
  await spend('debit', 500000);
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 600000, realizedAmount: 600000});
  await expect(spend('debit', 1)).resolves.toBeDefined();
  expect(mockStore.get(`${base}/budgets/dana-darurat`).realizedAmount).toBe(600001);
});

test('Belanja Tak Terduga kartu kredit dapat melewati limit dan tetap terpisah per kartu', async () => {
  await spend('bca', 500000);
  await expect(spend('bca', 1)).resolves.toBeDefined();
  await expect(spend('mandiri', 1)).resolves.toBeDefined();
  expect(mockStore.has(`${base}/budgets/dana-darurat`)).toBe(false);
  await expect(spend('debit', 600000)).resolves.toBeDefined();
});

test('kartu kredit menolak transaksi bertanggal pada atau sebelum pembayaran yang sudah tercatat', async () => {
  mockStore.set(`${base}/creditPayments/bca_2026-09-13`, {
    fundSourceId: 'bca', fundSourceName: 'bca', amount: 400000,
    date: '2026-09-13',
  });
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'bca', {
    amount: 1000, date: '2026-09-13', note: 'Terlambat dicatat',
  })).rejects.toThrow('masih tercatat');
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'bca', {
    amount: 1000, date: '2026-09-12', note: 'Terlambat dicatat',
  })).rejects.toThrow('masih tercatat');
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'bca', {
    amount: 1000, date: '2026-09-14', note: 'Transaksi setelah pembayaran',
  })).resolves.toBeDefined();
});

test('setelah pembayaran dibatalkan, transaksi tanggal sebelum pembayaran dapat diedit kembali', async () => {
  const expenseId = await spend('bca', 100000);
  const paymentAmount = await recordFullCreditPayment(
    'h', '2026-09', 'u', {id: 'bca', name: 'bca', type: 'credit_card'}, 0,
    '2026-09-13',
  );
  const paymentId = 'bca_2026-09-13';
  expect(paymentAmount).toBe(100000);
  expect(mockStore.get(`${base}/expenses/${expenseId}`).creditSettled).toBe(true);
  const result = await cancelCreditPayment('h', '2026-09', 'u', paymentId);
  expect(result).toEqual({paymentAmount: 100000, unlinkedExpenses: 1});
  expect(mockStore.has(`${base}/creditPayments/${paymentId}`)).toBe(false);
  expect(mockStore.get(`${base}/expenses/${expenseId}`)).toMatchObject({creditSettled: false});
  expect(mockStore.get(`${base}/expenses/${expenseId}`).creditSettlementId).toBeUndefined();
  expect(mockStore.get(`${base}/creditLimits/bca`)).toMatchObject({availableAmount: 500000});
  await updateExpense('h', '2026-09', 'u', expenseId, {
    amount: 120000, date: '2026-09-01', note: 'Koreksi transaksi terlupa',
  });
  expect(mockStore.get(`${base}/expenses/${expenseId}`)).toMatchObject({
    amount: 120000, date: '2026-09-01', creditSettled: false,
  });
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'bca', {
    amount: 1000, date: '2026-09-01', note: 'Transaksi lama',
  })).resolves.toBeDefined();
  const available = availableCreditLimit({
    incomes: [], budgets: [],
    expenses: [{...mockStore.get(`${base}/expenses/${expenseId}`), id: expenseId}],
    creditLimits: [{...mockStore.get(`${base}/creditLimits/bca`), id: 'bca'}],
    creditPayments: [],
  }, 'bca');
  expect(available).toBe(380000);
});

test('pembayaran tidak dapat dibatalkan bila limit sudah digunakan setelah pelunasan', async () => {
  await spend('bca', 100000);
  await recordFullCreditPayment(
    'h', '2026-09', 'u', {id: 'bca', name: 'bca', type: 'credit_card'}, 0,
    '2026-09-13',
  );
  await addUnexpectedExpense('h', '2026-09', 'u', 'bca', {
    amount: 1000, date: '2026-09-14', note: 'Setelah pembayaran',
  });
  await expect(cancelCreditPayment('h', '2026-09', 'u', 'bca_2026-09-13'))
    .rejects.toThrow('limit sudah digunakan');
  expect(mockStore.has(`${base}/creditPayments/bca_2026-09-13`)).toBe(true);
});

test('dua perangkat dapat mencatat Belanja Tak Terduga bersamaan meskipun menjadi minus', async () => {
  const outcomes = await Promise.allSettled([spend('debit', 400000), spend('debit', 400000)]);
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(2);
  expect(mockStore.get(`${base}/budgets/dana-darurat`).realizedAmount).toBe(800000);
});

test('nominal positif di atas saldo diizinkan, tetapi nol dan catatan kosong ditolak', async () => {
  await expect(spend('debit', 600001)).resolves.toBeDefined();
  await expect(spend('debit', 0)).rejects.toThrow();
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'debit', {amount: 1, date: '2026-09-13', note: ''})).rejects.toThrow('catatan');
  expect([...mockStore.keys()].filter(path => path.includes('/expenses/'))).toHaveLength(1);
  expect(mockStore.get(`${base}/budgets/dana-darurat`).realizedAmount).toBe(600001);
});

test('sisa budget kartu kredit kembali ke limit kartu yang sama', async () => {
  mockStore.set(`${base}/budgets/belanja-kredit`, {
    amount: 300000, realizedAmount: 125000,
    fundSourceId: 'bca', fundSourceName: 'bca', fundSourceType: 'credit_card',
    realizationType: 'transaction', note: '',
  });
  await releaseBudgetRemainder('h', '2026-09', 'u', 'belanja-kredit', 175000);
  expect(mockStore.get(`${base}/budgets/belanja-kredit`)).toMatchObject({
    amount: 125000,
    realizedAmount: 125000,
  });
  expect(mockStore.get(`${base}/budgets/belanja-kredit`).note).toContain('limit Kartu Kredit');
  expect([...mockStore.values()].filter(value => value?.action === 'sisa_budget_dikembalikan')).toHaveLength(1);
});

test('sisa budget Debit ditambahkan ke satu Tabungan yang sudah ada', async () => {
  mockStore.set(`${base}/budgets/belanja`, {
    name: 'Belanja', amount: 700000, realizedAmount: 200000,
    fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit',
    categoryId: 'bulanan', categoryName: 'Belanja Bulanan', realizationType: 'transaction', note: '',
  });
  mockStore.set(`${base}/budgets/tabungan`, {
    name: 'Tabungan', amount: 2000000, realizedAmount: 2000000,
    fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit',
    categoryId: 'tabungan', categoryName: 'Tabungan', realizationType: 'savings_allocation', cashAllocated: true,
  });
  await moveBudgetRemainderToSavings('h', '2026-09', 'u', 'belanja', 500000);
  expect(mockStore.get(`${base}/budgets/belanja`)).toMatchObject({amount: 200000, realizedAmount: 200000});
  expect(mockStore.get(`${base}/budgets/tabungan`)).toMatchObject({amount: 2500000, realizedAmount: 2500000, cashAllocated: true});
  expect([...mockStore.keys()].filter(path => path.startsWith(`${base}/budgets/`) && mockStore.get(path)?.categoryId === 'tabungan')).toHaveLength(1);
});

test('alokasi cash dapat diserahkan sebagian lalu dilanjutkan sampai penuh', async () => {
  mockStore.set(`${base}/budgets/belanja-cash`, {
    name: 'Belanja Bulanan', amount: 1500000, realizedAmount: 0,
    fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit',
    categoryId: 'bulanan', categoryName: 'Belanja Bulanan',
    realizationType: 'cash_allocation', cashAllocated: false,
  });

  await setCashAllocationAmount('h', '2026-09', 'u', 'belanja-cash', 250000);
  expect(mockStore.get(`${base}/budgets/belanja-cash`)).toMatchObject({
    realizedAmount: 250000,
    cashAllocated: false,
  });
  expect([...mockStore.values()].filter(value => value?.action === 'cash_diserahkan_sebagian')).toHaveLength(1);

  await setCashAllocationAmount('h', '2026-09', 'u', 'belanja-cash', 1500000);
  expect(mockStore.get(`${base}/budgets/belanja-cash`)).toMatchObject({
    realizedAmount: 1500000,
    cashAllocated: true,
  });
});

test('nominal penyerahan cash tidak boleh melebihi budget', async () => {
  mockStore.set(`${base}/budgets/belanja-cash`, {
    name: 'Belanja Bulanan', amount: 1500000, realizedAmount: 250000,
    realizationType: 'cash_allocation', cashAllocated: false,
  });

  await expect(setCashAllocationAmount('h', '2026-09', 'u', 'belanja-cash', 1500001)).rejects.toThrow('antara');
  await expect(setCashAllocationAmount('h', '2026-09', 'u', 'belanja-cash', -1)).rejects.toThrow('antara');
  expect(mockStore.get(`${base}/budgets/belanja-cash`).realizedAmount).toBe(250000);
});

test('migrasi BTT ke kartu lalu pelunasan penuh menjaga pengeluaran dan memulihkan limit', async () => {
  mockStore.set(`${base}/incomes/dividen`, {amount: 3000000});
  mockStore.set(`${base}/creditLimits/bca`, {
    amount: 3000000, availableAmount: 546298,
    fundSourceId: 'bca', fundSourceName: 'bca',
  });
  mockStore.set(`${base}/budgets/dana-darurat`, {
    name: 'Belanja Tak Terduga', amount: 515137, realizedAmount: 515137,
    fundSourceId: 'debit', fundSourceName: 'debit', fundSourceType: 'debit',
    categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga', realizationType: 'transaction',
  });
  mockStore.set(`${base}/expenses/e-migrasi`, {
    budgetId: 'dana-darurat', budgetName: 'Belanja Tak Terduga', amount: 515137,
    date: '2026-09-10', note: 'Darurat sebelum bayar',
    categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
    fundSourceId: 'debit', fundSourceName: 'debit', fundSourceType: 'debit',
  });

  await moveUnexpectedExpenseToCredit('h', '2026-09', 'u', 'e-migrasi', 'bca');
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 0, realizedAmount: 0});
  expect(mockStore.get(`${base}/budgets/unexpected-credit-bca`)).toMatchObject({amount: 515137, realizedAmount: 515137});
  expect(mockStore.get(`${base}/expenses/e-migrasi`)).toMatchObject({
    fundSourceId: 'bca', fundSourceType: 'credit_card', creditSettled: false,
  });

  const paid = await recordFullCreditPayment('h', '2026-09', 'u', {id: 'bca', name: 'bca', type: 'credit_card'}, 31161, '2026-09-13');
  expect(paid).toBe(2968839);
  expect(mockStore.get(`${base}/creditLimits/bca`).availableAmount).toBe(3000000);
  expect(mockStore.get(`${base}/expenses/e-migrasi`).creditSettled).toBe(true);
  expect([...mockStore.values()].find(value => value?.fundSourceId === 'bca' && value?.amount === 2968839 && value?.date === '2026-09-13')).toBeDefined();
  await expect(recordFullCreditPayment('h', '2026-09', 'u', {id: 'bca', name: 'bca', type: 'credit_card'}, 31161, '2026-09-13'))
    .rejects.toThrow('sudah tercatat');
  expect([...mockStore.entries()].filter(([path, value]) => path.startsWith(`${base}/creditPayments/`) && value.amount === 2968839)).toHaveLength(1);
});
