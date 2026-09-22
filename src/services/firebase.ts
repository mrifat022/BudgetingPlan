import {getApp, getApps} from '@react-native-firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@react-native-firebase/auth';
import {
  collection,
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
  Expense,
  FundSource,
  FundSourceType,
  Income,
  IncomeCategory,
  HouseholdMember,
  Period,
  PeriodData,
  RealizationType,
  UserProfile,
} from '../models';
import {isValidISODate, periodIdFromDate, periodLabel, periodParts} from '../utils/period';
import {formatRupiah} from '../utils/currency';
import {fundSourceTypeForBudget, validateExpense} from '../domain/budgeting';

const LOGIN_DOMAIN = 'budgeting-plan.local';
import {displayUnexpected, isUnexpectedBudget, unexpectedBudgetId, unexpectedAvailable, normalizeUnexpectedBudget, UNEXPECTED_NAME, UNEXPECTED_CATEGORY_ID} from '../domain/unexpected';


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

function mapDocs<T extends {id: string}>(snapshot: QuerySnapshot<DocumentData, DocumentData>): T[] {
  return snapshot.docs.map(item => ({id: item.id, ...item.data()} as T));
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
  return signInWithEmailAndPassword(auth(), emailFromUsername(username), password);
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
  const profile = {id: snapshot.id, ...snapshot.data()} as UserProfile;
  if (!profile.active || !profile.householdId) {
    throw new Error('Akun ini tidak aktif atau belum memiliki household.');
  }
  return profile;
}

