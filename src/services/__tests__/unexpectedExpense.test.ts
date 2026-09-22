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
  getDocsFromServer: async (ref: any) => ({docs: [...mockStore.keys()].filter(path => path.startsWith(ref.path + '/') && path.split('/').length === ref.path.split('/').length + 1).map(mockSnapshot)}),
  runTransaction: async (_db: any, callback: any) => {
    // Optimistic retry also checks a period revision, which protects query insertions.
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, any>();
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (ref: any) => { reads.set(ref.path, mockStore.get(ref.path)); return mockSnapshot(ref.path); },
        set: (ref: any, value: any, options?: any) => writes.push(() => mockStore.set(ref.path, options?.merge ? {...mockStore.get(ref.path), ...value} : value)),
        update: (ref: any, value: any) => writes.push(() => mockStore.set(ref.path, {...mockStore.get(ref.path), ...value})),
        delete: (ref: any) => writes.push(() => mockStore.delete(ref.path)),
      });
      if ([...reads].some(([path, value]) => mockStore.get(path) !== value)) { continue; }
      writes.forEach(write => write());
      return result;
    }
    throw new Error('Retry limit');
  },
}));

import {addUnexpectedExpense, deleteExpense, releaseBudgetRemainder} from '../firebase';
import type {Expense} from '../../models';
const base = 'households/h/periods/2026-09';
const spend = (source: string, amount: number) => addUnexpectedExpense('h', '2026-09', 'u', source, {amount, date: '2026-09-13', note: 'Perbaikan'});
beforeEach(() => {
  mockStore.clear(); mockId = 0;
  mockStore.set(base, {householdId: 'h'});
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

test('melepaskan alokasi lama tanpa menghapus realisasi dan tanpa hitung ganda', async () => {
  mockStore.set(`${base}/budgets/dana-darurat`, {amount: 600000, realizedAmount: 100000, fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', realizationType: 'transaction'});
  await spend('debit', 500000);
  expect(mockStore.get(`${base}/budgets/dana-darurat`)).toMatchObject({amount: 600000, realizedAmount: 600000});
  await expect(spend('debit', 1)).rejects.toThrow('saldo Debit');
});

test('kredit tidak memakai saldo Debit atau limit kartu lain', async () => {
  await spend('bca', 500000);
  await expect(spend('bca', 1)).rejects.toThrow('limit');
  await expect(spend('mandiri', 1)).rejects.toThrow('limit');
  expect(mockStore.has(`${base}/budgets/dana-darurat`)).toBe(false);
  await expect(spend('debit', 600000)).resolves.toBeDefined();
});

test('dua perangkat tidak dapat memakai saldo tersisa yang sama', async () => {
  const outcomes = await Promise.allSettled([spend('debit', 400000), spend('debit', 400000)]);
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(mockStore.get(`${base}/budgets/dana-darurat`).realizedAmount).toBe(400000);
});

test('validasi gagal tidak membuat budget atau pengeluaran', async () => {
  await expect(spend('debit', 600001)).rejects.toThrow();
  await expect(spend('debit', 0)).rejects.toThrow();
  await expect(addUnexpectedExpense('h', '2026-09', 'u', 'debit', {amount: 1, date: '2026-09-13', note: ''})).rejects.toThrow('catatan');
  expect([...mockStore.keys()].filter(path => path.includes('/expenses/'))).toHaveLength(0);
  expect(mockStore.has(`${base}/budgets/dana-darurat`)).toBe(false);
  expect([...mockStore.keys()].filter(path => path.startsWith('households/h/activities/'))).toHaveLength(0);
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
