import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, FAB} from '../../components/FinanceUI';
import {DateField, FormActions, FormModal, Label, MoneyField, SegmentedField, SelectField, TextField} from '../../components/FormUI';
import Colors from '../../constants/colors';
import {availableCreditLimit, fundSourceTypeForBudget, isSavingsBudget, isSavingsCategory, remainingForBudget, summarizePeriod, uniqueCreditPayments, validateExpense} from '../../domain/budgeting';
import type {Budget, CreditPayment, Expense} from '../../models';
import {addExpense, addUnexpectedExpense, cancelCreditPayment, deleteExpense, moveUnexpectedExpenseToCredit, updateExpense} from '../../services/firebase';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {isValidISODate, todayISO} from '../../utils/period';
import {isUnexpectedBudget, unexpectedBudgetId, unexpectedAvailable, UNEXPECTED_NAME, UNEXPECTED_CATEGORY_ID} from '../../domain/unexpected';

function isUnexpectedCategory(categoryId: string, categoryName: string) {
  return categoryId === UNEXPECTED_CATEGORY_ID || categoryName.trim().toLowerCase() === UNEXPECTED_NAME.toLowerCase();
}

export default function PengeluaranScreen() {
  const {householdId, uid, isOwner, activePeriod, activePeriodId, data, previousPeriodData, fundSources, isPeriodReadOnly} = useBudget();
  const directOptions = useMemo(() => {
    const debitBudget = data.budgets.find(item => item.id === 'dana-darurat');
    const debit = fundSources.find(item => item.type === 'debit' && item.id === debitBudget?.fundSourceId)
      ?? fundSources.find(item => item.type === 'debit' && item.name.toLowerCase() === 'debit')
      ?? fundSources.find(item => item.type === 'debit');
    return fundSources.filter(source => source.type === 'credit_card' || source.id === debit?.id).map(source => ({
      id: unexpectedBudgetId(source), source,
      available: source.type === 'credit_card'
        ? availableCreditLimit(data, source.id, previousPeriodData)
        : unexpectedAvailable(data, source, fundSources),
    }));
  }, [data, fundSources, previousPeriodData]);
  const availableBudgets = useMemo(() => data.budgets.filter(item => !isUnexpectedBudget(item.id) && !isSavingsBudget(item) && item.realizationType === 'transaction' && remainingForBudget(item) > 0), [data.budgets]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelingPaymentId, setCancelingPaymentId] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'debit' | 'credit_card'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [budgetId, setBudgetId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const selectedBudgetId = editingExpense?.budgetId ?? budgetId;
  const direct = directOptions.find(item => item.id === selectedBudgetId);
  const selected = direct ? {
    id: direct.id, name: UNEXPECTED_NAME, categoryName: UNEXPECTED_NAME,
    categoryId: UNEXPECTED_CATEGORY_ID, fundSourceName: direct.source.name,
    amount: direct.available, realizedAmount: 0,
  } : data.budgets.find(item => item.id === selectedBudgetId);
  const options = [
    ...availableBudgets.map(item => ({label: `${item.name} • ${item.fundSourceName} — sisa ${formatRupiah(remainingForBudget(item))}`, value: item.id})),
    ...directOptions.map(item => ({label: `${UNEXPECTED_NAME} • ${item.source.name} — ${item.source.type === 'credit_card' ? 'limit tersedia' : 'saldo'} ${formatRupiah(item.available)} (boleh minus)`, value: item.id})),
  ];
  const periodSummary = useMemo(() => summarizePeriod(data, fundSources, previousPeriodData), [data, fundSources, previousPeriodData]);
  const sourceSummary = useMemo(() => {
    const totals = {all: 0, debit: 0, credit_card: 0};
    data.budgets.filter(item => !isSavingsBudget(item)).forEach(item => {
      totals.all += item.realizedAmount;
      const type = fundSourceTypeForBudget(item, fundSources);
      if (type === 'debit' || type === 'credit_card') { totals[type] += item.realizedAmount; }
    });
    const unexpected = {all: 0, debit: 0, credit_card: 0};
    data.expenses.filter(item => isUnexpectedCategory(item.categoryId, item.categoryName) || isUnexpectedBudget(item.budgetId)).forEach(item => {
      unexpected.all += item.amount;
      const type = item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type;
      if (type === 'debit' || type === 'credit_card') { unexpected[type] += item.amount; }
    });
    return {totals, unexpected};
  }, [data.budgets, data.expenses, fundSources]);
  const summaryCards: Array<{label: string; amount: number; tone: 'expense' | 'unexpected' | 'balance' | 'credit'}> = sourceFilter === 'all'
    ? [
      {label: 'Total Saldo + Kapasitas Kredit', amount: periodSummary.totalIncome + periodSummary.totalCreditLimit, tone: 'balance'},
      {label: 'Total Pengeluaran', amount: sourceSummary.totals.all, tone: 'expense'},
      {label: 'Belanja Tak Terduga', amount: sourceSummary.unexpected.all, tone: 'unexpected'},
      {label: 'Total Sisa Debit + Kredit', amount: periodSummary.unallocatedDebit + periodSummary.unallocatedCredit, tone: 'balance'},
    ]
    : sourceFilter === 'debit'
      ? [
        {label: 'Total Saldo Debit', amount: periodSummary.totalIncome, tone: 'balance'},
        {label: 'Total Pengeluaran Debit', amount: sourceSummary.totals.debit, tone: 'expense'},
        {label: 'Tak Terduga Debit', amount: sourceSummary.unexpected.debit, tone: 'unexpected'},
        {label: 'Sisa Saldo Debit', amount: periodSummary.unallocatedDebit, tone: 'balance'},
      ]
      : [
        {label: 'Kapasitas Kredit', amount: periodSummary.totalCreditLimit, tone: 'credit'},
        {label: 'Total Pengeluaran Kredit', amount: sourceSummary.totals.credit_card, tone: 'expense'},
        {label: 'Tak Terduga Kredit', amount: sourceSummary.unexpected.credit_card, tone: 'unexpected'},
        {label: 'Sisa Kapasitas Kredit', amount: periodSummary.totalCreditLimit - sourceSummary.totals.credit_card, tone: 'credit'},
      ];
  const visibleExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.expenses.filter(item => {
      const sourceType = item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type;
      const matchesSource = sourceFilter === 'all' || sourceType === sourceFilter;
      const matchesSearch = !query || [item.budgetName, item.categoryName, item.fundSourceName, item.note, item.date]
        .some(value => value?.toLowerCase().includes(query));
      return matchesSource && matchesSearch;
    });
  }, [data.expenses, fundSources, search, sourceFilter]);
  const visibleCashAllocations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.budgets.filter(item => {
      const sourceType = item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type;
      const matchesSource = sourceFilter === 'all' || sourceType === sourceFilter;
      const matchesSearch = !query || [item.name, item.categoryName, item.fundSourceName, item.note]
        .some(value => value?.toLowerCase().includes(query));
      return matchesSource && matchesSearch;
    });
  }, [data.budgets, fundSources, search, sourceFilter]);
  const visibleCreditPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return uniqueCreditPayments(data.creditPayments).filter(item => {
      // Pelunasan kartu adalah arus keluar Debit, bukan pengeluaran Kartu Kredit.
      const matchesSource = sourceFilter !== 'credit_card';
      const matchesSearch = !query || [
        'Tagihan Rutin',
        'Pembayaran kartu kredit',
        item.fundSourceName,
        item.note,
        item.date,
      ].some(value => value?.toLowerCase().includes(query));
      return matchesSource && matchesSearch;
    });
  }, [data.creditPayments, search, sourceFilter]);
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, {name: string; expenses: Expense[]; cashAllocations: Budget[]; total: number}>();
    const groupFor = (id: string, name: string) => {
      if (!groups.has(id)) { groups.set(id, {name, expenses: [], cashAllocations: [], total: 0}); }
      return groups.get(id)!;
    };
    visibleExpenses.filter(item => !isSavingsCategory(item) && !isUnexpectedCategory(item.categoryId, item.categoryName) && !isUnexpectedBudget(item.budgetId)).forEach(item => {
      const group = groupFor(item.categoryId, item.categoryName);
      group.expenses.push(item);
      group.total += item.amount;
    });
    visibleCashAllocations.filter(item => !isSavingsBudget(item) && item.realizationType === 'cash_allocation' && item.realizedAmount > 0 && !isUnexpectedCategory(item.categoryId, item.categoryName)).forEach(item => {
      const group = groupFor(item.categoryId, item.categoryName);
      group.cashAllocations.push(item);
      group.total += item.realizedAmount;
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [visibleCashAllocations, visibleExpenses]);
  const unexpectedGroups = useMemo(() => {
    const groups = new Map<string, {name: string; expenses: Expense[]; cashAllocations: Budget[]; total: number}>();
    visibleExpenses.filter(item => isUnexpectedCategory(item.categoryId, item.categoryName) || isUnexpectedBudget(item.budgetId)).forEach(item => {
      const group = groups.get(item.fundSourceId) ?? {name: item.fundSourceName, expenses: [], cashAllocations: [], total: 0};
      group.expenses.push(item);
      group.total += item.amount;
      groups.set(item.fundSourceId, group);
    });
    visibleCashAllocations.filter(item => !isSavingsBudget(item) && item.realizationType === 'cash_allocation' && item.realizedAmount > 0 && isUnexpectedCategory(item.categoryId, item.categoryName)).forEach(item => {
      const group = groups.get(item.fundSourceId) ?? {name: item.fundSourceName, expenses: [], cashAllocations: [], total: 0};
      group.cashAllocations.push(item);
      group.total += item.realizedAmount;
      groups.set(item.fundSourceId, group);
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [visibleCashAllocations, visibleExpenses]);
  const toggleGroup = (id: string) => setExpandedGroups(current => {
    const next = new Set(current);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    return next;
  });

  const expenseCard = (item: Expense) => (
    <Pressable key={item.id} style={styles.card} onPress={() => showExpenseActions(item)}>
      <View style={styles.body}><Text style={styles.name}>{item.budgetName}{item.note ? ` — ${item.note}` : ''}</Text><View style={styles.transactionMeta}><Text style={styles.date}>{item.date}</Text><View style={styles.sourcePill}><Text style={styles.sourcePillText}>{item.fundSourceName}</Text></View></View></View>
      <View style={styles.trailing}><Text style={styles.amount}>-{formatRupiah(item.amount)}</Text><MaterialCommunityIcons name="dots-vertical" size={21} color={Colors.textSecondary} /></View>
    </Pressable>
  );

  const cashAllocationCard = (item: Budget) => (
    <View key={item.id} style={styles.card}>
      <View style={styles.body}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.fundSourceName} • Alokasi Cash</Text><Text style={styles.date}>{item.cashAllocated ? 'Sudah diserahkan penuh' : `Diserahkan sebagian dari ${formatRupiah(item.amount)}`}</Text></View>
      <Text style={styles.cashAmount}>-{formatRupiah(item.realizedAmount)}</Text>
    </View>
  );

  const creditPaymentCard = (item: CreditPayment) => (
    <View key={item.id} style={styles.card}>
      <View style={styles.body}>
        <Text style={styles.name}>Pembayaran tagihan {item.fundSourceName}</Text>
        <View style={styles.transactionMeta}>
          <Text style={styles.date}>{item.date}</Text>
          <View style={styles.sourcePill}><Text style={styles.sourcePillText}>Debit</Text></View>
        </View>
        {item.note ? <Text style={styles.meta}>{item.note}</Text> : null}
      </View>
      <View style={styles.paymentActions}>
        <Text style={styles.amount}>-{formatRupiah(item.amount)}</Text>
        {isOwner && activePeriod?.status === 'active' && canCancelPayment(item) ? (
          <Pressable
            disabled={cancelingPaymentId === item.id}
            style={styles.cancelPaymentButton}
            onPress={() => confirmCancelCreditPayment(item)}>
            <Text style={styles.cancelPaymentText}>{cancelingPaymentId === item.id ? 'Memproses…' : 'Batalkan pembayaran'}</Text>
          </Pressable>
        ) : isOwner && activePeriod?.status === 'active' ? (
          <Text style={styles.cancelUnavailableText}>
            {isLatestPayment(item) ? 'Tidak dapat dibatalkan • limit sudah digunakan' : 'Hanya pembayaran terbaru yang dapat dibatalkan'}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const isLatestPayment = (item: CreditPayment) => {
    const payments = uniqueCreditPayments(data.creditPayments)
      .filter(payment => payment.fundSourceId === item.fundSourceId)
      .sort((a, b) => a.date.localeCompare(b.date));
    return payments[payments.length - 1]?.id === item.id;
  };

  const canCancelPayment = (item: CreditPayment) => {
    const limit = data.creditLimits.find(source => source.fundSourceId === item.fundSourceId);
    return Boolean(
      limit && isLatestPayment(item) &&
      availableCreditLimit(data, item.fundSourceId, previousPeriodData) >= limit.amount,
    );
  };

  const confirmCancelCreditPayment = (item: CreditPayment) => {
    Alert.alert(
      'Batalkan pembayaran kartu kredit?',
      `Pencatatan pembayaran ${formatRupiah(item.amount)} tanggal ${item.date} akan dibatalkan. Nominalnya kembali ke saldo Debit, limit dipulihkan ke kondisi sebelum pembayaran, dan transaksi yang tertaut akan dibuka kembali. Lanjutkan hanya jika limit kartu saat ini masih utuh dan ini pembayaran terbaru.`,
      [
        {text: 'Jangan batalkan', style: 'cancel'},
        {text: 'Batalkan pembayaran', style: 'destructive', onPress: async () => {
          setCancelingPaymentId(item.id);
          try {
            const result = await cancelCreditPayment(
              householdId,
              activePeriodId,
              uid,
              item.id,
            );
            Alert.alert(
              'Pembayaran dibatalkan',
              `Saldo Debit dan limit sudah dikembalikan. ${result.unlinkedExpenses} transaksi kartu kredit dibuka kembali untuk dikoreksi.`,
            );
          } catch (cause) {
            Alert.alert('Tidak dapat membatalkan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
          } finally {
            setCancelingPaymentId(null);
          }
        }},
      ],
    );
  };

  const showForm = (budget?: Budget) => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Buka kembali periode dari Dashboard untuk menambah pengeluaran.'); return; }
    setEditingExpense(null);
    setBudgetId(budget?.id ?? availableBudgets[0]?.id ?? directOptions[0]?.id ?? '');
    setAmount(null); setDate(todayISO()); setNote(''); setOpen(true);
  };

  const showEditForm = (item: Expense) => {
    setEditingExpense(item);
    setBudgetId(item.budgetId);
    setAmount(item.amount);
    setDate(item.date);
    setNote(item.note);
    setOpen(true);
  };

  const submit = async () => {
    if (saving) { return; }
    if (!selected || amount === null || !isValidISODate(date)) {
      Alert.alert('Data belum lengkap', 'Pilih budget, isi nominal, dan pilih tanggal yang valid.');
      return;
    }
    const validation = validateExpense(amount, direct ? Number.POSITIVE_INFINITY : remainingForBudget(selected) + (editingExpense?.amount ?? 0));
    if (isUnexpectedBudget(selected.id) && !note.trim()) {
      Alert.alert('Isi catatan belanja', 'Tuliskan kebutuhan yang dibayar agar dapat dievaluasi pada akhir bulan.');
      return;
    }
    if (validation) { Alert.alert('Nominal tidak valid', validation); return; }
    setSaving(true);
    try {
      if (editingExpense) {
        await updateExpense(householdId, activePeriodId, uid, editingExpense.id, {amount, date, note: note.trim()});
      } else if (direct) {
        await addUnexpectedExpense(householdId, activePeriodId, uid, direct.source.id, {amount, date, note: note.trim()});
      } else {
        await addExpense(householdId, activePeriodId, uid, selected.id, {amount, date, note: note.trim()});
      }
      setOpen(false);
    } catch (cause) { Alert.alert('Pengeluaran ditolak', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
    finally { setSaving(false); }
  };

  const confirmDelete = (item: Expense) => Alert.alert('Hapus pengeluaran?', `${item.budgetName} • ${formatRupiah(item.amount)}`, [
    {text: 'Batal', style: 'cancel'},
    {text: 'Hapus', style: 'destructive', onPress: async () => {
      try { await deleteExpense(householdId, activePeriodId, uid, item); }
      catch (cause) { Alert.alert('Gagal menghapus', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
    }},
  ]);

  const confirmMoveToCredit = (item: Expense, sourceId: string) => {
    const source = fundSources.find(entry => entry.id === sourceId);
    if (!source) { return; }
    Alert.alert('Pindahkan sumber dana?', `${formatRupiah(item.amount)} akan dipindahkan dari Debit ke ${source.name}. Tanggal dan catatan tetap dipertahankan.`, [
      {text: 'Batal', style: 'cancel'},
      {text: 'Pindahkan', onPress: async () => {
        try {
          await moveUnexpectedExpenseToCredit(householdId, activePeriodId, uid, item.id, source.id);
          Alert.alert('Berhasil', 'Sumber dana telah diubah menjadi Kartu Kredit.');
        } catch (cause) {
          Alert.alert('Gagal memindahkan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
        }
      }},
    ]);
  };

  const chooseCreditSource = (item: Expense) => {
    const sources = fundSources.filter(source => source.type === 'credit_card');
    if (sources.length === 1) { confirmMoveToCredit(item, sources[0].id); return; }
    Alert.alert('Pilih kartu kredit', 'Pilih kartu yang digunakan untuk transaksi ini.', [
      {text: 'Batal', style: 'cancel'},
      ...sources.map(source => ({text: source.name, onPress: () => confirmMoveToCredit(item, source.id)})),
    ]);
  };

  const showExpenseActions = (item: Expense) => {
    if (isPeriodReadOnly) { Alert.alert(item.budgetName, `${formatRupiah(item.amount)} • ${item.date}`, [{text: 'Tutup'}]); return; }
    const sourceType = item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type;
    const actions: Parameters<typeof Alert.alert>[2] = [{text: 'Batal', style: 'cancel'}];
    const settlementStillExists = item.creditSettlementId &&
      uniqueCreditPayments(data.creditPayments).some(payment => payment.id === item.creditSettlementId);
    if (item.creditSettled && settlementStillExists) {
      Alert.alert(
        item.budgetName,
        `${formatRupiah(item.amount)} • ${item.date}\nSudah tercakup pembayaran kartu kredit (${item.creditSettlementId ?? 'tertaut'}).`,
        actions,
      );
      return;
    }
    actions.push({text: 'Edit', onPress: () => showEditForm(item)});
    if (isUnexpectedBudget(item.budgetId) && sourceType === 'debit' && fundSources.some(source => source.type === 'credit_card')) {
      actions.push({text: 'Pindahkan ke Kartu Kredit', onPress: () => chooseCreditSource(item)});
    }
    actions.push({text: 'Hapus', style: 'destructive', onPress: () => confirmDelete(item)});
    Alert.alert(item.budgetName, `${formatRupiah(item.amount)} • ${item.date}`, actions);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Pengeluaran" subtitle="Realisasi rencana dan belanja tak terduga" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchWrap}><MaterialCommunityIcons name="magnify" size={21} color={Colors.textSecondary} /><TextInput value={search} onChangeText={setSearch} placeholder="Cari pengeluaran..." placeholderTextColor="#89948F" style={styles.searchInput} /></View>
        <View style={styles.filters}>{([['all', 'Semua'], ['debit', 'Debit'], ['credit_card', 'Kartu Kredit']] as const).map(([value, label]) => <Pressable key={value} style={[styles.filterChip, sourceFilter === value && styles.filterChipActive]} onPress={() => setSourceFilter(value)}><Text style={[styles.filterText, sourceFilter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</View>
        <View style={styles.summaryGrid}>{summaryCards.map(card => <View key={card.label} style={styles.summaryCard}><Text style={styles.summaryLabel}>{card.label}</Text><Text style={[styles.summaryAmount, card.tone === 'expense' && styles.expenseColor, card.tone === 'unexpected' && styles.unexpectedColor, card.tone === 'balance' && styles.balanceColor, card.tone === 'credit' && styles.creditColor, card.amount < 0 && styles.negativeColor]}>{formatRupiah(card.amount)}</Text></View>)}</View>
        {categoryGroups.length === 0 && visibleCreditPayments.length === 0 ? <EmptyMessage icon="receipt-text-outline" title="Belum ada realisasi" message="Catat pengeluaran dari budget atau tandai alokasi cash yang sudah diserahkan." /> : categoryGroups.map(([id, group]) => (
          <View key={id} style={styles.group}>
            <Pressable style={styles.groupHeader} onPress={() => toggleGroup(id)}><View style={styles.groupIcon}><MaterialCommunityIcons name="currency-usd" size={20} color={Colors.primary} /></View><View style={styles.groupBody}><Text style={styles.groupTitle}>{group.name}</Text><Text style={styles.groupMeta}>{group.expenses.length + group.cashAllocations.length} transaksi</Text></View><Text style={styles.groupTotal}>-{formatRupiah(group.total)}</Text><MaterialCommunityIcons name={expandedGroups.has(id) ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textSecondary} /></Pressable>
            {expandedGroups.has(id) ? <View style={styles.groupList}>{group.expenses.map(expenseCard)}{group.cashAllocations.map(cashAllocationCard)}</View> : null}
          </View>
        ))}
        {visibleCreditPayments.length > 0 ? (
          <View style={styles.group}>
            <Pressable style={styles.groupHeader} onPress={() => toggleGroup('tagihan-rutin')}>
              <View style={[styles.groupIcon, styles.unexpectedIcon]}><MaterialCommunityIcons name="receipt-text-outline" size={20} color="#EE971C" /></View>
              <View style={styles.groupBody}><Text style={styles.groupTitle}>Tagihan Rutin</Text><Text style={styles.groupMeta}>{visibleCreditPayments.length} pembayaran kartu kredit • arus keluar Debit</Text></View>
              <Text style={[styles.groupTotal, styles.unexpectedColor]}>-{formatRupiah(visibleCreditPayments.reduce((sum, item) => sum + item.amount, 0))}</Text>
              <MaterialCommunityIcons name={expandedGroups.has('tagihan-rutin') ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textSecondary} />
            </Pressable>
            {expandedGroups.has('tagihan-rutin') ? <View style={styles.groupList}>{visibleCreditPayments.map(creditPaymentCard)}</View> : null}
          </View>
        ) : null}
        {unexpectedGroups.map(([id, group]) => (
          <View key={`unexpected-${id}`} style={styles.group}>
            <Pressable style={styles.groupHeader} onPress={() => toggleGroup(`unexpected-${id}`)}><View style={[styles.groupIcon, styles.unexpectedIcon]}><MaterialCommunityIcons name="alert-outline" size={20} color="#EE971C" /></View><View style={styles.groupBody}><Text style={styles.groupTitle}>Belanja Tak Terduga — {group.name}</Text><Text style={styles.groupMeta}>{group.expenses.length + group.cashAllocations.length} transaksi</Text></View><Text style={[styles.groupTotal, styles.unexpectedColor]}>-{formatRupiah(group.total)}</Text><MaterialCommunityIcons name={expandedGroups.has(`unexpected-${id}`) ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textSecondary} /></Pressable>
            {expandedGroups.has(`unexpected-${id}`) ? <View style={styles.groupList}>{group.expenses.map(expenseCard)}{group.cashAllocations.map(cashAllocationCard)}</View> : null}
          </View>
        ))}
        {data.expenses.length > 0 ? <Text style={styles.hint}>Ketuk transaksi untuk mengedit atau menghapusnya.</Text> : null}
      </ScrollView>
      {!isPeriodReadOnly ? <FAB onPress={() => showForm()} /> : null}
      <FormModal visible={open} title={editingExpense ? 'Edit pengeluaran' : 'Tambah pengeluaran'} onClose={() => { if (!saving) { setOpen(false); } }}>
        {options.length === 0 && !editingExpense ? <EmptyMessage icon="check-all" title="Tidak ada budget tersedia" message="Semua budget transaksi sudah terealisasi atau belum dibuat." /> : (
          <>
            <Label>Item budgeting</Label>{editingExpense ? <View style={styles.lockedBudget}><MaterialCommunityIcons name="lock-outline" size={18} color={Colors.textSecondary} /><Text style={styles.lockedBudgetText}>{editingExpense.budgetName} • {editingExpense.fundSourceName}</Text></View> : <SelectField value={budgetId} onChange={setBudgetId} options={options} />}
            {direct ? <><Label>Sumber dana</Label><SegmentedField value={direct.source.id} onChange={sourceId => { const option = directOptions.find(item => item.source.id === sourceId); if (option) { setBudgetId(option.id); } }} options={directOptions.map(item => ({label: item.source.type === 'credit_card' ? 'Kartu Kredit' : item.source.name, value: item.source.id}))} /></> : null}
            {selected ? <View style={styles.budgetInfo}><Text style={styles.infoName}>{selected.name}</Text><Text style={styles.infoLine}>Kategori: {selected.categoryName}</Text><Text style={styles.infoLine}>Sumber dana: {selected.fundSourceName}</Text><View style={styles.infoNumbers}><Text>{direct ? (direct.source.type === 'debit' ? 'Saldo Debit saat ini' : 'Limit tersedia saat ini') : 'Budget'} {formatRupiah(selected.amount)}</Text>{!direct ? <Text>Sisa {formatRupiah(remainingForBudget(selected))}</Text> : <Text style={styles.minusAllowed}>Boleh minus</Text>}</View></View> : null}
            <Label>Nominal realisasi</Label><MoneyField value={amount} onChangeValue={setAmount} />
            <Label>Tanggal</Label><DateField value={date} onChange={setDate} />
            <Label>{selected && isUnexpectedBudget(selected.id) ? 'Catatan belanja (wajib untuk evaluasi)' : 'Catatan (opsional)'}</Label><TextField value={note} onChangeText={setNote} multiline placeholder="Contoh: Perbaikan pompa air" />
            <FormActions saveLabel={saving ? 'Menyimpan...' : editingExpense ? 'Perbarui Pengeluaran' : 'Simpan Pengeluaran'} onSave={submit} onCancel={() => { if (!saving) { setOpen(false); } }} disabled={saving} />
          </>
        )}
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingTop: 14, paddingBottom: 100},
  summaryGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, marginBottom: 14},
  summaryCard: {width: '48.4%', minHeight: 82, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, backgroundColor: Colors.surface, padding: 14, justifyContent: 'center'},
  summaryLabel: {fontSize: 10, lineHeight: 14, color: Colors.textSecondary}, summaryAmount: {fontSize: 16, fontWeight: '900', marginTop: 7}, expenseColor: {color: Colors.danger}, unexpectedColor: {color: '#EE971C'}, balanceColor: {color: Colors.primary}, creditColor: {color: '#EE971C'}, negativeColor: {color: Colors.danger},
  group: {marginBottom: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 19, overflow: 'hidden'},
  groupHeader: {minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15},
  groupIcon: {width: 38, height: 38, borderRadius: 12, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10},
  unexpectedIcon: {backgroundColor: Colors.warningSoft}, groupBody: {flex: 1, marginRight: 8},
  groupTitle: {fontSize: 13, fontWeight: '900', color: Colors.textPrimary}, groupMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 3},
  groupTotal: {fontSize: 13, fontWeight: '900', color: Colors.danger, marginRight: 5}, groupList: {borderTopWidth: 1, borderTopColor: Colors.border},
  cashAmount: {fontSize: 14, fontWeight: '900', color: Colors.primary},
  card: {minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface},
  body: {flex: 1, marginRight: 8}, name: {fontSize: 13, lineHeight: 18, fontWeight: '800', color: Colors.textPrimary}, meta: {fontSize: 10, color: Colors.textSecondary, marginTop: 3}, date: {fontSize: 10, color: Colors.textSecondary},
  transactionMeta: {flexDirection: 'row', alignItems: 'center', marginTop: 6}, sourcePill: {marginLeft: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3}, sourcePillText: {fontSize: 9, color: Colors.textSecondary},
  amount: {fontSize: 14, fontWeight: '900', color: Colors.danger}, hint: {fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 8},
  trailing: {alignItems: 'flex-end', gap: 7},
  paymentActions: {alignItems: 'flex-end', gap: 8},
  cancelPaymentButton: {minHeight: 30, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: Colors.danger, borderRadius: 9, backgroundColor: '#FFF1F0'},
  cancelPaymentText: {fontSize: 10, fontWeight: '800', color: Colors.danger},
  cancelUnavailableText: {fontSize: 9, fontWeight: '700', color: Colors.textSecondary, maxWidth: 130, textAlign: 'right'},
  searchWrap: {height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface},
  searchInput: {flex: 1, color: Colors.textPrimary, fontSize: 13, marginLeft: 8, paddingVertical: 0},
  filters: {flexDirection: 'row', gap: 8, marginTop: 10},
  filterChip: {flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, borderRadius: 19, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border},
  filterChipActive: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  filterText: {fontSize: 11, color: Colors.textSecondary, fontWeight: '700'},
  filterTextActive: {color: Colors.white},
  lockedBudget: {minHeight: 50, flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 14, backgroundColor: '#EEF1F0'},
  lockedBudgetText: {fontSize: 14, color: Colors.textSecondary, marginLeft: 9, fontWeight: '700'},
  budgetInfo: {backgroundColor: Colors.primarySoft, borderRadius: 14, padding: 14, marginTop: 14}, infoName: {fontSize: 16, fontWeight: '800', color: Colors.primary}, infoLine: {fontSize: 12, color: Colors.textSecondary, marginTop: 4},
  infoNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12},
  minusAllowed: {fontSize: 11, color: Colors.warning, fontWeight: '800'},
});
