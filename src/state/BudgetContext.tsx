import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import type {
  BudgetCategory,
  FundSource,
  IncomeCategory,
  Period,
  PeriodData,
} from '../models';
import {useAuth} from './AuthContext';
import {
  ensureCurrentPeriod,
  subscribeBudgetCategories,
  subscribeFundSources,
  subscribeIncomeCategories,
  subscribePeriodData,
  subscribePeriods,
} from '../services/firebase';

interface BudgetState {
  householdId: string;
  uid: string;
  periods: Period[];
  activePeriodId: string;
  setActivePeriodId: (id: string) => void;
  incomeCategories: IncomeCategory[];
  budgetCategories: BudgetCategory[];
  fundSources: FundSource[];
  data: PeriodData;
  loading: boolean;
  error: string | null;
}

const BudgetContext = createContext<BudgetState | null>(null);
const EMPTY_DATA: PeriodData = {incomes: [], budgets: [], expenses: [], creditLimits: []};

export function BudgetProvider({children}: {children: React.ReactNode}) {
  const {user, profile} = useAuth();
  const householdId = profile?.householdId ?? '';
  const uid = user?.uid ?? '';
  const [periods, setPeriods] = useState<Period[]>([]);
  const [activePeriodId, setActivePeriodId] = useState('');
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([]);
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([]);
  const [fundSources, setFundSources] = useState<FundSource[]>([]);
  const [data, setData] = useState<PeriodData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId || !uid) {
      return;
    }
    setLoading(true);
    ensureCurrentPeriod(householdId, uid)
      .then(setActivePeriodId)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Periode gagal dibuat.'))
      .finally(() => setLoading(false));
  }, [householdId, uid]);

  useEffect(() => {
    if (!householdId) {
      return;
    }
    const onError = (message: string) => setError(message);
    const unsubs = [
      subscribePeriods(householdId, setPeriods, onError),
      subscribeIncomeCategories(householdId, setIncomeCategories, onError),
      subscribeBudgetCategories(householdId, setBudgetCategories, onError),
      subscribeFundSources(householdId, setFundSources, onError),
    ];
    return () => unsubs.forEach(unsubscribe => unsubscribe());
  }, [householdId]);

  useEffect(() => {
    if (!householdId || !activePeriodId) {
      setData(EMPTY_DATA);
      return;
    }
    return subscribePeriodData(householdId, activePeriodId, setData, setError, uid);
  }, [activePeriodId, householdId, uid]);

  const value = useMemo<BudgetState>(() => ({
    householdId,
    uid,
    periods,
    activePeriodId,
    setActivePeriodId,
    incomeCategories: incomeCategories.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name)),
    budgetCategories: budgetCategories.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name)),
    fundSources: fundSources.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name)),
    data,
    loading,
    error,
  }), [activePeriodId, budgetCategories, data, error, fundSources, householdId, incomeCategories, loading, periods, uid]);

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const value = useContext(BudgetContext);
  if (!value) {
    throw new Error('useBudget harus digunakan di dalam BudgetProvider.');
  }
  return value;
}
