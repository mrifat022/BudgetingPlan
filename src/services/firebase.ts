import { getApp, getApps } from '@react-native-firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@react-native-firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  getFirestore,
  onSnapshot,
  where,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
  type Transaction,
} from '@react-native-firebase/firestore';
import type {
  Budget,
  ActivityLog,
  BudgetCategory,
  CreditLimit,
  CreditPayment,
  Debt,
  DebtInstallment,
  DebtOriginType,
  DebtType,
  Expense,
  FundSource,
  FundSourceType,
  Income,
  IncomeCategory,
  HouseholdMember,
  Period,
  PeriodData,
  RealizationType,
  Receivable,
  ReceivablePayment,
  ReceivableStatus,
  UserProfile,
} from '../models';
import {
  isValidISODate,
  periodIdFromDate,
  periodLabel,
  periodParts,
  previousPeriodId,
  todayISO,
} from '../utils/period';
import { formatRupiah } from '../utils/currency';
import {
  fundSourceTypeForBudget,
  isSavingsBudget,
  isUnexpectedBudgetItem,
  availableCreditLimit,
  availableCreditLimitAtDate,
  uniqueCreditPayments,
  validateExpense,
} from '../domain/budgeting';
import {
  formatDebtBudgetName,
  calculateAcceleratedPayoff,
  canEditOrDeleteDebt,
} from '../domain/debt';

const LOGIN_DOMAIN = 'budgeting-plan.local';
import {
  displayUnexpected,
  isUnexpectedBudget,
  unexpectedBudgetId,
  normalizeUnexpectedBudget,
  UNEXPECTED_NAME,
  UNEXPECTED_CATEGORY_ID,
} from '../domain/unexpected';

function requireFirebase() {
  if (getApps().length === 0) {
    throw new Error(
      'Firebase belum dikonfigurasi. Tambahkan android/app/google-services.json lalu build ulang aplikasi.',
    );
  }
  return getApp();
}

function auth() {
  return getAuth(requireFirebase());
}

function firestore() {
  return getFirestore(requireFirebase());
}

