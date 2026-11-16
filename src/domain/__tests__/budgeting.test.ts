import {
  availableCreditLimit,
  budgetStatus,
  creditPaymentBudgetItems,
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
  expect(
    budgetStatus(
      budget({realizationType: 'savings_allocation', categoryId: 'tabungan', categoryName: 'Tabungan', cashAllocated: true, realizedAmount: 200_000}),
    ),
  ).toBe('savings_allocated');
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
      budget({id: 'saving', name: 'Dana masa depan', categoryId: 'tabungan', categoryName: 'Tabungan', fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', realizationType: 'savings_allocation', amount: 200_000, realizedAmount: 200_000, cashAllocated: true}),
      budget({id: 'dana-darurat', name: 'Belanja Tak Terduga', categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga', fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', amount: 50_000, realizedAmount: 50_000}),
    ],
    expenses: [],
    creditPayments: [],
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
    totalCreditPayments: 0,
    availableDebit: 1_000_000,
    totalBudget: 700_000,
    budgetRealized: 350_000,
    totalRealized: 400_000,
    remainingBudget: 350_000,
    debitBudget: 650_000,
    remainingDebitBudget: 350_000,
    unallocatedDebit: 350_000,
    totalCreditLimit: 1_000_000,
    creditBudget: 300_000,
    unallocatedCredit: 700_000,
  });
  expect(groupBudgets(data.budgets, 'fundSource')[0].remaining).toBe(150_000);
  expect(groupBudgets(data.budgets, 'fundSource').find(item => item.id === 'debit')?.budget).toBe(450_000);
});

test('pemakaian debit memasukkan pembayaran kartu dan BTT, pemakaian kredit memasukkan seluruh BTT', () => {
  const data: PeriodData = {
    incomes: [{
      id: 'income', householdId: 'h1', periodId: '2026-11', categoryId: 'gaji',
      categoryName: 'Gaji', amount: 10_850_000, date: '2026-11-01', note: '', ...audit,
    }],
    budgets: [
      budget({id: 'planned-debit', fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', amount: 7_000_000}),
      budget({id: 'dana-darurat', categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga', fundSourceId: 'debit', fundSourceName: 'Debit', fundSourceType: 'debit', amount: 100_000, realizedAmount: 100_000}),
      budget({id: 'planned-credit', fundSourceType: 'credit_card', amount: 2_700_000}),
    ],
    expenses: [{
      id: 'unexpected-credit', householdId: 'h1', periodId: '2026-11',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit', fundSourceType: 'credit_card',
      amount: 173_748, date: '2026-11-10', note: '', creditSettled: true, ...audit,
    }],
    creditPayments: [{
      id: 'payment', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 2_969_401, date: '2026-11-13', note: '', ...audit,
    }],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000, ...audit,
    }],
  };
  const sources = [source({id: 'debit', name: 'Debit', type: 'debit'}), source()];

  expect(summarizePeriod(data, sources)).toMatchObject({
    debitBudget: 10_069_401,
    remainingDebitBudget: 780_599,
    unallocatedDebit: 780_599,
    creditBudget: 2_873_748,
    unallocatedCredit: 126_252,
  });
});

test('pembayaran kartu muncul sebagai realisasi virtual kategori Tagihan Rutin yang tetap', () => {
  const items = creditPaymentBudgetItems([{
    id: 'payment', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
    fundSourceName: 'Kartu Kredit', amount: 2_000_000, date: '2026-11-13', note: '', ...audit,
  }]);

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    categoryId: '__system-credit-card-bill__',
    categoryName: 'Tagihan Rutin',
    fundSourceId: 'debit',
    amount: 2_000_000,
    realizedAmount: 2_000_000,
  });
  expect(budgetStatus(items[0])).toBe('realized');
});

test('kelebihan belanja tak terduga tidak membuat budget lain terlihat selesai', () => {
  const data: PeriodData = {
    incomes: [],
    budgets: [
      budget({id: 'rutin', amount: 400_000, realizedAmount: 250_000}),
      budget({
        id: 'dana-darurat',
        categoryId: 'dana-darurat',
        categoryName: 'Belanja Tak Terduga',
        amount: 100_000,
        realizedAmount: 300_000,
      }),
    ],
    expenses: [],
    creditPayments: [],
    creditLimits: [],
  };

  expect(summarizePeriod(data, [source()])).toMatchObject({
    totalBudget: 400_000,
    budgetRealized: 250_000,
    totalRealized: 550_000,
    remainingBudget: 150_000,
    progress: 0.625,
  });
});

test('kelebihan satu item tidak menutupi sisa item lain dalam kelompok', () => {
  const grouped = groupBudgets([
    budget({id: 'lebih', amount: 100_000, realizedAmount: 150_000}),
    budget({id: 'kurang', amount: 200_000, realizedAmount: 50_000}),
  ], 'category');

  expect(grouped[0]).toMatchObject({
    budget: 300_000,
    realized: 200_000,
    remaining: 150_000,
  });
});