export async function ensureCurrentPeriod(householdId: string, uid: string) {
  const id = periodIdFromDate();
  const {year, month} = periodParts(id);
  const db = firestore();
  const periodsRef = householdCollection(householdId, 'periods');
  const currentRef = doc(db, 'households', householdId, 'periods', id);
  const [current, periods] = await Promise.all([getDoc(currentRef), getDocs(periodsRef)]);
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
  periods.docs.forEach(item => {
    if (item.id !== id && item.data().status === 'active') {
      batch.update(item.ref, {status: 'archived', updatedBy: uid, updatedAt: serverTimestamp()});
    }
  });
  await batch.commit();
  await ensureDefaultMasters(householdId, uid);
  return id;
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
  'Belanja Tak Terduga',
  'Lain-lain',
];
const DEFAULT_FUND_SOURCES: Array<{name: string; type: FundSourceType}> = [
  {name: 'Debit', type: 'debit'},
  {name: 'Kartu Kredit', type: 'credit_card'},
  {name: 'Cash', type: 'cash'},
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
      batch.set(doc(db, 'households', householdId, 'incomeCategories', slug(name)), {...audit, name});
    });
  }
  if (budgetSnapshot.empty) {
    DEFAULT_BUDGET_CATEGORIES.forEach(name => {
      batch.set(doc(db, 'households', householdId, 'budgetCategories', name === 'Belanja Tak Terduga' ? 'dana-darurat' : slug(name)), {...audit, name});
    });
  } else if (!budgetSnapshot.docs.some(item => item.id === 'dana-darurat')) {
    batch.set(
      doc(db, 'households', householdId, 'budgetCategories', 'dana-darurat'),
      {...audit, name: 'Belanja Tak Terduga'},
    );
  }
  if (sourceSnapshot.empty) {
    DEFAULT_FUND_SOURCES.forEach(item => {
      batch.set(doc(db, 'households', householdId, 'fundSources', slug(item.name)), {...audit, ...item, monthlyLimit: null});
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
    snapshot => next(mapDocs<Period>(snapshot).sort((a, b) => b.id.localeCompare(a.id))),
    cause => error(cause.message),
  );
}

function subscribeItems<T extends {id: string}>(
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
  return subscribeItems(householdCollection(householdId, 'incomeCategories'), next, error);
}

export function subscribeBudgetCategories(
  householdId: string,
  next: (items: BudgetCategory[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems<BudgetCategory>(householdCollection(householdId, 'budgetCategories'), items => next(items.map(item => item.id === 'dana-darurat' ? {...item, name: 'Belanja Tak Terduga'} : item)), error);
}

export function subscribeFundSources(
  householdId: string,
  next: (items: FundSource[]) => void,
  error: (message: string) => void,
) {
  return subscribeItems(householdCollection(householdId, 'fundSources'), next, error);
}

export function subscribeActivities(householdId: string, periodId: string, next: (items: ActivityLog[]) => void, error: (message: string) => void) {
  return onSnapshot(
    query(householdCollection(householdId, 'activities'), where('periodId', '==', periodId)),
    snapshot => next(mapDocs<ActivityLog>(snapshot)
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
      .slice(0, 30)),
    cause => error(cause.message),
  );
}

export function subscribeMembers(householdId: string, next: (items: HouseholdMember[]) => void, error: (message: string) => void) {
  return subscribeItems<HouseholdMember>(householdCollection(householdId, 'members'), next, error);
}

export function subscribePeriodData(
  householdId: string,
  periodId: string,
  next: (data: PeriodData) => void,
  error: (message: string) => void,
  uid?: string,
) {
  const state: PeriodData = {incomes: [], budgets: [], expenses: [], creditLimits: []};
  const emit = () => next({...state});
  const unsubs = [
    subscribeItems<Income>(periodCollection(householdId, periodId, 'incomes'), items => {
      state.incomes = items.sort((a, b) => b.date.localeCompare(a.date));
      emit();
    }, error),
    subscribeItems<Budget>(periodCollection(householdId, periodId, 'budgets'), items => {
      state.budgets = items.map(displayUnexpected).map(normalizeUnexpectedBudget).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
      if (uid) {
        items.filter(item => isUnexpectedBudget(item.id) && item.amount !== item.realizedAmount).forEach(item => {
          withPeriodTransaction(householdId, periodId, uid, async transaction => {
            const ref = budgetRef(householdId, periodId, item.id);
            const current = await transaction.get(ref);
            if (current.exists() && current.data()!.amount !== current.data()!.realizedAmount) {
              transaction.update(ref, {amount: current.data()!.realizedAmount, directUnexpected: true, updatedBy: uid, updatedAt: serverTimestamp()});
            }
          }).catch(cause => error(`Penyesuaian Belanja Tak Terduga gagal: ${cause.message}`));
        });
      }
      emit();
    }, error),
    subscribeItems<Expense>(periodCollection(householdId, periodId, 'expenses'), items => {
      state.expenses = items.map(displayUnexpected).sort((a, b) => b.date.localeCompare(a.date));
      emit();
    }, error),
    subscribeItems<CreditLimit>(periodCollection(householdId, periodId, 'creditLimits'), items => {
      state.creditLimits = items.sort((a, b) => a.fundSourceName.localeCompare(b.fundSourceName));
      emit();
    }, error),
  ];
  return () => unsubs.forEach(unsubscribe => unsubscribe());
}

function auditForCreate(householdId: string, periodId: string | undefined, uid: string) {
  return {
    householdId,
    ...(periodId ? {periodId} : {}),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

function activity(householdId: string, periodId: string, uid: string, action: string, description: string) {
  return {
    ref: doc(householdCollection(householdId, 'activities')),
    value: {householdId, periodId, createdBy: uid, createdAt: serverTimestamp(), action, description},
  };
}

function logTransaction(transaction: Transaction, householdId: string, periodId: string, uid: string, action: string, description: string) {
  const entry = activity(householdId, periodId, uid, action, description);
  transaction.set(entry.ref, entry.value);
}

// Period writes share a revision document so concurrent balance reads retry,
// including when another device inserts or deletes a budget/income.
function withPeriodTransaction<T>(householdId: string, periodId: string, uid: string, action: (transaction: Transaction) => Promise<T>) {
  const ref = doc(firestore(), 'households', householdId, 'periods', periodId);
  return runTransaction(firestore(), async transaction => {
    const period = await transaction.get(ref);
    if (!period.exists()) { throw new Error('Periode belum tersedia. Buka ulang aplikasi.'); }
    const result = await action(transaction);
    transaction.update(ref, {updatedBy: uid, updatedAt: serverTimestamp()});
    return result;
  });
}

export async function saveIncome(
  householdId: string,
  periodId: string,
  uid: string,
  input: Pick<Income, 'categoryId' | 'categoryName' | 'amount' | 'date' | 'note'>,
  id?: string,
) {
  const ref = id ? doc(periodCollection(householdId, periodId, 'incomes'), id) : doc(periodCollection(householdId, periodId, 'incomes'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    if (id) { transaction.update(ref, {...input, updatedBy: uid, updatedAt: serverTimestamp()}); }
    else { transaction.set(ref, {...input, ...auditForCreate(householdId, periodId, uid)}); }
    logTransaction(transaction, householdId, periodId, uid, id ? 'pemasukan_diubah' : 'pemasukan_ditambah', `${id ? 'Mengubah' : 'Menambah'} pemasukan ${input.categoryName} ${formatRupiah(input.amount)}`);
  });
  return ref.id;
}

export async function deleteIncome(householdId: string, periodId: string, id: string) {
  const uid = auth().currentUser!.uid;
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const ref = doc(periodCollection(householdId, periodId, 'incomes'), id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) { throw new Error('Pemasukan sudah dihapus.'); }
    transaction.delete(ref);
    logTransaction(transaction, householdId, periodId, uid, 'pemasukan_dihapus', `Menghapus pemasukan ${snapshot.data()!.categoryName} ${formatRupiah(snapshot.data()!.amount)}`);
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
    throw new Error('Limit periode hanya berlaku untuk sumber dana kartu kredit.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Limit tersedia harus lebih dari Rp0.');
  }
  return withPeriodTransaction(householdId, periodId, uid, async transaction => {
  const budgets = await getDocsFromServer(periodCollection(householdId, periodId, 'budgets'));
  const allocated = budgets.docs
    .map(item => normalizeUnexpectedBudget({id: item.id, ...item.data()} as Budget))
    .filter(item => item.fundSourceId === source.id)
    .reduce((sum, item) => sum + item.amount, 0);
  if (amount < allocated) {
    throw new Error(`Limit tidak boleh lebih kecil dari budget yang sudah dialokasikan (${formatRupiah(allocated)}).`);
  }
  const target = doc(periodCollection(householdId, periodId, 'creditLimits'), source.id);
  const current = await transaction.get(target);
  transaction.set(target, {
    fundSourceId: source.id,
    fundSourceName: source.name,
    amount,
    ...(current.exists()
      ? {updatedBy: uid, updatedAt: serverTimestamp()}
      : auditForCreate(householdId, periodId, uid)),
  }, {merge: true});
  logTransaction(transaction, householdId, periodId, uid, current.exists() ? 'limit_diubah' : 'limit_ditambah', `Mengatur limit ${source.name} menjadi ${formatRupiah(amount)}`);
  });
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
  if (existing && isUnexpectedBudget(existing.id)) { throw new Error('Belanja Tak Terduga mengikuti transaksi Pengeluaran secara otomatis.'); }
  return withPeriodTransaction(householdId, periodId, uid, async transaction => {
    if (existing) {
      const current = await transaction.get(budgetRef(householdId, periodId, existing.id));
      if (!current.exists()) { throw new Error('Budget sudah dihapus.'); }
      existing = {id: current.id, ...current.data()} as Budget;
    }
  if (input.fundSourceType === 'credit_card') {
    const [limitSnapshot, budgetsSnapshot] = await Promise.all([
      transaction.get(doc(periodCollection(householdId, periodId, 'creditLimits'), input.fundSourceId)),
      getDocsFromServer(periodCollection(householdId, periodId, 'budgets')),
    ]);
    if (!limitSnapshot.exists()) {
      throw new Error('Atur limit tersedia kartu kredit untuk periode ini terlebih dahulu.');
    }
    const limit = (limitSnapshot.data() as CreditLimit).amount;
    const otherAllocated = budgetsSnapshot.docs
      .filter(item => item.id !== existing?.id)
      .map(item => normalizeUnexpectedBudget({id: item.id, ...item.data()} as Budget))
      .filter(item => item.fundSourceId === input.fundSourceId)
      .reduce((sum, item) => sum + item.amount, 0);
    if (otherAllocated + input.amount > limit) {
      throw new Error(`Budget kartu kredit melebihi sisa limit sebesar ${formatRupiah(otherAllocated + input.amount - limit)}.`);
    }
  }
  if (existing) {
    if (input.amount < existing.realizedAmount) {
      throw new Error('Nominal budget tidak boleh lebih kecil dari realisasi yang sudah tercatat.');
    }
    if (existing.realizedAmount > 0 && input.realizationType !== existing.realizationType) {
      throw new Error('Jenis realisasi tidak dapat diubah setelah budget direalisasikan.');
    }
    transaction.update(budgetRef(householdId, periodId, existing.id), {
      ...input,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    logTransaction(transaction, householdId, periodId, uid, 'budget_diubah', `Mengubah budget ${input.name} menjadi ${formatRupiah(input.amount)}`);
    return existing.id;
  }
  const ref = doc(periodCollection(householdId, periodId, 'budgets'));
  transaction.set(ref, {
    ...input,
    realizedAmount: 0,
    cashAllocated: false,
    ...auditForCreate(householdId, periodId, uid),
  });
  logTransaction(transaction, householdId, periodId, uid, 'budget_ditambah', `Menambah budget ${input.name} ${formatRupiah(input.amount)}`);
  return ref.id;
  });
}

export async function addUnexpectedExpense(
  householdId: string, periodId: string, uid: string,
  sourceId: string, input: Pick<Expense, 'amount' | 'date' | 'note'>,
) {
  if (!input.note.trim()) { throw new Error('Isi catatan belanja untuk evaluasi akhir bulan.'); }
  if (!isValidISODate(input.date)) { throw new Error('Tanggal tidak valid.'); }
  const expenseRef = doc(periodCollection(householdId, periodId, 'expenses'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const master = await transaction.get(doc(householdCollection(householdId, 'fundSources'), sourceId));
    const source = master.exists() ? {id: master.id, ...master.data()} as FundSource : null;
    if (!source?.active || (source.type !== 'debit' && source.type !== 'credit_card')) {
      throw new Error('Sumber dana tidak tersedia. Pilih Debit atau Kartu Kredit aktif.');
    }
    const target = budgetRef(householdId, periodId, unexpectedBudgetId(source));
    const current = await transaction.get(target);
    const existing = current.exists() ? current.data() as Budget : null;
    if (existing && (existing.realizationType !== 'transaction' || fundSourceTypeForBudget(existing, [source]) !== source.type)) {
      throw new Error('Sumber atau jenis Belanja Tak Terduga lama tidak sesuai. Periksa data sebelum melanjutkan.');
    }
    const [incomes, budgets, limits, masters] = await Promise.all([
      getDocsFromServer(periodCollection(householdId, periodId, 'incomes')),
      getDocsFromServer(periodCollection(householdId, periodId, 'budgets')),
      getDocsFromServer(periodCollection(householdId, periodId, 'creditLimits')),
      getDocsFromServer(householdCollection(householdId, 'fundSources')),
    ]);
    const data: PeriodData = {incomes: mapDocs<Income>(incomes), budgets: mapDocs<Budget>(budgets), creditLimits: mapDocs<CreditLimit>(limits), expenses: []};
    const available = unexpectedAvailable(data, source, mapDocs<FundSource>(masters));
    const validation = validateExpense(input.amount, Math.max(0, available));
    if (validation) { throw new Error(validation.replace('sisa budget', source.type === 'debit' ? 'saldo Debit tersedia' : 'sisa limit kartu kredit')); }
    const realized = (existing?.realizedAmount ?? 0) + input.amount;
    const identity = {
      name: UNEXPECTED_NAME, categoryId: UNEXPECTED_CATEGORY_ID, categoryName: UNEXPECTED_NAME,
      fundSourceId: existing?.fundSourceId ?? source.id,
      fundSourceName: existing?.fundSourceName ?? source.name,
      fundSourceType: source.type,
    };
    transaction.set(target, {
      ...identity, amount: realized, realizedAmount: realized,
      realizationType: 'transaction', cashAllocated: false, directUnexpected: true,
      ...(existing ? {updatedBy: uid, updatedAt: serverTimestamp()} : {...auditForCreate(householdId, periodId, uid), initialExpenseId: expenseRef.id, note: 'Belanja langsung dari dana yang belum dialokasikan.'}),
    }, {merge: true});
    transaction.set(expenseRef, {
      ...input, ...auditForCreate(householdId, periodId, uid),
      budgetId: target.id, budgetName: UNEXPECTED_NAME,
      categoryId: UNEXPECTED_CATEGORY_ID, categoryName: UNEXPECTED_NAME,
      fundSourceId: identity.fundSourceId, fundSourceName: identity.fundSourceName, fundSourceType: source.type,
    });
    logTransaction(transaction, householdId, periodId, uid, 'pengeluaran_ditambah', `Belanja Tak Terduga ${source.name} ${formatRupiah(input.amount)}: ${input.note.trim()}`);
  });
  return expenseRef.id;
}

export async function releaseBudgetRemainder(
  householdId: string, periodId: string, uid: string, sourceId: string,
  expectedRemaining: number,
) {
  const sourceRef = budgetRef(householdId, periodId, sourceId);
  return withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists()) { throw new Error('Budget asal tidak ditemukan.'); }
    const source = sourceSnapshot.data() as Budget;
    const master = await transaction.get(doc(householdCollection(householdId, 'fundSources'), source.fundSourceId));
    const sources = master.exists() ? [{...master.data(), id: master.id} as FundSource] : [];
    const sourceType = fundSourceTypeForBudget(source, sources);
    if (sourceType !== 'debit' && sourceType !== 'credit_card') {
      throw new Error('Sisa hanya dapat dikembalikan ke saldo Debit atau limit Kartu Kredit.');
    }
    const remaining = source.amount - source.realizedAmount;
    if (remaining <= 0 || remaining !== expectedRemaining) {
      throw new Error('Sisa budget telah berubah. Periksa nominal terbaru lalu coba lagi.');
    }
    const audit = {updatedBy: uid, updatedAt: serverTimestamp()};
    transaction.update(sourceRef, {
      amount: source.realizedAmount,
      note: `${source.note || ''}\nSisa ${formatRupiah(remaining)} dikembalikan ke ${sourceType === 'credit_card' ? 'limit Kartu Kredit' : 'saldo Debit'}.`.trim(),
      ...audit,
    });
    logTransaction(transaction, householdId, periodId, uid, 'sisa_budget_dikembalikan', `Mengembalikan sisa ${source.name} ${formatRupiah(remaining)} ke ${sourceType === 'credit_card' ? 'limit kredit' : 'saldo Debit'}`);
    return remaining;
  });
}

export async function deleteBudget(householdId: string, periodId: string, budget: Budget) {
  if (isUnexpectedBudget(budget.id)) { throw new Error('Hapus transaksi terkait dari halaman Pengeluaran.'); }
  const uid = auth().currentUser!.uid;
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const ref = budgetRef(householdId, periodId, budget.id);
    const current = await transaction.get(ref);
    if (!current.exists() || current.data()!.realizedAmount > 0) { throw new Error('Budget tidak tersedia atau sudah memiliki realisasi.'); }
    transaction.delete(ref);
    logTransaction(transaction, householdId, periodId, uid, 'budget_dihapus', `Menghapus budget ${current.data()!.name} ${formatRupiah(current.data()!.amount)}`);
  });
}

export async function addExpense(
  householdId: string,
  periodId: string,
  uid: string,
  budgetId: string,
  input: Pick<Expense, 'amount' | 'date' | 'note'>,
) {
  if (isUnexpectedBudget(budgetId)) { throw new Error('Pilih Belanja Tak Terduga langsung dari sumber dana.'); }
  const targetBudget = budgetRef(householdId, periodId, budgetId);
  const expenseRef = doc(periodCollection(householdId, periodId, 'expenses'));
  await withPeriodTransaction(householdId, periodId, uid, async transaction => {
    const snapshot = await transaction.get(targetBudget);
    if (!snapshot.exists()) {
      throw new Error('Item budget tidak ditemukan.');
    }
    const budget = {id: snapshot.id, ...snapshot.data()} as Budget;
    if (budget.realizationType !== 'transaction') {
      throw new Error('Alokasi cash direalisasikan dari halaman Budgeting.');
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
      ...(budget.fundSourceType ? {fundSourceType: budget.fundSourceType} : {}),
      ...auditForCreate(householdId, periodId, uid),
    });
    transaction.update(targetBudget, {
      realizedAmount: budget.realizedAmount + input.amount,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    logTransaction(transaction, householdId, periodId, uid, 'pengeluaran_ditambah', `Merealisasikan ${budget.name} ${formatRupiah(input.amount)}`);
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
  const targetExpense = doc(periodCollection(householdId, periodId, 'expenses'), expense.id);
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
    const realized = Math.max(0, budget.realizedAmount - storedExpense.amount);
    transaction.delete(targetExpense);
    transaction.update(targetBudget, {
      realizedAmount: realized,
      ...(isUnexpectedBudget(expense.budgetId) ? {amount: realized, directUnexpected: true} : {}),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    logTransaction(transaction, householdId, periodId, uid, 'pengeluaran_dihapus', `Menghapus pengeluaran ${storedExpense.budgetName} ${formatRupiah(storedExpense.amount)}`);
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
    if (budget.realizationType !== 'cash_allocation') {
      throw new Error('Item ini bukan alokasi cash.');
    }
    transaction.update(target, {
      cashAllocated: allocated,
      realizedAmount: allocated ? budget.amount : 0,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    logTransaction(transaction, householdId, periodId, uid, allocated ? 'cash_diserahkan' : 'cash_dibatalkan', `${allocated ? 'Menyerahkan' : 'Membatalkan'} alokasi cash ${budget.name} ${formatRupiah(budget.amount)}`);
  });
}

type MasterKind = 'incomeCategories' | 'budgetCategories' | 'fundSources';

export async function saveMaster(
  householdId: string,
  periodId: string,
  uid: string,
  kind: MasterKind,
  data: {name: string; type?: FundSourceType; monthlyLimit?: number | null},
  id?: string,
) {
  const ref = id
    ? doc(householdCollection(householdId, kind), id)
    : doc(householdCollection(householdId, kind));
  const payload = {
    ...data,
    active: true,
    ...(id
      ? {updatedBy: uid, updatedAt: serverTimestamp()}
      : auditForCreate(householdId, undefined, uid)),
  };
  const batch = writeBatch(firestore());
  batch.set(ref, payload, {merge: true});
  const entry = activity(householdId, periodId, uid, id ? 'master_diubah' : 'master_ditambah', `${id ? 'Mengubah' : 'Menambah'} ${kind === 'incomeCategories' ? 'kategori pemasukan' : kind === 'budgetCategories' ? 'kategori budget' : 'sumber dana'} ${data.name}`);
  batch.set(entry.ref, entry.value);
  await batch.commit();
  return ref.id;
}

export async function archiveMaster(householdId: string, periodId: string, uid: string, kind: MasterKind, id: string) {
  const ref = doc(householdCollection(householdId, kind), id);
  const current = await getDoc(ref);
  if (!current.exists()) { throw new Error('Data master tidak ditemukan.'); }
  const batch = writeBatch(firestore());
  batch.update(ref, {
    active: false,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  const entry = activity(householdId, periodId, uid, 'master_dihapus', `Menghapus ${kind === 'incomeCategories' ? 'kategori pemasukan' : kind === 'budgetCategories' ? 'kategori budget' : 'sumber dana'} ${current.data()?.name ?? id}`);
  batch.set(entry.ref, entry.value);
  await batch.commit();
}

export async function copyBudgetsFromPreviousPeriod(
  householdId: string,
  sourcePeriodId: string,
  targetPeriodId: string,
  uid: string,
) {
  const source = await getDocs(periodCollection(householdId, sourcePeriodId, 'budgets'));
  if (source.empty) {
    throw new Error('Periode sebelumnya belum memiliki budgeting.');
  }
  const target = await getDocs(periodCollection(householdId, targetPeriodId, 'budgets'));
  if (!target.empty) {
    throw new Error('Salin hanya dapat dilakukan saat periode tujuan belum memiliki budget.');
  }
  const batch = writeBatch(firestore());
  const copyableBudgets = source.docs.filter(
    item => !isUnexpectedBudget(item.id) && item.data().amount > 0,
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
      ...(old.fundSourceType ? {fundSourceType: old.fundSourceType} : {}),
      amount: old.amount,
      realizedAmount: 0,
      realizationType: old.realizationType as RealizationType,
      cashAllocated: false,
      note: old.note,
      ...auditForCreate(householdId, targetPeriodId, uid),
    });
  });
  batch.update(doc(firestore(), 'households', householdId, 'periods', targetPeriodId), {updatedBy: uid, updatedAt: serverTimestamp()});
  const entry = activity(householdId, targetPeriodId, uid, 'budget_disalin', `Menyalin ${copyableBudgets.length} budget dari ${periodLabel(sourcePeriodId)}`);
  batch.set(entry.ref, entry.value);
  await batch.commit();
  return copyableBudgets.length;
}