function emailFromUsername(username: string) {
  const value = username.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@${LOGIN_DOMAIN}`;
}

function mapDocs<T extends { id: string }>(
  snapshot: QuerySnapshot<DocumentData, DocumentData>,
): T[] {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as T));
}

function householdCollection(householdId: string, name: string) {
  return collection(firestore(), 'households', householdId, name);
}

function periodCollection(householdId: string, periodId: string, name: string) {
  return collection(
    firestore(),
    'households',
    householdId,
    'periods',
    periodId,
    name,
  );
}

function budgetRef(householdId: string, periodId: string, budgetId: string) {
  return doc(
    firestore(),
    'households',
    householdId,
    'periods',
    periodId,
    'budgets',
    budgetId,
  );
}

export function listenToAuth(
  next: (user: User | null) => void,
  error: (message: string) => void,
): Unsubscribe {
  try {
    return onAuthStateChanged(auth(), next);
  } catch (cause) {
    error(cause instanceof Error ? cause.message : 'Firebase gagal dimuat.');
    return () => undefined;
  }
}

export async function login(username: string, password: string) {
  return signInWithEmailAndPassword(
    auth(),
    emailFromUsername(username),
    password,
  );
}

export async function requestPasswordReset(email: string) {
  const value = email.trim().toLowerCase();
  if (!value || !value.includes('@')) {
    throw new Error(
      'Masukkan alamat email lengkap yang terdaftar di Firebase.',
    );
  }
  return sendPasswordResetEmail(auth(), value);
}

export async function logout() {
  return signOut(auth());
}

export async function getUserProfile(uid: string): Promise<UserProfile> {
  const snapshot = await getDoc(doc(firestore(), 'users', uid));
  if (!snapshot.exists()) {
    throw new Error(
      'Akun berhasil masuk, tetapi belum terhubung ke household. Tambahkan dokumen users/{uid} di Firestore.',
    );
  }
  const profile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
  if (!profile.active || !profile.householdId) {
    throw new Error('Akun ini tidak aktif atau belum memiliki household.');
  }
  return profile;
}

export async function ensureCurrentPeriod(householdId: string, uid: string) {
  const id = periodIdFromDate();
  const { year, month } = periodParts(id);
  const db = firestore();
  const currentRef = doc(db, 'households', householdId, 'periods', id);
  const current = await getDoc(currentRef);
  const batch = writeBatch(db);
  if (!current.exists()) {
    batch.set(currentRef, {
      householdId,
      year,
      month,
      label: periodLabel(id),
      status: 'active',
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  }
  // periods.docs.forEach(item => {
  //   if (item.id !== id && item.data().status === 'active') {
  //     batch.update(item.ref, {status: 'archived', updatedBy: uid, updatedAt: serverTimestamp()});
  //   }
  // });
  await batch.commit();
  await ensureDefaultMasters(householdId, uid);
  if (!current.exists()) {
    await carryCreditLimitsFromPreviousPeriod(householdId, id, uid);
  }
  return id;
}

async function carryCreditLimitsFromPreviousPeriod(
  householdId: string,
  periodId: string,
  uid: string,
) {
  const [year, month] = periodId.split('-').map(Number);
  const previousDate = new Date(year, month - 2, 1);
  const previousId = `${previousDate.getFullYear()}-${String(
    previousDate.getMonth() + 1,
  ).padStart(2, '0')}`;
  const [previousLimits, previousExpenses, currentLimits, sources] =
    await Promise.all([
      getDocs(periodCollection(householdId, previousId, 'creditLimits')),
      getDocs(periodCollection(householdId, previousId, 'expenses')),
      getDocs(periodCollection(householdId, periodId, 'creditLimits')),
      getDocs(householdCollection(householdId, 'fundSources')),
    ]);
  if (!currentLimits.empty || previousLimits.empty) {
    return;
  }
  const sourceMap = new Map(
    mapDocs<FundSource>(sources).map(item => [item.id, item]),
  );
  const expenses = mapDocs<Expense>(previousExpenses);
  const batch = writeBatch(firestore());
  mapDocs<CreditLimit>(previousLimits).forEach(limit => {
    const source = sourceMap.get(limit.fundSourceId);
    if (!source?.active || source.type !== 'credit_card') {
      return;
    }
    const unsettled = expenses
      .filter(
        item =>
          item.fundSourceId === source.id &&
          item.fundSourceType === 'credit_card' &&
          !item.creditSettled,
      )
      .reduce((sum, item) => sum + item.amount, 0);
    const available = Math.max(
      0,
      (limit.availableAmount ?? limit.amount) - unsettled,
    );
    batch.set(
      doc(periodCollection(householdId, periodId, 'creditLimits'), source.id),
      {
        fundSourceId: source.id,
        fundSourceName: source.name,
        amount: source.monthlyLimit ?? limit.amount,
        availableAmount: available,
        openingAvailableAmount: available,
        openingSource: 'carry',
        ...auditForCreate(householdId, periodId, uid),
      },
    );
  });
  await batch.commit();
}

const DEFAULT_INCOME_CATEGORIES = ['Gaji', 'TPP', 'Dividen'];
const DEFAULT_BUDGET_CATEGORIES = [
  'Tagihan Rutin',
  'Belanja Bulanan',
  'Keperluan Pribadi',
  'Orang Tua',
  'Kebutuhan Bayi',
  'Jajan',
  'Elektronik',
  'Transportasi',
  'Tabungan',
  'Belanja Tak Terduga',
  'Lain-lain',
];
const DEFAULT_FUND_SOURCES: Array<{ name: string; type: FundSourceType }> = [
  { name: 'Debit', type: 'debit' },
  { name: 'Kartu Kredit', type: 'credit_card' },
  { name: 'Cash', type: 'cash' },
];

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function ensureDefaultMasters(householdId: string, uid: string) {
  const db = firestore();
  const [incomeSnapshot, budgetSnapshot, sourceSnapshot] = await Promise.all([
    getDocs(householdCollection(householdId, 'incomeCategories')),
    getDocs(householdCollection(householdId, 'budgetCategories')),
    getDocs(householdCollection(householdId, 'fundSources')),
  ]);
  const batch = writeBatch(db);
  const audit = {
    householdId,
    active: true,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
  if (incomeSnapshot.empty) {
    DEFAULT_INCOME_CATEGORIES.forEach(name => {
      batch.set(
        doc(db, 'households', householdId, 'incomeCategories', slug(name)),
        { ...audit, name },
      );
    });
  }
  if (budgetSnapshot.empty) {
    DEFAULT_BUDGET_CATEGORIES.forEach(name => {
      batch.set(
        doc(
          db,
          'households',
          householdId,
          'budgetCategories',
          name === 'Belanja Tak Terduga' ? 'dana-darurat' : slug(name),
        ),
        { ...audit, name },
      );
    });
  } else if (!budgetSnapshot.docs.some(item => item.id === 'dana-darurat')) {
    batch.set(
      doc(db, 'households', householdId, 'budgetCategories', 'dana-darurat'),
      { ...audit, name: 'Belanja Tak Terduga' },
    );
  }
  if (
    !budgetSnapshot.empty &&
    !budgetSnapshot.docs.some(
      item =>
        item.id === 'tabungan' ||
        item.data().name?.toLowerCase().includes('tabungan'),
    )
  ) {
    batch.set(
      doc(db, 'households', householdId, 'budgetCategories', 'tabungan'),
      { ...audit, name: 'Tabungan' },
    );
  }
  if (sourceSnapshot.empty) {
    DEFAULT_FUND_SOURCES.forEach(item => {
      batch.set(
        doc(db, 'households', householdId, 'fundSources', slug(item.name)),
        { ...audit, ...item, monthlyLimit: null },
      );
    });
  }
  await batch.commit();
}

export function subscribePeriods(
  householdId: string,
  next: (items: Period[]) => void,
  error: (message: string) => void,
) {
  return onSnapshot(
    householdCollection(householdId, 'periods'),
    snapshot =>
      next(mapDocs<Period>(snapshot).sort((a, b) => b.id.localeCompare(a.id))),
    cause => error(cause.message),
  );
}

function subscribeItems<T extends { id: string }>(
  ref: ReturnType<typeof collection>,
  next: (items: T[]) => void,
  error: (message: string) => void,
) {
  return onSnapshot(
    ref,
    snapshot => next(mapDocs<T>(snapshot)),
    cause => error(cause.message),
  );
}

export function subscribeIncomeCategories(
  householdId: string,
  next: (items: IncomeCategory[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems(
    householdCollection(householdId, 'incomeCategories'),
    next,
    error,
  );
}

export function subscribeBudgetCategories(
  householdId: string,
  next: (items: BudgetCategory[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems<BudgetCategory>(
    householdCollection(householdId, 'budgetCategories'),
    items =>
      next(
        items.map(item =>
          item.id === 'dana-darurat'
            ? { ...item, name: 'Belanja Tak Terduga' }
            : item,
        ),
      ),
    error,
  );
}

export function subscribeFundSources(
  householdId: string,
  next: (items: FundSource[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems(
    householdCollection(householdId, 'fundSources'),
    next,
    error,
  );
}

export function subscribeActivities(
  householdId: string,
  periodId: string,
  next: (items: ActivityLog[]) => void,
  error: (message: string) => void,
) {
  return onSnapshot(
    query(
      householdCollection(householdId, 'activities'),
      where('periodId', '==', periodId),
    ),
    snapshot =>
      next(
        mapDocs<ActivityLog>(snapshot)
          .sort(
            (a, b) =>
              (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
          )
          .slice(0, 30),
      ),
    cause => error(cause.message),
  );
}

export function subscribeMembers(
  householdId: string,
  next: (items: HouseholdMember[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems<HouseholdMember>(
    householdCollection(householdId, 'members'),
    next,
    error,
  );
}

export function subscribePeriodData(
  householdId: string,
  periodId: string,
  next: (data: PeriodData) => void,
  error: (message: string) => void,
  uid?: string,
) {
  const state: PeriodData = {
    incomes: [],
    budgets: [],
    expenses: [],
    creditLimits: [],
    creditPayments: [],
  };
  const emit = () => next({ ...state });
  const unsubs = [
    subscribeItems<Income>(
      periodCollection(householdId, periodId, 'incomes'),
      items => {
        state.incomes = items.sort((a, b) => b.date.localeCompare(a.date));
        emit();
      },
      error,
    ),
    subscribeItems<Budget>(
      periodCollection(householdId, periodId, 'budgets'),
      items => {
        const activeItems = items.filter(item => !item.mergedInto);
        state.budgets = activeItems
          .map(displayUnexpected)
          .map(normalizeUnexpectedBudget)
          .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        if (uid) {
          items
            .filter(
              item =>
                isUnexpectedBudget(item.id) &&
                item.amount !== item.realizedAmount,
            )
            .forEach(item => {
              withPeriodTransaction(
                householdId,
                periodId,
                uid,
                async transaction => {
                  const ref = budgetRef(householdId, periodId, item.id);
                  const current = await transaction.get(ref);
                  if (
                    current.exists() &&
                    current.data()!.amount !== current.data()!.realizedAmount
                  ) {
                    transaction.update(ref, {
                      amount: current.data()!.realizedAmount,
                      directUnexpected: true,
                      updatedBy: uid,
                      updatedAt: serverTimestamp(),
                    });
                  }
                },
              ).catch(cause =>
                error(
                  `Penyesuaian Belanja Tak Terduga gagal: ${cause.message}`,
                ),
              );
            });
          const savings = activeItems.filter(isSavingsBudget);
          if (savings.length > 1) {
            consolidateSavings(householdId, periodId, uid).catch(cause =>
              error(`Penggabungan Tabungan gagal: ${cause.message}`),
            );
          }
        }
        emit();
      },
      error,
    ),
    subscribeItems<Expense>(
      periodCollection(householdId, periodId, 'expenses'),
      items => {
        state.expenses = items
          .map(displayUnexpected)
          .sort((a, b) => b.date.localeCompare(a.date));
        emit();
      },
      error,
    ),
    subscribeItems<CreditLimit>(
      periodCollection(householdId, periodId, 'creditLimits'),
      items => {
        state.creditLimits = items.sort((a, b) =>
          a.fundSourceName.localeCompare(b.fundSourceName),
        );
        emit();
      },
      error,
    ),
    subscribeItems<CreditPayment>(
      periodCollection(householdId, periodId, 'creditPayments'),
      items => {
        state.creditPayments = items.sort((a, b) =>
          b.date.localeCompare(a.date),
        );
        emit();
      },
      error,
    ),
  ];
  return () => unsubs.forEach(unsubscribe => unsubscribe());
}

export interface CashflowPoint {
  periodId: string;
  budgeting: number;
  expense: number;
}

export async function getCashflowHistory(
  householdId: string,
  periodIds: string[],
): Promise<CashflowPoint[]> {
  return Promise.all(
    periodIds.map(async periodId => {
      const budgets = await getDocs(
        periodCollection(householdId, periodId, 'budgets'),
      );
      const items = budgets.docs
        .map(item => ({ id: item.id, ...item.data() } as Budget))
        .filter(item => !item.mergedInto);
      return {
        periodId,
        budgeting: items
          .filter(
            item => !isSavingsBudget(item) && !isUnexpectedBudgetItem(item),
          )
          .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
        expense: items
          .filter(item => !isSavingsBudget(item))
          .reduce((sum, item) => sum + Number(item.realizedAmount ?? 0), 0),
      };
    }),
  );
}

function auditForCreate(
  householdId: string,
  periodId: string | undefined,
  uid: string,
) {
  return {
    householdId,
    ...(periodId ? { periodId } : {}),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

function activity(
  householdId: string,
  periodId: string,
  uid: string,
  action: string,
  description: string,
) {
  return {
    ref: doc(householdCollection(householdId, 'activities')),
    value: {
      householdId,
      periodId,
      createdBy: uid,
      createdAt: serverTimestamp(),
      action,
      description,
    },
  };
}

function logTransaction(
  transaction: Transaction,
  householdId: string,
  periodId: string,
  uid: string,
  action: string,
  description: string,
) {
  const entry = activity(householdId, periodId, uid, action, description);
  transaction.set(entry.ref, entry.value);
}

// Period writes share a revision document so concurrent balance reads retry,
// including when another device inserts or deletes a budget/income.
function withPeriodTransaction<T>(
  householdId: string,
  periodId: string,
  uid: string,
  action: (transaction: Transaction) => Promise<T>,
) {
  const ref = doc(firestore(), 'households', householdId, 'periods', periodId);
  return runTransaction(firestore(), async transaction => {
    const period = await transaction.get(ref);
    if (!period.exists()) {
      throw new Error('Periode belum tersedia. Buka ulang aplikasi.');
    }
    if (period.data()?.status !== 'active') {
      throw new Error('Periode ini sudah ditutup dan hanya dapat dilihat.');
    }
    const result = await action(transaction);
    transaction.update(ref, { updatedBy: uid, updatedAt: serverTimestamp() });
    return result;
  });
}

export async function setPeriodClosed(
  householdId: string,
  periodId: string,
  uid: string,
  closed: boolean,
) {
  const ref = doc(firestore(), 'households', householdId, 'periods', periodId);
  return runTransaction(firestore(), async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new Error('Periode tidak ditemukan.');
    }
    const period = snapshot.data() as Period;
    if (period.status === 'archived') {
      throw new Error('Periode arsip tidak dapat dibuka kembali.');
    }
    const nextStatus = closed ? 'closed' : 'active';
    transaction.update(ref, {
      status: nextStatus,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      closed ? 'periode_ditutup' : 'periode_dibuka',
      `${closed ? 'Menutup' : 'Membuka kembali'} periode ${
        period.label || periodLabel(periodId)
      }`,
    );
  });
}

async function consolidateSavings(
  householdId: string,
  periodId: string,
  uid: string,
) {
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const budgetsSnapshot = await getDocsFromServer(
        periodCollection(householdId, periodId, 'budgets'),
      );
      const savings = budgetsSnapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as Budget))
        .filter(item => !item.mergedInto && isSavingsBudget(item))
        .sort((a, b) => b.amount - a.amount);
      if (savings.length <= 1) {
        return savings[0]?.id;
      }
      const snapshots = await Promise.all(
        savings.map(item =>
          transaction.get(budgetRef(householdId, periodId, item.id)),
        ),
      );
      const current = snapshots
        .filter(item => item.exists() && !item.data()!.mergedInto)
        .map(item => ({ id: item.id, ...item.data() } as Budget))
        .filter(isSavingsBudget)
        .sort((a, b) => b.amount - a.amount);
      if (current.length <= 1) {
        return current[0]?.id;
      }
      const primary = current[0];
      const merged = current.slice(1);
      const totalAmount = current.reduce((sum, item) => sum + item.amount, 0);
      const totalRealized = current.reduce(
        (sum, item) => sum + item.realizedAmount,
        0,
      );
      const audit = { updatedBy: uid, updatedAt: serverTimestamp() };
      transaction.update(budgetRef(householdId, periodId, primary.id), {
        name: 'Tabungan',
        categoryId: 'tabungan',
        categoryName: 'Tabungan',
        realizationType: 'savings_allocation',
        amount: totalAmount,
        realizedAmount: totalRealized,
        cashAllocated: totalAmount > 0 && totalRealized === totalAmount,
        note: 'Akumulasi dana yang dialokasikan ke Tabungan.',
        ...audit,
      });
      merged.forEach(item =>
        transaction.update(budgetRef(householdId, periodId, item.id), {
          amount: 0,
          realizedAmount: 0,
          cashAllocated: false,
          mergedInto: primary.id,
          ...audit,
        }),
      );
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'tabungan_digabung',
        `Menggabungkan ${current.length} item Tabungan menjadi ${formatRupiah(
          totalAmount,
        )}`,
      );
      return primary.id;
    },
  );
}

export async function saveIncome(
  householdId: string,
  periodId: string,
  uid: string,
  input: Pick<
    Income,
    'categoryId' | 'categoryName' | 'amount' | 'date' | 'note'
  >,
  id?: string,
) {
  const ref = id
    ? doc(periodCollection(householdId, periodId, 'incomes'), id)
    : doc(periodCollection(householdId, periodId, 'incomes'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    if (id) {
      transaction.update(ref, {
        ...input,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      transaction.set(ref, {
        ...input,
        ...auditForCreate(householdId, periodId, uid),
      });
    }
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      id ? 'pemasukan_diubah' : 'pemasukan_ditambah',
      `${id ? 'Mengubah' : 'Menambah'} pemasukan ${
        input.categoryName
      } ${formatRupiah(input.amount)}`,
    );
  });
  return ref.id;
}

export async function deleteIncome(
  householdId: string,
  periodId: string,
  id: string,
) {
  const uid = auth().currentUser!.uid;
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const ref = doc(periodCollection(householdId, periodId, 'incomes'), id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new Error('Pemasukan sudah dihapus.');
    }
    transaction.delete(ref);
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'pemasukan_dihapus',
      `Menghapus pemasukan ${snapshot.data()!.categoryName} ${formatRupiah(
        snapshot.data()!.amount,
      )}`,
    );
  });
}

export async function saveCreditLimit(
  householdId: string,
  periodId: string,
  uid: string,
  source: Pick<FundSource, 'id' | 'name' | 'type'>,
  amount: number,
) {
  if (source.type !== 'credit_card') {
    throw new Error(
      'Limit periode hanya berlaku untuk sumber dana kartu kredit.',
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Limit tersedia harus lebih dari Rp0.');
  }
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const budgets = await getDocsFromServer(
        periodCollection(householdId, periodId, 'budgets'),
      );
      const allocated = budgets.docs
        .map(item =>
          normalizeUnexpectedBudget({ id: item.id, ...item.data() } as Budget),
        )
        .filter(item => item.fundSourceId === source.id)
        .reduce((sum, item) => sum + item.amount, 0);
      if (amount < allocated) {
        throw new Error(
          `Limit tidak boleh lebih kecil dari budget yang sudah dialokasikan (${formatRupiah(
            allocated,
          )}).`,
        );
      }
      const target = doc(
        periodCollection(householdId, periodId, 'creditLimits'),
        source.id,
      );
      const current = await transaction.get(target);
      transaction.set(
        target,
        {
          fundSourceId: source.id,
          fundSourceName: source.name,
          amount,
          availableAmount: amount,
          openingAvailableAmount: amount,
          openingSource: 'manual',
          ...(current.exists()
            ? { updatedBy: uid, updatedAt: serverTimestamp() }
            : auditForCreate(householdId, periodId, uid)),
        },
        { merge: true },
      );
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        current.exists() ? 'limit_diubah' : 'limit_ditambah',
        `Mengatur limit ${source.name} menjadi ${formatRupiah(amount)}`,
      );
    },
  );
}

export async function recordFullCreditPayment(
  householdId: string,
  periodId: string,
  uid: string,
  source: Pick<FundSource, 'id' | 'name' | 'type'>,
  availableBeforePayment: number,
  date: string,
  useManualAvailable = false,
) {
  if (source.type !== 'credit_card') {
    throw new Error('Sumber dana bukan kartu kredit.');
  }
  if (!isValidISODate(date)) {
    throw new Error('Tanggal pembayaran tidak valid.');
  }
  if (!Number.isFinite(availableBeforePayment) || availableBeforePayment < 0) {
    throw new Error('Limit sebelum pembayaran tidak valid.');
  }
  const paymentRef = doc(
    periodCollection(householdId, periodId, 'creditPayments'),
    `${source.id}_${date}`,
  );
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const limitRef = doc(
        periodCollection(householdId, periodId, 'creditLimits'),
        source.id,
      );
      const [limitSnapshot, paymentSnapshot, incomes, payments, expenses] =
        await Promise.all([
          transaction.get(limitRef),
          transaction.get(paymentRef),
          getDocsFromServer(periodCollection(householdId, periodId, 'incomes')),
          getDocsFromServer(
            periodCollection(householdId, periodId, 'creditPayments'),
          ),
          getDocsFromServer(
            periodCollection(householdId, periodId, 'expenses'),
          ),
        ]);
      if (!limitSnapshot.exists()) {
        throw new Error('Atur plafon kartu kredit terlebih dahulu.');
      }
      const limit = limitSnapshot.data() as CreditLimit;
      const previousId = previousPeriodId(periodId);
      const [previousLimits, previousPayments, previousExpenses] =
        await Promise.all([
          getDocsFromServer(
            periodCollection(householdId, previousId, 'creditLimits'),
          ),
          getDocsFromServer(
            periodCollection(householdId, previousId, 'creditPayments'),
          ),
          getDocsFromServer(
            periodCollection(householdId, previousId, 'expenses'),
          ),
        ]);
      const currentData: PeriodData = {
        incomes: mapDocs<Income>(incomes),
        budgets: [],
        expenses: mapDocs<Expense>(expenses),
        creditLimits: [{...limit, id: limitSnapshot.id}],
        creditPayments: mapDocs<CreditPayment>(payments),
      };
      const previousData: PeriodData = {
        incomes: [],
        budgets: [],
        expenses: mapDocs<Expense>(previousExpenses),
        creditLimits: mapDocs<CreditLimit>(previousLimits),
        creditPayments: mapDocs<CreditPayment>(previousPayments),
      };
      const recordedPayments = payments.docs.map(
        item => ({ id: item.id, ...item.data() } as CreditPayment),
      );
      if (
        paymentSnapshot.exists() ||
        recordedPayments.some(
          item => item.fundSourceId === source.id && item.date === date,
        )
      ) {
        throw new Error(
          'Pembayaran kartu kredit dengan tanggal yang sama sudah tercatat.',
        );
      }
      const freshAvailable = availableCreditLimitAtDate(
        currentData,
        source.id,
        previousData,
        date,
      );
      const amountBeforePayment = useManualAvailable
        ? availableBeforePayment
        : freshAvailable;
      if (amountBeforePayment > limit.amount) {
        throw new Error(
          `Limit sebelum pembayaran tidak boleh melebihi plafon ${formatRupiah(
            limit.amount,
          )}.`,
        );
      }
      const amount = limit.amount - amountBeforePayment;
      if (amount <= 0) {
        throw new Error(
          'Limit kartu sudah penuh sehingga tidak ada tagihan yang perlu dibayar.',
        );
      }
      const totalIncome = incomes.docs.reduce(
        (sum, item) => sum + Number(item.data().amount ?? 0),
        0,
      );
      const paid = uniqueCreditPayments(recordedPayments).reduce(
        (sum, item) => sum + item.amount,
        0,
      );
      if (paid + amount > totalIncome) {
        throw new Error(
          `Saldo pemasukan Debit belum cukup. Kekurangan ${formatRupiah(
            paid + amount - totalIncome,
          )}.`,
        );
      }

      const eligible = expenses.docs.filter(item => {
        const value = item.data() as Expense;
        return (
          value.fundSourceId === source.id &&
          value.fundSourceType === 'credit_card' &&
          !value.creditSettled &&
          value.date <= date
        );
      });
      transaction.set(paymentRef, {
        fundSourceId: source.id,
        fundSourceName: source.name,
        amount,
        date,
        previousLimitAvailableAmount:
          limit.availableAmount ?? limit.amount,
        previousOpeningAvailableAmount:
          limit.openingAvailableAmount ?? null,
        previousOpeningSource: limit.openingSource ?? null,
        note: `Pelunasan kartu kredit hingga limit kembali ${formatRupiah(
          limit.amount,
        )}.`,
        ...auditForCreate(householdId, periodId, uid),
      });
      transaction.update(limitRef, {
        availableAmount: limit.amount,
        openingSource: 'payment',
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      eligible.forEach(item =>
        transaction.update(item.ref, {
          creditSettled: true,
          creditSettlementId: paymentRef.id,
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        }),
      );
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'tagihan_kartu_dibayar',
        `Membayar tagihan ${source.name} ${formatRupiah(
          amount,
        )}; limit kembali ${formatRupiah(limit.amount)}`,
      );
      return amount;
    },
  );
}

export async function cancelCreditPayment(
  householdId: string,
  periodId: string,
  uid: string,
  paymentId: string,
) {
  const paymentRef = doc(
    periodCollection(householdId, periodId, 'creditPayments'),
    paymentId,
  );
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists()) {
        throw new Error('Pembayaran kartu kredit sudah tidak tersedia.');
      }
      const payment = {
        id: paymentSnapshot.id,
        ...paymentSnapshot.data(),
      } as CreditPayment;
      const limitRef = doc(
        periodCollection(householdId, periodId, 'creditLimits'),
        payment.fundSourceId,
      );
      const [limitSnapshot, paymentDocs, expenseDocs] = await Promise.all([
        transaction.get(limitRef),
        getDocsFromServer(
          periodCollection(householdId, periodId, 'creditPayments'),
        ),
        getDocsFromServer(
          periodCollection(householdId, periodId, 'expenses'),
        ),
      ]);
      if (!limitSnapshot.exists()) {
        throw new Error('Limit kartu kredit tidak ditemukan.');
      }
      const limit = {
        id: limitSnapshot.id,
        ...limitSnapshot.data(),
      } as CreditLimit;
      const payments = mapDocs<CreditPayment>(paymentDocs);
      const sourcePayments = uniqueCreditPayments(payments)
        .filter(item => item.fundSourceId === payment.fundSourceId)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (sourcePayments[sourcePayments.length - 1]?.id !== paymentId) {
        throw new Error(
          'Hanya pembayaran terbaru untuk kartu ini yang dapat dibatalkan.',
        );
      }
      const expenses = mapDocs<Expense>(expenseDocs);
      const linkedExpenses = expenses.filter(
        item => item.creditSettlementId === paymentId && item.creditSettled,
      );
      const previousId = previousPeriodId(periodId);
      const [previousLimits, previousExpenses, previousPayments] =
        await Promise.all([
          getDocsFromServer(
            periodCollection(householdId, previousId, 'creditLimits'),
          ),
          getDocsFromServer(
            periodCollection(householdId, previousId, 'expenses'),
          ),
          getDocsFromServer(
            periodCollection(householdId, previousId, 'creditPayments'),
          ),
        ]);
      const currentData: PeriodData = {
        incomes: [],
        budgets: [],
        expenses,
        creditLimits: [limit],
        creditPayments: payments,
      };
      const previousData: PeriodData = {
        incomes: [],
        budgets: [],
        expenses: mapDocs<Expense>(previousExpenses),
        creditLimits: mapDocs<CreditLimit>(previousLimits),
        creditPayments: mapDocs<CreditPayment>(previousPayments),
      };
      const currentAvailable = availableCreditLimit(
        currentData,
        payment.fundSourceId,
        previousData,
      );
      if (currentAvailable < limit.amount) {
        throw new Error(
          `Pembayaran tidak dapat dibatalkan karena limit sudah digunakan. Limit tersedia sekarang ${formatRupiah(currentAvailable)} dari ${formatRupiah(limit.amount)}.`,
        );
      }
      const priorPaymentExists = sourcePayments.some(
        item => item.id !== paymentId,
      );
      const previousAvailableAmount =
        payment.previousLimitAvailableAmount ??
        (priorPaymentExists
          ? limit.amount
          : Math.min(
              limit.amount,
              Math.max(
                0,
                limit.amount - payment.amount +
                  linkedExpenses.reduce((sum, item) => sum + item.amount, 0),
              ),
            ));
      const restoreOpeningSource =
        payment.previousOpeningSource ??
        (priorPaymentExists
          ? 'payment'
          : previousData.creditLimits.some(
              item => item.fundSourceId === payment.fundSourceId,
            )
            ? 'carry'
            : 'manual');
      const previousOpeningAmount =
        payment.previousOpeningAvailableAmount ?? previousAvailableAmount;
      transaction.update(limitRef, {
        availableAmount: previousAvailableAmount,
        openingAvailableAmount: previousOpeningAmount,
        openingSource: restoreOpeningSource,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      linkedExpenses.forEach(item =>
        transaction.update(
          doc(
            periodCollection(householdId, periodId, 'expenses'),
            item.id,
          ),
          {
            creditSettled: false,
            creditSettlementId: deleteField(),
            updatedBy: uid,
            updatedAt: serverTimestamp(),
          },
        ),
      );
      transaction.delete(paymentRef);
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'tagihan_kartu_dibatalkan',
        `Membatalkan pencatatan pembayaran ${payment.fundSourceName} ${formatRupiah(payment.amount)} tanggal ${payment.date}. Debit dan limit dikembalikan untuk koreksi pencatatan.`,
      );
      return {
        paymentAmount: payment.amount,
        unlinkedExpenses: linkedExpenses.length,
      };
    },
  );
}

function assertCreditExpenseNotAfterPayment(
  payments: CreditPayment[],
  fundSourceId: string,
  expenseDate: string,
) {
  const payment = uniqueCreditPayments(payments)
    .filter(item => item.fundSourceId === fundSourceId && expenseDate <= item.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (payment) {
    throw new Error(
      `Transaksi kartu kredit bertanggal ${expenseDate} terkunci karena pembayaran kartu tanggal ${payment.date} masih tercatat. Untuk mengoreksi transaksi yang terlupa, batalkan pembayaran yang masih tercatat terlebih dahulu, lalu catat atau ubah transaksi dan lakukan pembayaran kembali.`,
    );
  }
}

export async function moveUnexpectedExpenseToCredit(
  householdId: string,
  periodId: string,
  uid: string,
  expenseId: string,
  creditSourceId: string,
) {
  const expenseRef = doc(
    periodCollection(householdId, periodId, 'expenses'),
    expenseId,
  );
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const [expenseSnapshot, sourceSnapshot] = await Promise.all([
        transaction.get(expenseRef),
        transaction.get(
          doc(householdCollection(householdId, 'fundSources'), creditSourceId),
        ),
      ]);
      if (!expenseSnapshot.exists()) {
        throw new Error('Pengeluaran sudah tidak tersedia.');
      }
      const expense = {
        id: expenseSnapshot.id,
        ...expenseSnapshot.data(),
      } as Expense;
      const source = sourceSnapshot.exists()
        ? ({ id: sourceSnapshot.id, ...sourceSnapshot.data() } as FundSource)
        : null;
      if (
        !isUnexpectedBudget(expense.budgetId) ||
        expense.fundSourceType === 'credit_card'
      ) {
        throw new Error(
          'Hanya Belanja Tak Terduga dari Debit yang dapat dipindahkan.',
        );
      }
      if (!source?.active || source.type !== 'credit_card') {
        throw new Error('Kartu kredit tidak tersedia.');
      }
      const paymentDocs = await getDocsFromServer(
        periodCollection(householdId, periodId, 'creditPayments'),
      );
      assertCreditExpenseNotAfterPayment(
        mapDocs<CreditPayment>(paymentDocs),
        source.id,
        expense.date,
      );
      const oldBudgetRef = budgetRef(householdId, periodId, expense.budgetId);
      const newBudgetRef = budgetRef(
        householdId,
        periodId,
        unexpectedBudgetId(source),
      );
      const [oldSnapshot, newSnapshot] = await Promise.all([
        transaction.get(oldBudgetRef),
        transaction.get(newBudgetRef),
      ]);
      if (!oldSnapshot.exists()) {
        throw new Error('Budget asal tidak ditemukan.');
      }
      const oldBudget = oldSnapshot.data() as Budget;
      const oldRealized = Math.max(
        0,
        oldBudget.realizedAmount - expense.amount,
      );
      const newBudget = newSnapshot.exists()
        ? (newSnapshot.data() as Budget)
        : null;
      const newRealized = (newBudget?.realizedAmount ?? 0) + expense.amount;
      transaction.update(oldBudgetRef, {
        amount: oldRealized,
        realizedAmount: oldRealized,
        directUnexpected: true,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      transaction.set(
        newBudgetRef,
        {
          name: UNEXPECTED_NAME,
          categoryId: UNEXPECTED_CATEGORY_ID,
          categoryName: UNEXPECTED_NAME,
          fundSourceId: source.id,
          fundSourceName: source.name,
          fundSourceType: 'credit_card',
          amount: newRealized,
          realizedAmount: newRealized,
          realizationType: 'transaction',
          cashAllocated: false,
          directUnexpected: true,
          ...(newBudget
            ? { updatedBy: uid, updatedAt: serverTimestamp() }
            : {
                ...auditForCreate(householdId, periodId, uid),
                initialExpenseId: expense.id,
                note: 'Belanja langsung dari limit kartu kredit.',
              }),
        },
        { merge: true },
      );
      transaction.update(expenseRef, {
        budgetId: newBudgetRef.id,
        budgetName: UNEXPECTED_NAME,
        fundSourceId: source.id,
        fundSourceName: source.name,
        fundSourceType: 'credit_card',
        creditSettled: false,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'sumber_btt_dipindahkan',
        `Memindahkan ${UNEXPECTED_NAME} ${formatRupiah(
          expense.amount,
        )} dari Debit ke ${source.name}`,
      );
    },
  );
}

export async function saveBudget(
  householdId: string,
  periodId: string,
  uid: string,
  input: Pick<
    Budget,
    | 'name'
    | 'categoryId'
    | 'categoryName'
    | 'fundSourceId'
    | 'fundSourceName'
    | 'fundSourceType'
    | 'amount'
    | 'realizationType'
    | 'note'
  >,
  existing?: Budget,
) {
  if (existing && isUnexpectedBudget(existing.id)) {
    throw new Error(
      'Belanja Tak Terduga mengikuti transaksi Pengeluaran secara otomatis.',
    );
  }
  if (
    input.realizationType === 'savings_allocation' &&
    input.fundSourceType !== 'debit'
  ) {
    throw new Error(
      'Alokasi Tabungan hanya dapat menggunakan sumber dana Debit / Rekening.',
    );
  }
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      if (existing) {
        const current = await transaction.get(
          budgetRef(householdId, periodId, existing.id),
        );
        if (!current.exists()) {
          throw new Error('Budget sudah dihapus.');
        }
        existing = { id: current.id, ...current.data() } as Budget;
      }
      let debtSnapshot: any = null;
      if (existing?.debtId && existing?.debtInstallmentIndex) {
        debtSnapshot = await transaction.get(
          doc(householdCollection(householdId, 'debts'), existing.debtId),
        );
      }
      if (input.fundSourceType === 'credit_card') {
        const [limitSnapshot, budgetsSnapshot] = await Promise.all([
          transaction.get(
            doc(
              periodCollection(householdId, periodId, 'creditLimits'),
              input.fundSourceId,
            ),
          ),
          getDocsFromServer(periodCollection(householdId, periodId, 'budgets')),
        ]);
        if (!limitSnapshot.exists()) {
          throw new Error(
            'Atur limit tersedia kartu kredit untuk periode ini terlebih dahulu.',
          );
        }
        const limit = (limitSnapshot.data() as CreditLimit).amount;
        const otherAllocated = budgetsSnapshot.docs
          .filter(item => item.id !== existing?.id)
          .map(item =>
            normalizeUnexpectedBudget({
              id: item.id,
              ...item.data(),
            } as Budget),
          )
          .filter(item => item.fundSourceId === input.fundSourceId)
          .reduce((sum, item) => sum + item.amount, 0);
        if (otherAllocated + input.amount > limit) {
          throw new Error(
            `Budget kartu kredit melebihi sisa limit sebesar ${formatRupiah(
              otherAllocated + input.amount - limit,
            )}.`,
          );
        }
      }
      if (existing) {
        if (input.amount < existing.realizedAmount) {
          throw new Error(
            'Nominal budget tidak boleh lebih kecil dari realisasi yang sudah tercatat.',
          );
        }
        if (
          existing.realizedAmount > 0 &&
          input.realizationType !== existing.realizationType
        ) {
          throw new Error(
            'Jenis realisasi tidak dapat diubah setelah budget direalisasikan.',
          );
        }
        transaction.update(budgetRef(householdId, periodId, existing.id), {
          ...input,
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        });
        if (debtSnapshot && debtSnapshot.exists()) {
          const debtData = debtSnapshot.data() as Debt;
          const instIdx = (existing.debtInstallmentIndex ?? 1) - 1;
          if (debtData.installments && debtData.installments[instIdx]) {
            debtData.installments[instIdx].amount = input.amount;
            const nextTotal = debtData.installments.reduce(
              (sum, item) => sum + item.amount,
              0,
            );
            transaction.update(debtSnapshot.ref, {
              installments: debtData.installments,
              totalAmount: nextTotal,
              updatedBy: uid,
              updatedAt: serverTimestamp(),
            });
          }
        }
        logTransaction(
          transaction,
          householdId,
          periodId,
          uid,
          'budget_diubah',
          `Mengubah budget ${input.name} menjadi ${formatRupiah(input.amount)}`,
        );
        return existing.id;
      }
      if (input.realizationType === 'savings_allocation') {
        const budgetsSnapshot = await getDocsFromServer(
          periodCollection(householdId, periodId, 'budgets'),
        );
        const savings = budgetsSnapshot.docs
          .map(item => ({ id: item.id, ...item.data() } as Budget))
          .find(item => !item.mergedInto && isSavingsBudget(item));
        if (savings) {
          const target = budgetRef(householdId, periodId, savings.id);
          const currentSnapshot = await transaction.get(target);
          if (!currentSnapshot.exists()) {
            throw new Error('Data Tabungan berubah. Silakan coba kembali.');
          }
          const current = currentSnapshot.data() as Budget;
          const nextAmount = current.amount + input.amount;
          transaction.update(target, {
            realizationType: 'savings_allocation',
            amount: nextAmount,
            realizedAmount: current.cashAllocated
              ? current.realizedAmount + input.amount
              : current.realizedAmount,
            updatedBy: uid,
            updatedAt: serverTimestamp(),
          });
          logTransaction(
            transaction,
            householdId,
            periodId,
            uid,
            'tabungan_ditambah',
            `Menambah Tabungan ${formatRupiah(
              input.amount,
            )} menjadi ${formatRupiah(nextAmount)}`,
          );
          return savings.id;
        }
      }
      const ref = doc(periodCollection(householdId, periodId, 'budgets'));
      transaction.set(ref, {
        ...input,
        realizedAmount: 0,
        cashAllocated: false,
        ...auditForCreate(householdId, periodId, uid),
      });
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'budget_ditambah',
        `Menambah budget ${input.name} ${formatRupiah(input.amount)}`,
      );
      return ref.id;
    },
  );
}

export async function addUnexpectedExpense(
  householdId: string,
  periodId: string,
  uid: string,
  sourceId: string,
  input: Pick<Expense, 'amount' | 'date' | 'note'>,
) {
  if (!input.note.trim()) {
    throw new Error('Isi catatan belanja untuk evaluasi akhir bulan.');
  }
  if (!isValidISODate(input.date)) {
    throw new Error('Tanggal tidak valid.');
  }
  const expenseRef = doc(periodCollection(householdId, periodId, 'expenses'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const master = await transaction.get(
      doc(householdCollection(householdId, 'fundSources'), sourceId),
    );
    const source = master.exists()
      ? ({ id: master.id, ...master.data() } as FundSource)
      : null;
    if (
      !source?.active ||
      (source.type !== 'debit' && source.type !== 'credit_card')
    ) {
      throw new Error(
        'Sumber dana tidak tersedia. Pilih Debit atau Kartu Kredit aktif.',
      );
    }
    if (source.type === 'credit_card') {
      const paymentDocs = await getDocsFromServer(
        periodCollection(householdId, periodId, 'creditPayments'),
      );
      assertCreditExpenseNotAfterPayment(
        mapDocs<CreditPayment>(paymentDocs),
        source.id,
        input.date,
      );
    }
    const target = budgetRef(householdId, periodId, unexpectedBudgetId(source));
    const current = await transaction.get(target);
    const existing = current.exists() ? (current.data() as Budget) : null;
    if (
      existing &&
      (existing.realizationType !== 'transaction' ||
        fundSourceTypeForBudget(existing, [source]) !== source.type)
    ) {
      throw new Error(
        'Sumber atau jenis Belanja Tak Terduga lama tidak sesuai. Periksa data sebelum melanjutkan.',
      );
    }
    const validation = validateExpense(input.amount, Number.POSITIVE_INFINITY);
    if (validation) {
      throw new Error(validation);
    }
    const realized = (existing?.realizedAmount ?? 0) + input.amount;
    const identity = {
      name: UNEXPECTED_NAME,
      categoryId: UNEXPECTED_CATEGORY_ID,
      categoryName: UNEXPECTED_NAME,
      fundSourceId: existing?.fundSourceId ?? source.id,
      fundSourceName: existing?.fundSourceName ?? source.name,
      fundSourceType: source.type,
    };
    transaction.set(
      target,
      {
        ...identity,
        amount: realized,
        realizedAmount: realized,
        realizationType: 'transaction',
        cashAllocated: false,
        directUnexpected: true,
        ...(existing
          ? { updatedBy: uid, updatedAt: serverTimestamp() }
          : {
              ...auditForCreate(householdId, periodId, uid),
              initialExpenseId: expenseRef.id,
              note: 'Belanja langsung dari dana yang belum dialokasikan.',
            }),
      },
      { merge: true },
    );
    transaction.set(expenseRef, {
      ...input,
      ...auditForCreate(householdId, periodId, uid),
      budgetId: target.id,
      budgetName: UNEXPECTED_NAME,
      categoryId: UNEXPECTED_CATEGORY_ID,
      categoryName: UNEXPECTED_NAME,
      fundSourceId: identity.fundSourceId,
      fundSourceName: identity.fundSourceName,
      fundSourceType: source.type,
    });
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'pengeluaran_ditambah',
      `Belanja Tak Terduga ${source.name} ${formatRupiah(
        input.amount,
      )}: ${input.note.trim()}`,
    );
  });
  return expenseRef.id;
}

export async function releaseBudgetRemainder(
  householdId: string,
  periodId: string,
  uid: string,
  sourceId: string,
  expectedRemaining: number,
) {
  const sourceRef = budgetRef(householdId, periodId, sourceId);
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const sourceSnapshot = await transaction.get(sourceRef);
      if (!sourceSnapshot.exists()) {
        throw new Error('Budget asal tidak ditemukan.');
      }
      const source = sourceSnapshot.data() as Budget;
      const master = await transaction.get(
        doc(
          householdCollection(householdId, 'fundSources'),
          source.fundSourceId,
        ),
      );
      const sources = master.exists()
        ? [{ ...master.data(), id: master.id } as FundSource]
        : [];
      const sourceType = fundSourceTypeForBudget(source, sources);
      if (sourceType !== 'debit' && sourceType !== 'credit_card') {
        throw new Error(
          'Sisa hanya dapat dikembalikan ke saldo Debit atau limit Kartu Kredit.',
        );
      }
      const remaining = source.amount - source.realizedAmount;
      if (remaining <= 0 || remaining !== expectedRemaining) {
        throw new Error(
          'Sisa budget telah berubah. Periksa nominal terbaru lalu coba lagi.',
        );
      }
      const audit = { updatedBy: uid, updatedAt: serverTimestamp() };
      transaction.update(sourceRef, {
        amount: source.realizedAmount,
        ...(source.realizationType === 'cash_allocation'
          ? { cashAllocated: true }
          : {}),
        note: `${source.note || ''}\nSisa ${formatRupiah(
          remaining,
        )} dikembalikan ke ${
          sourceType === 'credit_card' ? 'limit Kartu Kredit' : 'saldo Debit'
        }.`.trim(),
        ...audit,
      });
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'sisa_budget_dikembalikan',
        `Mengembalikan sisa ${source.name} ${formatRupiah(remaining)} ke ${
          sourceType === 'credit_card' ? 'limit kredit' : 'saldo Debit'
        }`,
      );
      return remaining;
    },
  );
}

export async function moveBudgetRemainderToSavings(
  householdId: string,
  periodId: string,
  uid: string,
  sourceId: string,
  expectedRemaining: number,
) {
  const sourceRef = budgetRef(householdId, periodId, sourceId);
  return withPeriodTransaction(
    householdId,
    periodId,
    uid,
    async transaction => {
      const sourceSnapshot = await transaction.get(sourceRef);
      if (!sourceSnapshot.exists()) {
        throw new Error('Budget asal tidak ditemukan.');
      }
      const source = {
        id: sourceSnapshot.id,
        ...sourceSnapshot.data(),
      } as Budget;
      if (isSavingsBudget(source)) {
        throw new Error('Item asal sudah merupakan Tabungan.');
      }
      const master = await transaction.get(
        doc(
          householdCollection(householdId, 'fundSources'),
          source.fundSourceId,
        ),
      );
      const fundSource = master.exists()
        ? ({ id: master.id, ...master.data() } as FundSource)
        : null;
      if (!fundSource || fundSource.type !== 'debit') {
        throw new Error(
          'Hanya sisa budget dari Debit / Rekening yang dapat dipindahkan ke Tabungan.',
        );
      }
      const remaining = source.amount - source.realizedAmount;
      if (remaining <= 0 || remaining !== expectedRemaining) {
        throw new Error(
          'Sisa budget telah berubah. Periksa nominal terbaru lalu coba lagi.',
        );
      }
      const budgetsSnapshot = await getDocsFromServer(
        periodCollection(householdId, periodId, 'budgets'),
      );
      const existingSavings = budgetsSnapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as Budget))
        .find(
          item =>
            item.id !== sourceId && !item.mergedInto && isSavingsBudget(item),
        );
      const savingsRef = existingSavings
        ? budgetRef(householdId, periodId, existingSavings.id)
        : doc(periodCollection(householdId, periodId, 'budgets'));
      const savingsSnapshot = existingSavings
        ? await transaction.get(savingsRef)
        : null;
      if (existingSavings && !savingsSnapshot?.exists()) {
        throw new Error('Data Tabungan berubah. Silakan coba kembali.');
      }
      const savings = savingsSnapshot?.data() as Budget | undefined;
      const audit = { updatedBy: uid, updatedAt: serverTimestamp() };
      transaction.update(sourceRef, {
        amount: source.realizedAmount,
        ...(source.realizationType === 'cash_allocation'
          ? { cashAllocated: true }
          : {}),
        note: `${source.note || ''}\nSisa ${formatRupiah(
          remaining,
        )} dipindahkan ke Tabungan.`.trim(),
        ...audit,
      });
      if (savings) {
        transaction.update(savingsRef, {
          realizationType: 'savings_allocation',
          amount: savings.amount + remaining,
          realizedAmount: savings.realizedAmount + remaining,
          cashAllocated: true,
          ...audit,
        });
      } else {
        transaction.set(savingsRef, {
          name: 'Tabungan',
          categoryId: 'tabungan',
          categoryName: 'Tabungan',
          fundSourceId: source.fundSourceId,
          fundSourceName: source.fundSourceName,
          fundSourceType: 'debit',
          amount: remaining,
          realizedAmount: remaining,
          realizationType: 'savings_allocation',
          cashAllocated: true,
          note: 'Akumulasi dana yang dialokasikan ke Tabungan.',
          ...auditForCreate(householdId, periodId, uid),
        });
      }
      logTransaction(
        transaction,
        householdId,
        periodId,
        uid,
        'sisa_budget_ditabung',
        `Memindahkan sisa ${source.name} ${formatRupiah(
          remaining,
        )} ke Tabungan`,
      );
      return remaining;
    },
  );
}

export async function deleteBudget(
  householdId: string,
  periodId: string,
  budget: Budget,
) {
  if (isUnexpectedBudget(budget.id)) {
    throw new Error('Hapus transaksi terkait dari halaman Pengeluaran.');
  }
  const uid = auth().currentUser!.uid;
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const ref = budgetRef(householdId, periodId, budget.id);
    const current = await transaction.get(ref);
    if (!current.exists() || current.data()!.realizedAmount > 0) {
      throw new Error('Budget tidak tersedia atau sudah memiliki realisasi.');
    }
    transaction.delete(ref);
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'budget_dihapus',
      `Menghapus budget ${current.data()!.name} ${formatRupiah(
        current.data()!.amount,
      )}`,
    );
  });
}

export async function addExpense(
  householdId: string,
  periodId: string,
  uid: string,
  budgetId: string,
  input: Pick<Expense, 'amount' | 'date' | 'note'>,
) {
  if (!isValidISODate(input.date)) {
    throw new Error('Tanggal pengeluaran tidak valid.');
  }
  if (isUnexpectedBudget(budgetId)) {
    throw new Error('Pilih Belanja Tak Terduga langsung dari sumber dana.');
  }
  const targetBudget = budgetRef(householdId, periodId, budgetId);
  const expenseRef = doc(periodCollection(householdId, periodId, 'expenses'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const snapshot = await transaction.get(targetBudget);
    if (!snapshot.exists()) {
      throw new Error('Item budget tidak ditemukan.');
    }
    const budget = { id: snapshot.id, ...snapshot.data() } as Budget;
    if (isSavingsBudget(budget)) {
      throw new Error(
        'Alokasi Tabungan tidak dicatat sebagai pengeluaran. Tandai alokasinya dari halaman Budgeting.',
      );
    }
    let sourceType = budget.fundSourceType;
    if (!sourceType && budget.fundSourceId) {
      const sourceSnapshot = await transaction.get(
        doc(
          householdCollection(householdId, 'fundSources'),
          budget.fundSourceId,
        ),
      );
      sourceType = sourceSnapshot.exists()
        ? (sourceSnapshot.data() as FundSource).type
        : undefined;
    }
    if (sourceType === 'credit_card') {
      const paymentDocs = await getDocsFromServer(
        periodCollection(householdId, periodId, 'creditPayments'),
      );
      assertCreditExpenseNotAfterPayment(
        mapDocs<CreditPayment>(paymentDocs),
        budget.fundSourceId,
        input.date,
      );
    }
    if (budget.realizationType !== 'transaction') {
      throw new Error('Alokasi cash direalisasikan dari halaman Budgeting.');
    }
    let debtSnapshot: any = null;
    if (budget.debtId && budget.debtInstallmentIndex) {
      debtSnapshot = await transaction.get(
        doc(householdCollection(householdId, 'debts'), budget.debtId),
      );
    }
    const remaining = budget.amount - budget.realizedAmount;
    const validation = validateExpense(input.amount, remaining);
    if (validation) {
      throw new Error(validation);
    }
    transaction.set(expenseRef, {
      ...input,
      budgetId: budget.id,
      budgetName: budget.name,
      categoryId: budget.categoryId,
      categoryName: budget.categoryName,
      fundSourceId: budget.fundSourceId,
      fundSourceName: budget.fundSourceName,
      ...(budget.fundSourceType
        ? { fundSourceType: budget.fundSourceType }
        : {}),
      ...auditForCreate(householdId, periodId, uid),
    });
    const nextRealized = budget.realizedAmount + input.amount;
    transaction.update(targetBudget, {
      realizedAmount: nextRealized,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    if (debtSnapshot && debtSnapshot.exists()) {
      const debtData = debtSnapshot.data() as Debt;
      const instIndex = (budget.debtInstallmentIndex ?? 1) - 1;
      if (debtData.installments && debtData.installments[instIndex]) {
        const isPaid = nextRealized >= budget.amount;
        debtData.installments[instIndex].status = isPaid ? 'paid' : 'unpaid';
        const allPaid = debtData.installments
          .slice(0, debtData.effectiveTenor)
          .every(item => item.status === 'paid');
        transaction.update(debtSnapshot.ref, {
          installments: debtData.installments,
          status: allPaid ? 'paid' : 'active',
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        });
      }
    }
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'pengeluaran_ditambah',
      `Merealisasikan ${budget.name} ${formatRupiah(input.amount)}`,
    );
  });
  return expenseRef.id;
}

export async function deleteExpense(
  householdId: string,
  periodId: string,
  uid: string,
  expense: Expense,
) {
  const targetBudget = budgetRef(householdId, periodId, expense.budgetId);
  const targetExpense = doc(
    periodCollection(householdId, periodId, 'expenses'),
    expense.id,
  );
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const [budgetSnapshot, expenseSnapshot] = await Promise.all([
      transaction.get(targetBudget),
      transaction.get(targetExpense),
    ]);
    if (!budgetSnapshot.exists() || !expenseSnapshot.exists()) {
      throw new Error('Budget atau pengeluaran sudah tidak tersedia.');
    }
    const budget = budgetSnapshot.data() as Budget;
    const storedExpense = expenseSnapshot.data() as Expense;
    let debtSnapshot: any = null;
    if (budget.debtId && budget.debtInstallmentIndex) {
      debtSnapshot = await transaction.get(
        doc(householdCollection(householdId, 'debts'), budget.debtId),
      );
    }
    const sourceType = storedExpense.fundSourceType ?? budget.fundSourceType;
    if (sourceType === 'credit_card') {
      const paymentDocs = await getDocsFromServer(
        periodCollection(householdId, periodId, 'creditPayments'),
      );
      assertCreditExpenseNotAfterPayment(
        mapDocs<CreditPayment>(paymentDocs),
        storedExpense.fundSourceId,
        storedExpense.date,
      );
    }
    const realized = Math.max(0, budget.realizedAmount - storedExpense.amount);
    transaction.delete(targetExpense);
    transaction.update(targetBudget, {
      realizedAmount: realized,
      ...(isUnexpectedBudget(expense.budgetId)
        ? { amount: realized, directUnexpected: true }
        : {}),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    if (debtSnapshot && debtSnapshot.exists()) {
      const debtData = debtSnapshot.data() as Debt;
      const instIndex = (budget.debtInstallmentIndex ?? 1) - 1;
      if (debtData.installments && debtData.installments[instIndex]) {
        const isPaid = realized >= budget.amount;
        debtData.installments[instIndex].status = isPaid ? 'paid' : 'unpaid';
        const allPaid = debtData.installments
          .slice(0, debtData.effectiveTenor)
          .every(item => item.status === 'paid');
        transaction.update(debtSnapshot.ref, {
          installments: debtData.installments,
          status: allPaid ? 'paid' : 'active',
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        });
      }
    }
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'pengeluaran_dihapus',
      `Menghapus pengeluaran ${storedExpense.budgetName} ${formatRupiah(
        storedExpense.amount,
      )}`,
    );
  });
}

export async function updateExpense(
  householdId: string,
  periodId: string,
  uid: string,
  expenseId: string,
  input: Pick<Expense, 'amount' | 'date' | 'note'>,
) {
  if (!isValidISODate(input.date)) {
    throw new Error('Tanggal pengeluaran tidak valid.');
  }
  const targetExpense = doc(
    periodCollection(householdId, periodId, 'expenses'),
    expenseId,
  );
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const expenseSnapshot = await transaction.get(targetExpense);
    if (!expenseSnapshot.exists()) {
      throw new Error('Pengeluaran sudah tidak tersedia.');
    }
    const storedExpense = {
      id: expenseSnapshot.id,
      ...expenseSnapshot.data(),
    } as Expense;
    if (isUnexpectedBudget(storedExpense.budgetId) && !input.note.trim()) {
      throw new Error('Catatan Belanja Tak Terduga wajib diisi.');
    }
    const targetBudget = budgetRef(
      householdId,
      periodId,
      storedExpense.budgetId,
    );
    const budgetSnapshot = await transaction.get(targetBudget);
    if (!budgetSnapshot.exists()) {
      throw new Error('Budget pengeluaran tidak ditemukan.');
    }
    const budget = {
      id: budgetSnapshot.id,
      ...budgetSnapshot.data(),
    } as Budget;
    let debtSnapshot: any = null;
    if (budget.debtId && budget.debtInstallmentIndex) {
      debtSnapshot = await transaction.get(
        doc(householdCollection(householdId, 'debts'), budget.debtId),
      );
    }
    let sourceType = storedExpense.fundSourceType ?? budget.fundSourceType;
    if (!sourceType && storedExpense.fundSourceId) {
      const sourceSnapshot = await transaction.get(
        doc(
          householdCollection(householdId, 'fundSources'),
          storedExpense.fundSourceId,
        ),
      );
      sourceType = sourceSnapshot.exists()
        ? (sourceSnapshot.data() as FundSource).type
        : undefined;
    }
    if (sourceType === 'credit_card') {
      const paymentDocs = await getDocsFromServer(
        periodCollection(householdId, periodId, 'creditPayments'),
      );
      assertCreditExpenseNotAfterPayment(
        mapDocs<CreditPayment>(paymentDocs),
        storedExpense.fundSourceId,
        input.date,
      );
    }
    const realizedWithoutThisExpense = Math.max(
      0,
      budget.realizedAmount - storedExpense.amount,
    );
    const validation = validateExpense(
      input.amount,
      isUnexpectedBudget(storedExpense.budgetId)
        ? Number.POSITIVE_INFINITY
        : budget.amount - realizedWithoutThisExpense,
    );
    if (validation) {
      throw new Error(validation);
    }
    const nextRealized = realizedWithoutThisExpense + input.amount;
    transaction.update(targetExpense, {
      amount: input.amount,
      date: input.date,
      note: input.note.trim(),
      ...(sourceType === 'credit_card'
        ? {creditSettled: false, creditSettlementId: deleteField()}
        : {}),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    transaction.update(targetBudget, {
      realizedAmount: nextRealized,
      ...(isUnexpectedBudget(storedExpense.budgetId)
        ? { amount: nextRealized, directUnexpected: true }
        : {}),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    if (debtSnapshot && debtSnapshot.exists()) {
      const debtData = debtSnapshot.data() as Debt;
      const instIndex = (budget.debtInstallmentIndex ?? 1) - 1;
      if (debtData.installments && debtData.installments[instIndex]) {
        const isPaid = nextRealized >= budget.amount;
        debtData.installments[instIndex].status = isPaid ? 'paid' : 'unpaid';
        const allPaid = debtData.installments
          .slice(0, debtData.effectiveTenor)
          .every(item => item.status === 'paid');
        transaction.update(debtSnapshot.ref, {
          installments: debtData.installments,
          status: allPaid ? 'paid' : 'active',
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        });
      }
    }
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      'pengeluaran_diubah',
      `Mengubah pengeluaran ${storedExpense.budgetName} menjadi ${formatRupiah(
        input.amount,
      )}`,
    );
  });
}

export async function setCashAllocation(
  householdId: string,
  periodId: string,
  uid: string,
  budgetId: string,
  allocated: boolean,
) {
  const target = budgetRef(householdId, periodId, budgetId);
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const snapshot = await transaction.get(target);
    if (!snapshot.exists()) {
      throw new Error('Item budget tidak ditemukan.');
    }
    const budget = snapshot.data() as Budget;
    if (
      budget.realizationType !== 'cash_allocation' &&
      budget.realizationType !== 'savings_allocation' &&
      !isSavingsBudget(budget)
    ) {
      throw new Error('Item ini bukan alokasi cash atau Tabungan.');
    }
    transaction.update(target, {
      cashAllocated: allocated,
      realizedAmount: allocated ? budget.amount : 0,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    const savings = isSavingsBudget(budget);
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      allocated
        ? savings
          ? 'tabungan_dialokasikan'
          : 'cash_diserahkan'
        : savings
        ? 'tabungan_dibatalkan'
        : 'cash_dibatalkan',
      `${
        allocated ? (savings ? 'Mengalokasikan' : 'Menyerahkan') : 'Membatalkan'
      } ${savings ? 'Tabungan' : 'alokasi cash'} ${budget.name} ${formatRupiah(
        budget.amount,
      )}`,
    );
  });
}

export async function setCashAllocationAmount(
  householdId: string,
  periodId: string,
  uid: string,
  budgetId: string,
  realizedAmount: number,
) {
  const target = budgetRef(householdId, periodId, budgetId);
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const snapshot = await transaction.get(target);
    if (!snapshot.exists()) {
      throw new Error('Item budget tidak ditemukan.');
    }
    const budget = snapshot.data() as Budget;
    if (budget.realizationType !== 'cash_allocation') {
      throw new Error('Item ini bukan alokasi cash.');
    }
    if (
      !Number.isFinite(realizedAmount) ||
      realizedAmount < 0 ||
      realizedAmount > budget.amount
    ) {
      throw new Error(
        `Total yang diserahkan harus antara Rp0 dan ${formatRupiah(
          budget.amount,
        )}.`,
      );
    }

    const fullyAllocated = realizedAmount === budget.amount;
    transaction.update(target, {
      cashAllocated: fullyAllocated,
      realizedAmount,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    const action =
      realizedAmount === 0
        ? 'cash_dibatalkan'
        : fullyAllocated
        ? 'cash_diserahkan'
        : 'cash_diserahkan_sebagian';
    logTransaction(
      transaction,
      householdId,
      periodId,
      uid,
      action,
      realizedAmount === 0
        ? `Membatalkan penyerahan alokasi cash ${budget.name}`
        : `Memperbarui penyerahan alokasi cash ${
            budget.name
          } menjadi ${formatRupiah(realizedAmount)} dari ${formatRupiah(
            budget.amount,
          )}`,
    );
  });
}

type MasterKind = 'incomeCategories' | 'budgetCategories' | 'fundSources';

export async function saveMaster(
  householdId: string,
  periodId: string,
  uid: string,
  kind: MasterKind,
  data: { name: string; type?: FundSourceType; monthlyLimit?: number | null },
  id?: string,
) {
  const ref = id
    ? doc(householdCollection(householdId, kind), id)
    : doc(householdCollection(householdId, kind));
  const payload = {
    ...data,
    active: true,
    ...(id
      ? { updatedBy: uid, updatedAt: serverTimestamp() }
      : auditForCreate(householdId, undefined, uid)),
  };
  const batch = writeBatch(firestore());
  batch.set(ref, payload, { merge: true });
  const entry = activity(
    householdId,
    periodId,
    uid,
    id ? 'master_diubah' : 'master_ditambah',
    `${id ? 'Mengubah' : 'Menambah'} ${
      kind === 'incomeCategories'
        ? 'kategori pemasukan'
        : kind === 'budgetCategories'
        ? 'kategori budget'
        : 'sumber dana'
    } ${data.name}`,
  );
  batch.set(entry.ref, entry.value);
  await batch.commit();
  return ref.id;
}

export async function archiveMaster(
  householdId: string,
  periodId: string,
  uid: string,
  kind: MasterKind,
  id: string,
) {
  const ref = doc(householdCollection(householdId, kind), id);
  const current = await getDoc(ref);
  if (!current.exists()) {
    throw new Error('Data master tidak ditemukan.');
  }
  const batch = writeBatch(firestore());
  batch.update(ref, {
    active: false,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  const entry = activity(
    householdId,
    periodId,
    uid,
    'master_dihapus',
    `Menghapus ${
      kind === 'incomeCategories'
        ? 'kategori pemasukan'
        : kind === 'budgetCategories'
        ? 'kategori budget'
        : 'sumber dana'
    } ${current.data()?.name ?? id}`,
  );
  batch.set(entry.ref, entry.value);
  await batch.commit();
}

export async function copyBudgetsFromPreviousPeriod(
  householdId: string,
  sourcePeriodId: string,
  targetPeriodId: string,
  uid: string,
) {
  const source = await getDocs(
    periodCollection(householdId, sourcePeriodId, 'budgets'),
  );
  if (source.empty) {
    throw new Error('Periode sebelumnya belum memiliki budgeting.');
  }
  const target = await getDocs(
    periodCollection(householdId, targetPeriodId, 'budgets'),
  );
  if (!target.empty) {
    throw new Error(
      'Salin hanya dapat dilakukan saat periode tujuan belum memiliki budget.',
    );
  }
  const batch = writeBatch(firestore());
  const copyableBudgets = source.docs.filter(
    item =>
      !isUnexpectedBudget(item.id) &&
      item.data().amount > 0 &&
      !item.data().debtId,
  );
  copyableBudgets.forEach(item => {
    const old = item.data() as Budget;
    const ref = doc(periodCollection(householdId, targetPeriodId, 'budgets'));
    batch.set(ref, {
      name: old.name,
      categoryId: old.categoryId,
      categoryName: old.categoryName,
      fundSourceId: old.fundSourceId,
      fundSourceName: old.fundSourceName,
      ...(old.fundSourceType ? { fundSourceType: old.fundSourceType } : {}),
      amount: old.amount,
      realizedAmount: 0,
      realizationType: old.realizationType as RealizationType,
      cashAllocated: false,
      note: old.note,
      ...auditForCreate(householdId, targetPeriodId, uid),
    });
  });
  batch.update(
    doc(firestore(), 'households', householdId, 'periods', targetPeriodId),
    { updatedBy: uid, updatedAt: serverTimestamp() },
  );
  const entry = activity(
    householdId,
    targetPeriodId,
    uid,
    'budget_disalin',
    `Menyalin ${copyableBudgets.length} budget dari ${periodLabel(
      sourcePeriodId,
    )}`,
  );
  batch.set(entry.ref, entry.value);
  await batch.commit();
  return copyableBudgets.length;
}

export async function ensureSystemIncomeCategory(
  householdId: string,
  uid: string,
  name: 'Hutang' | 'Piutang',
): Promise<IncomeCategory> {
  const snapshot = await getDocs(
    householdCollection(householdId, 'incomeCategories'),
  );
  const found = snapshot.docs.find(
    item => item.data().name?.trim().toLowerCase() === name.toLowerCase(),
  );
  if (found) {
    return { id: found.id, ...found.data() } as IncomeCategory;
  }
  const categoryId = slug(name);
  const ref = doc(householdCollection(householdId, 'incomeCategories'), categoryId);
  const data = {
    householdId,
    name,
    active: true,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(firestore());
  batch.set(ref, data);
  await batch.commit();
  return { id: categoryId, ...data } as unknown as IncomeCategory;
}

export async function ensureRoutineBillCategory(
  householdId: string,
  uid: string,
): Promise<BudgetCategory> {
  const snapshot = await getDocs(
    householdCollection(householdId, 'budgetCategories'),
  );
  const found = snapshot.docs.find(
    item => item.data().name?.trim().toLowerCase() === 'tagihan rutin',
  );
  if (found) {
    return { id: found.id, ...found.data() } as BudgetCategory;
  }
  const categoryId = 'tagihan-rutin';
  const ref = doc(householdCollection(householdId, 'budgetCategories'), categoryId);
  const data = {
    householdId,
    name: 'Tagihan Rutin',
    active: true,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(firestore());
  batch.set(ref, data);
  await batch.commit();
  return { id: categoryId, ...data } as unknown as BudgetCategory;
}

export async function ensurePeriodDoc(
  householdId: string,
  periodId: string,
  uid: string,
  batch?: ReturnType<typeof writeBatch>,
) {
  const periodRef = doc(firestore(), 'households', householdId, 'periods', periodId);
  const snapshot = await getDoc(periodRef);
  if (!snapshot.exists()) {
    const { year, month } = periodParts(periodId);
    const data = {
      householdId,
      year,
      month,
      label: periodLabel(periodId),
      status: 'active' as const,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    };
    if (batch) {
      batch.set(periodRef, data);
    } else {
      const b = writeBatch(firestore());
      b.set(periodRef, data);
      await b.commit();
    }
  }
}

export function subscribeDebts(
  householdId: string,
  next: (items: Debt[]) => void,
  error: (message: string) => void,
): Unsubscribe {
  return onSnapshot(
    householdCollection(householdId, 'debts'),
    snapshot => next(mapDocs<Debt>(snapshot)),
    cause => error(cause.message),
  );
}

export function subscribeReceivables(
  householdId: string,
  next: (items: Receivable[]) => void,
  error: (message: string) => void,
): Unsubscribe {
  return onSnapshot(
    householdCollection(householdId, 'receivables'),
    snapshot => next(mapDocs<Receivable>(snapshot)),
    cause => error(cause.message),
  );
}

export async function createDebt(
  householdId: string,
  uid: string,
  payload: {
    name: string;
    debtType: DebtType;
    originType: DebtOriginType;
    fundSourceId: string;
    fundSourceName: string;
    fundSourceType: FundSourceType;
    totalAmount: number;
    tenor: number;
    startPeriodId: string;
    installments: DebtInstallment[];
    note: string;
  },
): Promise<string> {
  const routineCat = await ensureRoutineBillCategory(householdId, uid);
  let hutangCat: IncomeCategory | null = null;
  if (payload.originType === 'cash_loan') {
    hutangCat = await ensureSystemIncomeCategory(householdId, uid, 'Hutang');
  }
  const debtRef = doc(householdCollection(householdId, 'debts'));
  const debtId = debtRef.id;

  const allPeriodIds = Array.from(
    new Set([
      payload.startPeriodId,
      ...payload.installments.map(item => item.periodId),
    ]),
  );
  for (const pId of allPeriodIds) {
    await ensurePeriodDoc(householdId, pId, uid);
  }

  const batch = writeBatch(firestore());
  let linkedIncomeId: string | undefined;

  if (payload.originType === 'cash_loan' && hutangCat) {
    const incomeRef = doc(
      periodCollection(householdId, payload.startPeriodId, 'incomes'),
    );
    linkedIncomeId = incomeRef.id;
    batch.set(incomeRef, {
      categoryId: hutangCat.id,
      categoryName: hutangCat.name,
      amount: payload.totalAmount,
      date: todayISO(),
      note: `Pencairan ${payload.name}`,
      ...auditForCreate(householdId, payload.startPeriodId, uid),
    });
  }

  const finalInstallments: DebtInstallment[] = payload.installments.map(inst => {
    const budgetId = inst.budgetId || `debt-${debtId}-${inst.index}`;
    const budgetName = formatDebtBudgetName(
      payload.name,
      payload.debtType,
      inst.index,
      payload.tenor,
    );
    const budgetDocRef = doc(
      periodCollection(householdId, inst.periodId, 'budgets'),
      budgetId,
    );
    batch.set(budgetDocRef, {
      name: budgetName,
      categoryId: routineCat.id,
      categoryName: routineCat.name,
      fundSourceId: payload.fundSourceId,
      fundSourceName: payload.fundSourceName,
      fundSourceType: payload.fundSourceType,
      amount: inst.amount,
      realizedAmount: 0,
      realizationType: 'transaction' as RealizationType,
      cashAllocated: false,
      note: payload.note || '',
      debtId,
      debtInstallmentIndex: inst.index,
      debtTotalInstallments: payload.tenor,
      ...auditForCreate(householdId, inst.periodId, uid),
    });

    return {
      index: inst.index,
      periodId: inst.periodId,
      amount: inst.amount,
      budgetId,
      status: 'unpaid' as const,
    };
  });

  batch.set(debtRef, {
    name: payload.name.trim(),
    debtType: payload.debtType,
    originType: payload.originType,
    fundSourceId: payload.fundSourceId,
    fundSourceName: payload.fundSourceName,
    fundSourceType: payload.fundSourceType,
    totalAmount: payload.totalAmount,
    tenor: payload.tenor,
    effectiveTenor: payload.tenor,
    startPeriodId: payload.startPeriodId,
    installments: finalInstallments,
    ...(linkedIncomeId ? { linkedIncomeId } : {}),
    note: payload.note?.trim() || '',
    status: 'active' as const,
    ...auditForCreate(householdId, payload.startPeriodId, uid),
  });

  const entry = activity(
    householdId,
    payload.startPeriodId,
    uid,
    'hutang_ditambah',
    `Menambahkan hutang ${payload.name} sebesar ${formatRupiah(payload.totalAmount)}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
  return debtId;
}