test('pelunasan mengurangi sisa Debit dan BTT kartu tetap tercatat sebagai pemakaian periode', () => {
  const data: PeriodData = {
    incomes: [{
      id: 'dividen', householdId: 'h1', periodId: '2026-10', categoryId: 'dividen',
      categoryName: 'Dividen', amount: 3_000_000, date: '2026-10-13', note: '', ...audit,
    }],
    budgets: [budget({
      id: 'unexpected-credit-cc', categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      amount: 515_137, realizedAmount: 515_137,
    })],
    expenses: [{
      id: 'e1', householdId: 'h1', periodId: '2026-10', budgetId: 'unexpected-credit-cc',
      budgetName: 'Belanja Tak Terduga', categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit', fundSourceType: 'credit_card',
      amount: 515_137, date: '2026-10-10', note: '', creditSettled: true, ...audit,
    }],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000, availableAmount: 3_000_000, ...audit,
    }],
    creditPayments: [{
      id: 'p1', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 2_968_839, date: '2026-10-13', note: '', ...audit,
    }, {
      id: 'p2-duplikat', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 2_968_839, date: '2026-10-13', note: '', ...audit,
    }],
  };

  expect(summarizePeriod(data, [source()])).toMatchObject({
    totalIncome: 3_000_000,
    totalCreditPayments: 2_968_839,
    availableDebit: 31_161,
    debitBudget: 2_968_839,
    remainingDebitBudget: 31_161,
    unallocatedDebit: 31_161,
    creditBudget: 515_137,
    unallocatedCredit: 2_484_863,
    totalRealized: 515_137,
  });
});

test('limit bulan aktif mengikuti koreksi pengeluaran bulan lalu secara realtime', () => {
  const previousData: PeriodData = {
    incomes: [],
    budgets: [],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      availableAmount: 3_000_000, ...audit,
    }],
    creditPayments: [{
      id: 'payment-oct', householdId: 'h1', periodId: '2026-10',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit', amount: 2_453_702,
      date: '2026-10-13', note: '', ...audit,
    }],
    expenses: [{
      id: 'before-payment', householdId: 'h1', periodId: '2026-10',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      fundSourceType: 'credit_card', amount: 242_878,
      date: '2026-10-03', note: '', creditSettled: false, ...audit,
    }, {
      id: 'after-payment', householdId: 'h1', periodId: '2026-10',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      fundSourceType: 'credit_card', amount: 2_134_947,
      date: '2026-10-20', note: '', creditSettled: false, ...audit,
    }],
  };
  const currentData: PeriodData = {
    incomes: [],
    budgets: [],
    expenses: [],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      availableAmount: 953_008, openingAvailableAmount: 953_008,
      openingSource: 'carry', ...audit,
    }],
    creditPayments: [],
  };

  expect(availableCreditLimit(currentData, 'cc', previousData)).toBe(622_175);
  expect(summarizePeriod(currentData, [source()], previousData).totalCreditLimit).toBe(622_175);

  // Menambahkan transaksi Oktober setelah tanggal pembayaran memperbarui
  // saldo November tanpa perlu mengubah dokumen limit November.
  previousData.expenses.push({
    id: 'late-expense', householdId: 'h1', periodId: '2026-10',
    budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
    categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
    fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
    fundSourceType: 'credit_card', amount: 100_000,
    date: '2026-10-25', note: '', creditSettled: false, ...audit,
  });
  expect(availableCreditLimit(currentData, 'cc', previousData)).toBe(522_175);
  expect(summarizePeriod(currentData, [source()], previousData).totalCreditLimit).toBe(522_175);
});

test('kapasitas kredit periode menambahkan limit yang dipulihkan melalui pembayaran', () => {
  const previousData: PeriodData = {
    incomes: [], budgets: [], expenses: [], creditPayments: [],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      availableAmount: 647_175, ...audit,
    }],
  };
  const currentData: PeriodData = {
    incomes: [], budgets: [],
    expenses: [{
      id: 'before-payment', householdId: 'h1', periodId: '2026-11',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      fundSourceType: 'credit_card', amount: 647_175,
      date: '2026-11-10', note: '', creditSettled: true, ...audit,
    }],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      availableAmount: 3_000_000, openingAvailableAmount: 647_175,
      openingSource: 'carry', ...audit,
    }],
    creditPayments: [{
      id: 'payment', householdId: 'h1', periodId: '2026-11', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      date: '2026-11-13', note: '', ...audit,
    }],
  };

  expect(summarizePeriod(currentData, [source()], previousData)).toMatchObject({
    totalCreditLimit: 3_647_175,
    creditBudget: 647_175,
    unallocatedCredit: 3_000_000,
  });
});

test('transaksi periode lalu yang baru dicatat setelah pembayaran mengurangi limit tersedia', () => {
  const data: PeriodData = {
    incomes: [],
    budgets: [],
    creditLimits: [{
      id: 'cc', householdId: 'h1', periodId: '2026-10', fundSourceId: 'cc',
      fundSourceName: 'Kartu Kredit', amount: 3_000_000,
      availableAmount: 3_000_000, openingSource: 'payment', ...audit,
    }],
    creditPayments: [{
      id: 'payment-oct', householdId: 'h1', periodId: '2026-10',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      amount: 2_134_947, date: '2026-10-13', note: '', ...audit,
    }],
    expenses: [{
      id: 'already-accounted-after-payment', householdId: 'h1', periodId: '2026-10',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      fundSourceType: 'credit_card', amount: 2_134_947,
      date: '2026-10-20', note: '', creditSettled: false, ...audit,
    }, {
      id: 'late-before-payment', householdId: 'h1', periodId: '2026-10',
      budgetId: 'unexpected-credit-cc', budgetName: 'Belanja Tak Terduga',
      categoryId: 'dana-darurat', categoryName: 'Belanja Tak Terduga',
      fundSourceId: 'cc', fundSourceName: 'Kartu Kredit',
      fundSourceType: 'credit_card', amount: 242_878,
      date: '2026-10-03', note: '', creditSettled: false, ...audit,
    }],
  };

  expect(availableCreditLimit(data, 'cc')).toBe(622_175);
});