export async function updateDebt(
  householdId: string,
  uid: string,
  debtId: string,
  payload: {
    name: string;
    debtType: DebtType;
    originType: DebtOriginType;
    fundSourceId: string;
    fundSourceName: string;
    fundSourceType: FundSourceType;
    totalAmount: number;
    tenor: number;
    startPeriodId: string;
    installments: DebtInstallment[];
    note: string;
  },
): Promise<void> {
  const debtRef = doc(householdCollection(householdId, 'debts'), debtId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) {
    throw new Error('Data hutang tidak ditemukan.');
  }
  const existingDebt = { id: debtSnap.id, ...debtSnap.data() } as Debt;

  const budgetSnaps = await Promise.all(
    existingDebt.installments.map(inst =>
      getDoc(
        doc(
          periodCollection(householdId, inst.periodId, 'budgets'),
          inst.budgetId,
        ),
      ),
    ),
  );
  const relatedBudgets = budgetSnaps
    .filter(s => s.exists())
    .map(s => ({ id: s.id, ...s.data() } as Budget));

  if (!canEditOrDeleteDebt(existingDebt, relatedBudgets)) {
    throw new Error(
      'Hutang tidak dapat diubah karena sudah ada cicilan yang terealisasi. Hapus transaksi terkait di Pengeluaran terlebih dahulu.',
    );
  }

  const routineCat = await ensureRoutineBillCategory(householdId, uid);

  const allPeriodIds = Array.from(
    new Set([
      payload.startPeriodId,
      ...payload.installments.map(item => item.periodId),
    ]),
  );
  for (const pId of allPeriodIds) {
    await ensurePeriodDoc(householdId, pId, uid);
  }

  const batch = writeBatch(firestore());

  budgetSnaps.forEach(s => {
    if (s.exists()) {
      batch.delete(s.ref);
    }
  });

  let linkedIncomeId: string | undefined = existingDebt.linkedIncomeId;
  if (
    existingDebt.linkedIncomeId &&
    (payload.originType === 'purchase' ||
      existingDebt.startPeriodId !== payload.startPeriodId)
  ) {
    const oldIncomeRef = doc(
      periodCollection(householdId, existingDebt.startPeriodId, 'incomes'),
      existingDebt.linkedIncomeId,
    );
    batch.delete(oldIncomeRef);
    linkedIncomeId = undefined;
  }

  if (payload.originType === 'cash_loan') {
    const hutangCat = await ensureSystemIncomeCategory(householdId, uid, 'Hutang');
    if (linkedIncomeId && existingDebt.startPeriodId === payload.startPeriodId) {
      const incomeRef = doc(
        periodCollection(householdId, payload.startPeriodId, 'incomes'),
        linkedIncomeId,
      );
      batch.update(incomeRef, {
        amount: payload.totalAmount,
        note: `Pencairan ${payload.name}`,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      const newIncomeRef = doc(
        periodCollection(householdId, payload.startPeriodId, 'incomes'),
      );
      linkedIncomeId = newIncomeRef.id;
      batch.set(newIncomeRef, {
        categoryId: hutangCat.id,
        categoryName: hutangCat.name,
        amount: payload.totalAmount,
        date: todayISO(),
        note: `Pencairan ${payload.name}`,
        ...auditForCreate(householdId, payload.startPeriodId, uid),
      });
    }
  }

  const finalInstallments: DebtInstallment[] = payload.installments.map(inst => {
    const budgetId = inst.budgetId || `debt-${debtId}-${inst.index}`;
    const budgetName = formatDebtBudgetName(
      payload.name,
      payload.debtType,
      inst.index,
      payload.tenor,
    );
    const budgetDocRef = doc(
      periodCollection(householdId, inst.periodId, 'budgets'),
      budgetId,
    );
    batch.set(budgetDocRef, {
      name: budgetName,
      categoryId: routineCat.id,
      categoryName: routineCat.name,
      fundSourceId: payload.fundSourceId,
      fundSourceName: payload.fundSourceName,
      fundSourceType: payload.fundSourceType,
      amount: inst.amount,
      realizedAmount: 0,
      realizationType: 'transaction' as RealizationType,
      cashAllocated: false,
      note: payload.note || '',
      debtId,
      debtInstallmentIndex: inst.index,
      debtTotalInstallments: payload.tenor,
      ...auditForCreate(householdId, inst.periodId, uid),
    });

    return {
      index: inst.index,
      periodId: inst.periodId,
      amount: inst.amount,
      budgetId,
      status: 'unpaid' as const,
    };
  });

  batch.update(debtRef, {
    name: payload.name.trim(),
    debtType: payload.debtType,
    originType: payload.originType,
    fundSourceId: payload.fundSourceId,
    fundSourceName: payload.fundSourceName,
    fundSourceType: payload.fundSourceType,
    totalAmount: payload.totalAmount,
    tenor: payload.tenor,
    effectiveTenor: payload.tenor,
    startPeriodId: payload.startPeriodId,
    installments: finalInstallments,
    linkedIncomeId: linkedIncomeId ?? deleteField(),
    note: payload.note?.trim() || '',
    status: 'active' as const,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });

  const entry = activity(
    householdId,
    payload.startPeriodId,
    uid,
    'hutang_diubah',
    `Mengubah data hutang ${payload.name}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
}

export async function deleteDebt(
  householdId: string,
  uid: string,
  debt: Debt,
): Promise<void> {
  const budgetSnaps = await Promise.all(
    debt.installments.map(inst =>
      getDoc(
        doc(
          periodCollection(householdId, inst.periodId, 'budgets'),
          inst.budgetId,
        ),
      ),
    ),
  );
  const relatedBudgets = budgetSnaps
    .filter(s => s.exists())
    .map(s => ({ id: s.id, ...s.data() } as Budget));

  if (!canEditOrDeleteDebt(debt, relatedBudgets)) {
    throw new Error(
      'Hutang tidak dapat dihapus karena sudah ada cicilan yang terealisasi. Hapus transaksi terkait di Pengeluaran terlebih dahulu.',
    );
  }

  const batch = writeBatch(firestore());

  budgetSnaps.forEach(s => {
    if (s.exists()) {
      batch.delete(s.ref);
    }
  });

  if (debt.linkedIncomeId) {
    const incomeRef = doc(
      periodCollection(householdId, debt.startPeriodId, 'incomes'),
      debt.linkedIncomeId,
    );
    batch.delete(incomeRef);
  }

  const debtRef = doc(householdCollection(householdId, 'debts'), debt.id);
  batch.delete(debtRef);

  const entry = activity(
    householdId,
    debt.startPeriodId,
    uid,
    'hutang_dihapus',
    `Menghapus hutang ${debt.name} sebesar ${formatRupiah(debt.totalAmount)}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
}

export async function updateDebtInstallmentAmount(
  householdId: string,
  uid: string,
  debtId: string,
  installmentIndex: number,
  newAmount: number,
): Promise<void> {
  if (!Number.isInteger(newAmount) || newAmount <= 0) {
    throw new Error('Nominal termin harus berupa bilangan bulat positif.');
  }

  const debtRef = doc(householdCollection(householdId, 'debts'), debtId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) {
    throw new Error('Data hutang tidak ditemukan.');
  }
  const debt = { id: debtSnap.id, ...debtSnap.data() } as Debt;
  const instIndex = installmentIndex - 1;
  const targetInstallment = debt.installments[instIndex];
  if (!targetInstallment) {
    throw new Error('Termin tidak ditemukan.');
  }

  const budgetDocRef = doc(
    periodCollection(householdId, targetInstallment.periodId, 'budgets'),
    targetInstallment.budgetId,
  );
  const budgetSnap = await getDoc(budgetDocRef);

  if (
    targetInstallment.status === 'paid' ||
    (budgetSnap.exists() && (budgetSnap.data() as Budget)?.realizedAmount > 0)
  ) {
    throw new Error('Termin yang sudah terealisasi tidak dapat diubah nominalnya.');
  }

  debt.installments[instIndex].amount = newAmount;
  const newTotalAmount = debt.installments.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const batch = writeBatch(firestore());
  batch.update(debtRef, {
    installments: debt.installments,
    totalAmount: newTotalAmount,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });

  if (budgetSnap.exists()) {
    batch.update(budgetDocRef, {
      amount: newAmount,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  }

  const entry = activity(
    householdId,
    targetInstallment.periodId,
    uid,
    'termin_diubah',
    `Mengubah nominal termin ${installmentIndex} pada hutang ${debt.name} menjadi ${formatRupiah(newAmount)}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
}

export async function accelerateDebtPayoff(
  householdId: string,
  uid: string,
  debtId: string,
  targetIndex: number,
): Promise<void> {
  const debtRef = doc(householdCollection(householdId, 'debts'), debtId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) {
    throw new Error('Data hutang tidak ditemukan.');
  }
  const debt = { id: debtSnap.id, ...debtSnap.data() } as Debt;

  const result = calculateAcceleratedPayoff(debt, targetIndex);

  const targetBudgetRef = doc(
    periodCollection(householdId, result.targetInstallment.periodId, 'budgets'),
    result.targetInstallment.budgetId,
  );

  const batch = writeBatch(firestore());

  batch.update(debtRef, {
    effectiveTenor: result.effectiveTenor,
    installments: result.installments,
    totalAmount: result.totalAmount,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });

  const newBudgetName = formatDebtBudgetName(
    debt.name,
    debt.debtType,
    targetIndex,
    targetIndex,
  );

  batch.update(targetBudgetRef, {
    amount: result.targetInstallment.amount,
    debtTotalInstallments: targetIndex,
    name: newBudgetName,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });

  result.removedInstallments.forEach(inst => {
    const bRef = doc(
      periodCollection(householdId, inst.periodId, 'budgets'),
      inst.budgetId,
    );
    batch.delete(bRef);
  });

  const entry = activity(
    householdId,
    result.targetInstallment.periodId,
    uid,
    'hutang_dipercepat',
    `Mempercepat pelunasan ${debt.name} pada termin ke-${targetIndex}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
}

export async function createReceivable(
  householdId: string,
  uid: string,
  payload: {
    debtorName: string;
    amount: number;
    date: string;
    dueDate?: string;
    note: string;
  },
): Promise<string> {
  if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
    throw new Error('Nominal piutang harus berupa bilangan bulat positif.');
  }
  if (!isValidISODate(payload.date)) {
    throw new Error('Tanggal piutang tidak valid.');
  }
  if (payload.dueDate && !isValidISODate(payload.dueDate)) {
    throw new Error('Tanggal jatuh tempo tidak valid.');
  }

  const periodId = payload.date.slice(0, 7);
  await ensurePeriodDoc(householdId, periodId, uid);

  const recRef = doc(householdCollection(householdId, 'receivables'));
  const batch = writeBatch(firestore());

  batch.set(recRef, {
    debtorName: payload.debtorName.trim(),
    amount: payload.amount,
    paidAmount: 0,
    date: payload.date,
    periodId,
    ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
    note: payload.note?.trim() || '',
    status: 'unpaid' as ReceivableStatus,
    payments: [],
    ...auditForCreate(householdId, periodId, uid),
  });

  const entry = activity(
    householdId,
    periodId,
    uid,
    'piutang_ditambah',
    `Mencatat piutang kepada ${payload.debtorName} sebesar ${formatRupiah(payload.amount)}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
  return recRef.id;
}

export async function recordReceivablePayment(
  householdId: string,
  uid: string,
  receivableId: string,
  payAmount: number,
  paymentDate: string,
): Promise<void> {
  if (!Number.isInteger(payAmount) || payAmount <= 0) {
    throw new Error('Nominal pembayaran harus berupa bilangan bulat positif.');
  }
  if (!isValidISODate(paymentDate)) {
    throw new Error('Tanggal pembayaran tidak valid.');
  }

  const paymentPeriodId = paymentDate.slice(0, 7);
  await ensurePeriodDoc(householdId, paymentPeriodId, uid);

  const piutangCat = await ensureSystemIncomeCategory(householdId, uid, 'Piutang');
  const recRef = doc(householdCollection(householdId, 'receivables'), receivableId);

  await runTransaction(firestore(), async transaction => {
    const recSnap = await transaction.get(recRef);
    if (!recSnap.exists()) {
      throw new Error('Data piutang tidak ditemukan.');
    }
    const rec = recSnap.data() as Receivable;
    const remaining = rec.amount - rec.paidAmount;
    if (payAmount > remaining) {
      throw new Error(
        `Nominal pembayaran melebihi sisa piutang sebesar ${formatRupiah(
          payAmount - remaining,
        )}.`,
      );
    }

    const incomeRef = doc(
      periodCollection(householdId, paymentPeriodId, 'incomes'),
    );

    transaction.set(incomeRef, {
      categoryId: piutangCat.id,
      categoryName: piutangCat.name,
      amount: payAmount,
      date: paymentDate,
      note: `Pembayaran piutang dari ${rec.debtorName}`,
      ...auditForCreate(householdId, paymentPeriodId, uid),
    });

    const nextPaidAmount = rec.paidAmount + payAmount;
    const nextStatus: ReceivableStatus =
      nextPaidAmount >= rec.amount ? 'paid' : 'partial';

    const paymentItem: ReceivablePayment = {
      id: incomeRef.id,
      amount: payAmount,
      date: paymentDate,
      periodId: paymentPeriodId,
      linkedIncomeId: incomeRef.id,
    };

    transaction.update(recRef, {
      paidAmount: nextPaidAmount,
      status: nextStatus,
      payments: [...(rec.payments || []), paymentItem],
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });

    logTransaction(
      transaction,
      householdId,
      paymentPeriodId,
      uid,
      'piutang_dibayar',
      `Menerima pembayaran piutang dari ${rec.debtorName} sebesar ${formatRupiah(
        payAmount,
      )}`,
    );
  });
}

export async function deleteReceivable(
  householdId: string,
  uid: string,
  receivable: Receivable,
): Promise<void> {
  if (
    receivable.paidAmount > 0 ||
    (receivable.payments && receivable.payments.length > 0)
  ) {
    throw new Error('Piutang yang sudah menerima pembayaran tidak dapat dihapus.');
  }

  const recRef = doc(
    householdCollection(householdId, 'receivables'),
    receivable.id,
  );
  const batch = writeBatch(firestore());
  batch.delete(recRef);

  const entry = activity(
    householdId,
    receivable.periodId,
    uid,
    'piutang_dihapus',
    `Menghapus piutang kepada ${receivable.debtorName} sebesar ${formatRupiah(
      receivable.amount,
    )}`,
  );
  batch.set(entry.ref, entry.value);

  await batch.commit();
}
