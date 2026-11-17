import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, FAB, ProgressBar, StatusPill} from '../../components/FinanceUI';
import {FormActions, FormModal, Label, MoneyField, SegmentedField, SelectField, TextField} from '../../components/FormUI';
import PrimaryButton from '../../components/Button/PrimaryButton';
import Colors from '../../constants/colors';
import {budgetStatus, creditPaymentBudgetItems, fundSourceTypeForBudget, isSavingsBudget, isSystemCreditPaymentBudget, remainingForBudget, summarizePeriod, SYSTEM_CREDIT_PAYMENT_CATEGORY_ID} from '../../domain/budgeting';
import type {Budget, RealizationType} from '../../models';
import {
  copyBudgetsFromPreviousPeriod,
  deleteBudget,
  saveBudget,
  setCashAllocation,
  setCashAllocationAmount,
  releaseBudgetRemainder,
  moveBudgetRemainderToSavings,
} from '../../services/firebase';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {periodLabel} from '../../utils/period';
import {isUnexpectedBudget} from '../../domain/unexpected';

function previousPeriod(id: string) {
  const [year, month] = id.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function BudgetingScreen() {
  const {
    householdId,
    uid,
    activePeriodId,
    budgetCategories,
    fundSources,
    data,
    previousPeriodData,
    periods,
    isPeriodReadOnly,
    receivables,
  } = useBudget();
  const [open, setOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [cashItem, setCashItem] = useState<Budget | null>(null);
  const [cashAmount, setCashAmount] = useState<number | null>(null);
  const [cashSaving, setCashSaving] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fundSourceId, setFundSourceId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [realizationType, setRealizationType] = useState<RealizationType>('transaction');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unrealized' | 'partial' | 'realized'>('all');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const matchesFilters = (item: Budget) => {
    const query = search.trim().toLowerCase();
    const status = budgetStatus(item);
    const matchesStatus = statusFilter === 'all'
      || status === statusFilter
      || (statusFilter === 'realized' && ['cash_allocated', 'savings_allocated'].includes(status));
    const matchesSearch = !query || [item.name, item.categoryName, item.fundSourceName, item.note]
      .some(value => value?.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  };
  const savingsBudgets = useMemo(
    () => data.budgets.filter(item => isSavingsBudget(item) && matchesFilters(item)),
    // matchesFilters only depends on these primitive filter values and current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.budgets, search, statusFilter],
  );
  const paymentBudgetItems = useMemo(
    () => creditPaymentBudgetItems(data.creditPayments),
    [data.creditPayments],
  );
  const summary = useMemo(
    () =>
      summarizePeriod(
        data,
        fundSources,
        previousPeriodData,
        receivables,
        activePeriodId,
      ),
    [data, fundSources, previousPeriodData, receivables, activePeriodId],
  );
  const cashSummary = useMemo(() => {
    const cashBudgets = data.budgets.filter(item => item.realizationType === 'cash_allocation');
    const allocated = cashBudgets.reduce((sum, item) => sum + item.amount, 0);
    const handedOver = cashBudgets.reduce(
      (sum, item) => sum + Math.min(item.amount, item.realizedAmount),
      0,
    );
    return {allocated, handedOver, remaining: Math.max(0, allocated - handedOver)};
  }, [data.budgets]);
  const grouped = useMemo(() => {
    const result = new Map<string, {name: string; items: Budget[]}>();
    data.budgets.filter(item => !isSavingsBudget(item) && matchesFilters(item)).forEach(item => {
      const isRoutineBillsCategory = item.categoryName.trim().toLowerCase() === 'tagihan rutin';
      const groupId = isRoutineBillsCategory ? SYSTEM_CREDIT_PAYMENT_CATEGORY_ID : item.categoryId;
      const current = result.get(groupId);
      result.set(groupId, {
        name: isRoutineBillsCategory ? 'Tagihan Rutin' : item.categoryName,
        items: [...(current?.items ?? []), item],
      });
    });
    paymentBudgetItems.filter(matchesFilters).forEach(item => {
      const current = result.get(item.categoryId);
      result.set(item.categoryId, {
        name: item.categoryName,
        items: [...(current?.items ?? []), item],
      });
    });
    return [...result.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.budgets, paymentBudgetItems, search, statusFilter]);

  const toggleCategory = (categoryIdToToggle: string) => {
    setExpandedCategories(current => {
      const next = new Set(current);
      if (next.has(categoryIdToToggle)) {
        next.delete(categoryIdToToggle);
      } else {
        next.add(categoryIdToToggle);
      }
      return next;
    });
  };

  const showForm = (item?: Budget) => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Buka kembali periode dari Dashboard untuk mengubah budgeting.'); return; }
    if (item && isUnexpectedBudget(item.id)) {
      Alert.alert('Belanja Tak Terduga', 'Nominal mengikuti transaksi Pengeluaran secara otomatis. Lihat rincian penggunaannya di Laporan.');
      return;
    }
    setEditing(item ?? null);
    setName(item?.name ?? '');
    setCategoryId(item?.categoryId ?? budgetCategories[0]?.id ?? '');
    setFundSourceId(item?.fundSourceId ?? fundSources[0]?.id ?? '');
    setAmount(item?.amount ?? null);
    setRealizationType(item && isSavingsBudget(item) ? 'savings_allocation' : item?.realizationType ?? 'transaction');
    setNote(item?.note ?? '');
    setOpen(true);
  };

  const submit = async () => {
    const category = budgetCategories.find(item => item.id === categoryId);
    const source = fundSources.find(item => item.id === fundSourceId);
    const savingsCategory = category?.name.toLowerCase().includes('tabungan') || category?.id === 'tabungan';
    const selectedRealizationType: RealizationType = savingsCategory ? 'savings_allocation' : realizationType;
    if (!name.trim() || !category || !source || !amount || amount <= 0) {
      Alert.alert('Data belum lengkap', 'Isi nama, kategori, nominal, dan sumber dana.');
      return;
    }
    if (selectedRealizationType === 'savings_allocation' && source.type !== 'debit') {
      Alert.alert('Sumber dana tidak sesuai', 'Alokasi Tabungan hanya dapat berasal dari Debit / Rekening.');
      return;
    }
    const otherBudget = data.budgets
      .filter(item => item.fundSourceId === source.id && item.id !== editing?.id)
      .reduce((sum, item) => sum + item.amount, 0);
    if (source.type === 'credit_card') {
      const periodLimit = data.creditLimits.find(item => item.fundSourceId === source.id);
      if (!periodLimit) {
        Alert.alert('Limit belum diatur', `Atur limit tersedia ${source.name} untuk ${periodLabel(activePeriodId)} terlebih dahulu.`);
        return;
      }
      if (otherBudget + amount > periodLimit.amount) {
        Alert.alert('Melebihi limit', `Budget ${source.name} melebihi sisa limit sebesar ${formatRupiah(otherBudget + amount - periodLimit.amount)}.`);
        return;
      }
    }
    try {
      await saveBudget(householdId, activePeriodId, uid, {
        name: name.trim(), categoryId: category.id, categoryName: category.name,
        fundSourceId: source.id, fundSourceName: source.name, fundSourceType: source.type, amount,
        realizationType: selectedRealizationType, note: note.trim(),
      }, editing ?? undefined);
      setOpen(false);
    } catch (cause) {
      Alert.alert('Gagal menyimpan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    }
  };

  const confirmDelete = (item: Budget) => Alert.alert('Hapus budget?', `${item.name} • ${formatRupiah(item.amount)}`, [
    {text: 'Batal', style: 'cancel'},
    {text: 'Hapus', style: 'destructive', onPress: async () => {
      try { await deleteBudget(householdId, activePeriodId, item); }
      catch (cause) { Alert.alert('Tidak dapat dihapus', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
    }},
  ]);

  const showBudgetActions = (item: Budget) => {
    if (isPeriodReadOnly) {
      Alert.alert(item.name, `${formatRupiah(item.amount)} • ${item.fundSourceName}`, [{text: 'Tutup'}]);
      return;
    }
    if (isUnexpectedBudget(item.id)) {
      showForm(item);
      return;
    }
    const actions: Parameters<typeof Alert.alert>[2] = [
      {text: 'Batal', style: 'cancel'},
      {text: 'Edit', onPress: () => showForm(item)},
    ];
    if (item.realizedAmount === 0) {
      actions.push({text: 'Hapus', style: 'destructive', onPress: () => confirmDelete(item)});
    }
    Alert.alert(item.name, `${formatRupiah(item.amount)} • ${item.fundSourceName}`, actions);
  };

  const confirmTransfer = (item: Budget, mode?: 'release' | 'savings') => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Sisa budget pada periode arsip tidak dapat dialihkan.'); return; }
    const remaining = remainingForBudget(item);
    const sourceType = fundSourceTypeForBudget(item, fundSources);
    const destination = sourceType === 'credit_card' ? `limit ${item.fundSourceName}` : 'saldo Debit';
    const release = async () => {
      setTransferring(true);
      try {
        await releaseBudgetRemainder(householdId, activePeriodId, uid, item.id, remaining);
        Alert.alert('Berhasil', `Sisa budget telah dikembalikan ke ${destination}.`);
      } catch (cause) {
        Alert.alert('Gagal mengembalikan saldo', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
      } finally { setTransferring(false); }
    };
    const moveToSavings = async () => {
      setTransferring(true);
      try {
        await moveBudgetRemainderToSavings(householdId, activePeriodId, uid, item.id, remaining);
        Alert.alert('Berhasil', `${formatRupiah(remaining)} telah ditambahkan ke Tabungan.`);
      } catch (cause) {
        Alert.alert('Gagal memindahkan ke Tabungan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
      } finally { setTransferring(false); }
    };
    if (sourceType === 'credit_card' || mode === 'release') {
      Alert.alert(`Kembalikan sisa ke ${destination}?`, `${formatRupiah(remaining)} dari ${item.name} akan kembali ke ${destination}.`, [
        {text: 'Batal', style: 'cancel'}, {text: 'Kembalikan', onPress: release},
      ]);
    } else if (mode === 'savings') {
      Alert.alert('Tambahkan ke Tabungan?', `${formatRupiah(remaining)} dari ${item.name} akan digabungkan dengan Tabungan bulan ini.`, [
        {text: 'Batal', style: 'cancel'}, {text: 'Ke Tabungan', onPress: moveToSavings},
      ]);
    } else {
      Alert.alert('Alihkan sisa budget', `${formatRupiah(remaining)} dari ${item.name} dapat dikembalikan ke saldo Debit atau langsung ditambahkan ke Tabungan.`, [
        {text: 'Batal', style: 'cancel'},
        {text: 'Ke Saldo Debit', onPress: release},
        {text: 'Ke Tabungan', onPress: moveToSavings},
      ]);
    }
  };

  const toggleCash = async (item: Budget) => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Alokasi pada periode ini tidak dapat diubah.'); return; }
    try {
      await setCashAllocation(householdId, activePeriodId, uid, item.id, !item.cashAllocated);
    } catch (cause) {
      Alert.alert('Gagal memperbarui', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    }
  };

  const showCashForm = (item: Budget) => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Alokasi pada periode ini tidak dapat diubah.'); return; }
    setCashItem(item);
    setCashAmount(item.realizedAmount);
  };

  const submitCashAllocation = async () => {
    if (!cashItem || cashSaving) { return; }
    if (cashAmount === null || cashAmount < 0 || cashAmount > cashItem.amount) {
      Alert.alert('Nominal tidak valid', `Masukkan total yang sudah diserahkan antara Rp0 dan ${formatRupiah(cashItem.amount)}.`);
      return;
    }
    setCashSaving(true);
    try {
      await setCashAllocationAmount(householdId, activePeriodId, uid, cashItem.id, cashAmount);
      setCashItem(null);
    } catch (cause) {
      Alert.alert('Gagal memperbarui', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    } finally {
      setCashSaving(false);
    }
  };

  const copyPrevious = async () => {
    if (isPeriodReadOnly) { Alert.alert('Periode hanya-baca', 'Pilih periode aktif untuk menyalin budgeting.'); return; }
    const source = previousPeriod(activePeriodId);
    if (!periods.some(item => item.id === source)) {
      Alert.alert('Tidak ada arsip', `Periode ${periodLabel(source)} belum tersedia.`);
      return;
    }
    Alert.alert('Salin budget bulan sebelumnya?', `Semua budget ${periodLabel(source)} akan disalin tanpa realisasi.`, [
      {text: 'Batal', style: 'cancel'},
      {text: 'Salin', onPress: async () => {
        try {
          const count = await copyBudgetsFromPreviousPeriod(householdId, source, activePeriodId, uid);
          Alert.alert('Berhasil', `${count} budget berhasil disalin.`);
        } catch (cause) { Alert.alert('Gagal menyalin', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
      }},
    ]);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Budgeting" subtitle="Pusat perencanaan keuangan bulanan" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchWrap}><MaterialCommunityIcons name="magnify" size={21} color={Colors.textSecondary} /><TextInput value={search} onChangeText={setSearch} placeholder="Cari budget..." placeholderTextColor="#89948F" style={styles.searchInput} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{([['all', 'Semua'], ['unrealized', 'Belum'], ['partial', 'Sebagian'], ['realized', 'Selesai']] as const).map(([value, label]) => <Pressable key={value} style={[styles.filterChip, statusFilter === value && styles.filterChipActive]} onPress={() => setStatusFilter(value)}><Text style={[styles.filterText, statusFilter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</ScrollView>
        <View style={styles.summaryGroup}>
          <Text style={styles.summaryTitle}>DANA DEBIT</Text>
          <View style={styles.summaryRow}>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Total Saldo Debit</Text><Text style={styles.miniAmount}>{formatRupiah(summary.totalIncome)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Budgeting Debit</Text><Text style={[styles.miniAmount, styles.realizedAmount]}>{formatRupiah(summary.debitBudget)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Sisa Budgeting</Text><Text style={[styles.miniAmount, summary.remainingDebitBudget < 0 && styles.negativeAmount]}>{formatRupiah(summary.remainingDebitBudget)}</Text></View>
          </View>
          {summary.totalCreditPayments > 0 ? <Text style={styles.debitActualNote}>Pembayaran kartu kredit {formatRupiah(summary.totalCreditPayments)} • Saldo Debit aktual {formatRupiah(summary.unallocatedDebit)}</Text> : null}
        </View>
        <View style={styles.summaryGroup}>
          <Text style={styles.summaryTitle}>KARTU KREDIT</Text>
          <View style={styles.summaryRow}>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Kapasitas Kredit</Text><Text style={styles.miniAmount}>{formatRupiah(summary.totalCreditLimit)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Budgeting Kartu Kredit</Text><Text style={[styles.miniAmount, styles.creditAmount]}>{formatRupiah(summary.creditBudget)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Sisa</Text><Text style={[styles.miniAmount, summary.unallocatedCredit < 0 && styles.negativeAmount]}>{formatRupiah(summary.unallocatedCredit)}</Text></View>
          </View>
        </View>
        <View style={styles.summaryGroup}>
          <Text style={styles.summaryTitle}>ALOKASI CASH</Text>
          <View style={styles.summaryRow}>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Total Alokasi Cash</Text><Text style={styles.miniAmount}>{formatRupiah(cashSummary.allocated)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Sudah Diserahkan</Text><Text style={[styles.miniAmount, styles.realizedAmount]}>{formatRupiah(cashSummary.handedOver)}</Text></View>
            <View style={styles.miniSummary}><Text style={styles.miniLabel}>Sisa</Text><Text style={styles.miniAmount}>{formatRupiah(cashSummary.remaining)}</Text></View>
          </View>
        </View>
        {data.budgets.length === 0 && paymentBudgetItems.length === 0 ? (
          <View>
            <EmptyMessage icon="clipboard-text-outline" title="Belum ada rencana" message="Buat budget pertama atau salin rencana rutin bulan sebelumnya." />
            <PrimaryButton title="Salin budget bulan sebelumnya" variant="secondary" onPress={copyPrevious} />
          </View>
        ) : grouped.length === 0 && savingsBudgets.length === 0 ? <EmptyMessage icon="magnify" title="Budget tidak ditemukan" message="Ubah kata pencarian atau filter status." /> : grouped.map(([groupCategoryId, groupData]) => {
          const {name: category, items} = groupData;
          const categoryTotal = items.reduce((sum, item) => sum + item.amount, 0);
          const realized = items.reduce((sum, item) => sum + Math.min(item.amount, item.realizedAmount), 0);
          const isExpanded = expandedCategories.has(groupCategoryId) || Boolean(search.trim());
          return (
            <View key={groupCategoryId} style={styles.group}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{expanded: isExpanded}}
                accessibilityLabel={`${category}, ${items.length} item budgeting`}
                style={({pressed}) => [
                  styles.groupButton,
                  pressed && styles.groupButtonPressed,
                  isExpanded && styles.groupButtonExpanded,
                ]}
                onPress={() => toggleCategory(groupCategoryId)}>
                <View style={styles.groupHeader}>
                  <View style={styles.groupInfo}>
                    <View style={styles.groupTitleRow}>
                      <Text style={styles.groupTitle}>{category.toUpperCase()}</Text>
                      <View style={styles.itemCount}>
                        <Text style={styles.itemCountText}>{items.length}</Text>
                      </View>
                    </View>
                    <Text style={styles.groupMeta}>
                      {formatRupiah(realized)} dari {formatRupiah(categoryTotal)}
                    </Text>
                  </View>
                  <View style={styles.groupRight}>
                    <Text style={styles.groupTotal}>{formatRupiah(categoryTotal)}</Text>
                    <MaterialCommunityIcons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={23}
                      color={Colors.primary}
                    />
                  </View>
                </View>
                <ProgressBar value={categoryTotal ? realized / categoryTotal : 0} />
              </Pressable>
              {isExpanded ? items.map(item => {
                const status = budgetStatus(item);
                const isPayment = isSystemCreditPaymentBudget(item);
                return (
                  <Pressable key={item.id} style={styles.item} onPress={() => { if (!isPayment) { showForm(item); } }}>
                    <View style={styles.itemTop}>
                      <View style={styles.itemNameWrap}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemSource}>{isPayment ? `${item.fundSourceName} • Dibayar ${item.note}` : `${item.fundSourceName} • ${item.realizationType === 'cash_allocation' ? 'Alokasi cash' : 'Transaksi'}`}</Text></View>
                      <View style={styles.itemActions}><StatusPill status={status} />{!isPayment ? <Pressable accessibilityLabel={`Menu ${item.name}`} hitSlop={8} onPress={event => { event.stopPropagation(); showBudgetActions(item); }}><MaterialCommunityIcons name="dots-vertical" size={22} color={Colors.textSecondary} /></Pressable> : null}</View>
                    </View>
                    <ProgressBar value={item.amount ? item.realizedAmount / item.amount : 0} color={status === 'partial' ? Colors.accent : Colors.primary} />
                    <View style={styles.numbers}><View><Text style={styles.numberLabel}>Budget</Text><Text style={styles.budgetAmount}>{formatRupiah(item.amount)}</Text></View><View><Text style={styles.numberLabel}>Realisasi</Text><Text style={[styles.budgetAmount, styles.realizedAmount]}>{formatRupiah(item.realizedAmount)}</Text></View><View><Text style={styles.numberLabel}>Sisa</Text><Text style={styles.budgetAmount}>{formatRupiah(remainingForBudget(item))}</Text></View></View>
                    {!isPayment && item.amount === 0 && !isUnexpectedBudget(item.id) ? <Text style={styles.groupMeta}>Budget ditutup • {item.note}</Text> : null}
                    {!isPayment && !isUnexpectedBudget(item.id) && !isSavingsBudget(item) && remainingForBudget(item) > 0 && ['debit', 'credit_card'].includes(fundSourceTypeForBudget(item, fundSources)) ? (
                      fundSourceTypeForBudget(item, fundSources) === 'debit' ? <View style={styles.transferRow}><Pressable accessibilityRole="button" disabled={transferring} style={styles.cashButton} onPress={event => { event.stopPropagation(); confirmTransfer(item, 'release'); }}><Text style={styles.cashText}>↩ Ke Saldo Debit</Text></Pressable><Pressable accessibilityRole="button" disabled={transferring} style={[styles.cashButton, styles.savingsButton]} onPress={event => { event.stopPropagation(); confirmTransfer(item, 'savings'); }}><Text style={styles.savingsButtonText}>♟ Ke Tabungan</Text></Pressable></View> : <Pressable accessibilityRole="button" disabled={transferring} style={styles.cashButton} onPress={event => { event.stopPropagation(); confirmTransfer(item, 'release'); }}><Text style={styles.cashText}>{transferring ? 'Mengembalikan...' : 'Kembalikan sisa ke limit kredit'}</Text></Pressable>
                    ) : null}
                    {!isPayment && item.realizationType === 'cash_allocation' && item.amount > 0 ? (
                      <Pressable style={[styles.cashButton, item.cashAllocated && styles.cashButtonDone]} onPress={event => { event.stopPropagation(); showCashForm(item); }}>
                        <MaterialCommunityIcons name={item.cashAllocated ? 'check-circle' : 'cash-check'} size={17} color={item.cashAllocated ? Colors.white : Colors.primary} />
                        <Text style={[styles.cashText, item.cashAllocated && styles.cashTextDone]}>{item.cashAllocated ? 'Sudah diserahkan penuh' : item.realizedAmount > 0 ? 'Atur penyerahan cash' : 'Serahkan alokasi cash'}</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              }) : null}
            </View>
          );
        })}
        {data.budgets.length > 0 ? <Pressable onPress={copyPrevious}><Text style={styles.copyLink}>Salin budget bulan sebelumnya</Text></Pressable> : null}
        {savingsBudgets.length > 0 ? <View style={styles.savingsSection}>
          <View style={styles.savingsHeader}><View><Text style={styles.savingsTitle}>TABUNGAN</Text><Text style={styles.groupMeta}>Alokasi dana • bukan pengeluaran</Text></View><Text style={styles.savingsTotal}>{formatRupiah(savingsBudgets.reduce((sum, item) => sum + item.amount, 0))}</Text></View>
          {savingsBudgets.map(item => {
            const allocated = item.cashAllocated;
            return <Pressable key={item.id} style={styles.item} onPress={() => showForm(item)}>
              <View style={styles.itemTop}><View style={styles.itemNameWrap}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemSource}>{item.fundSourceName} • Alokasi Tabungan</Text></View><View style={styles.itemActions}><StatusPill status={budgetStatus(item)} /><Pressable accessibilityLabel={`Menu ${item.name}`} hitSlop={8} onPress={event => { event.stopPropagation(); showBudgetActions(item); }}><MaterialCommunityIcons name="dots-vertical" size={22} color={Colors.textSecondary} /></Pressable></View></View>
              <View style={styles.numbers}><Text style={styles.budgetAmount}>{formatRupiah(item.amount)}</Text><Text style={styles.remaining}>{allocated ? 'Sudah dialokasikan' : 'Belum dialokasikan'}</Text></View>
              <Pressable style={[styles.cashButton, allocated && styles.cashButtonDone]} onPress={() => toggleCash(item)}><MaterialCommunityIcons name={allocated ? 'check-circle' : 'bank-transfer-in'} size={17} color={allocated ? Colors.white : Colors.primary} /><Text style={[styles.cashText, allocated && styles.cashTextDone]}>{allocated ? 'Sudah masuk Tabungan' : 'Tandai sudah ditabung'}</Text></Pressable>
            </Pressable>;
          })}
        </View> : null}
      </ScrollView>
      {!isPeriodReadOnly ? <FAB onPress={() => showForm()} /> : null}
      <FormModal visible={open} title={editing ? 'Edit budget' : 'Tambah budget'} onClose={() => setOpen(false)}>
        <Label>Nama kebutuhan</Label><TextField value={name} onChangeText={setName} placeholder="Contoh: Listrik" />
        <Label>Kategori</Label><SelectField value={categoryId} onChange={value => { setCategoryId(value); if (budgetCategories.find(item => item.id === value)?.name.toLowerCase().includes('tabungan')) { setRealizationType('savings_allocation'); const debit = fundSources.find(item => item.type === 'debit'); if (debit) { setFundSourceId(debit.id); } } }} options={budgetCategories.map(item => ({label: item.name, value: item.id}))} />
        <Label>Nominal budget</Label><MoneyField value={amount} onChangeValue={setAmount} />
        <Label>Sumber dana</Label><SegmentedField value={fundSourceId} onChange={setFundSourceId} options={fundSources.filter(item => realizationType !== 'savings_allocation' || item.type === 'debit').map(item => ({label: item.name, value: item.id}))} />
        <Label>Jenis realisasi</Label><SegmentedField value={realizationType} onChange={value => { const next = value as RealizationType; setRealizationType(next); if (next === 'savings_allocation') { const debit = fundSources.find(item => item.type === 'debit'); if (debit) { setFundSourceId(debit.id); } } }} options={[{label: 'Transaksi', value: 'transaction'}, {label: 'Alokasi Cash', value: 'cash_allocation'}, {label: 'Tabungan', value: 'savings_allocation'}]} />
        <Label>Catatan (opsional)</Label><TextField value={note} onChangeText={setNote} multiline placeholder="Keterangan tambahan" />
        <FormActions saveLabel={editing ? 'Perbarui Budget' : 'Simpan Budget'} onSave={submit} onCancel={() => setOpen(false)} />
      </FormModal>
      <FormModal visible={cashItem !== null} title="Penyerahan Alokasi Cash" onClose={() => { if (!cashSaving) { setCashItem(null); } }}>
        {cashItem ? <>
          <View style={styles.cashSummary}>
            <Text style={styles.cashSummaryName}>{cashItem.name}</Text>
            <View style={styles.cashSummaryRow}><Text style={styles.cashSummaryLabel}>Total alokasi</Text><Text style={styles.cashSummaryValue}>{formatRupiah(cashItem.amount)}</Text></View>
            <View style={styles.cashSummaryRow}><Text style={styles.cashSummaryLabel}>Sudah diserahkan</Text><Text style={styles.cashSummaryValue}>{formatRupiah(cashItem.realizedAmount)}</Text></View>
            <View style={styles.cashSummaryRow}><Text style={styles.cashSummaryLabel}>Belum diserahkan</Text><Text style={[styles.cashSummaryValue, styles.cashSummaryRemaining]}>{formatRupiah(remainingForBudget(cashItem))}</Text></View>
          </View>
          <Label>Total yang sudah diserahkan</Label>
          <MoneyField value={cashAmount} onChangeValue={setCashAmount} />
          <Text style={styles.cashHelp}>Isi total kumulatif, bukan tambahan. Contoh: setelah menyerahkan Rp250.000 dari alokasi Rp1.500.000, isi Rp250.000. Saat menyerahkan lagi Rp300.000, ubah total menjadi Rp550.000.</Text>
          <FormActions saveLabel={cashSaving ? 'Menyimpan...' : 'Simpan Penyerahan'} disabled={cashSaving} onSave={submitCashAllocation} onCancel={() => setCashItem(null)} />
        </> : null}
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingTop: 14, paddingBottom: 100},
  summaryGroup: {marginTop: 14},
  summaryTitle: {fontSize: 11, fontWeight: '900', letterSpacing: 0.7, color: Colors.textSecondary, marginBottom: 7, marginLeft: 2},
  summaryRow: {flexDirection: 'row', gap: 8},
  miniSummary: {flex: 1, minHeight: 88, borderWidth: 1, borderColor: Colors.border, borderRadius: 17, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 10},
  miniLabel: {minHeight: 27, fontSize: 10, lineHeight: 13, color: Colors.textSecondary, textAlign: 'center'}, miniAmount: {fontSize: 13, fontWeight: '900', color: Colors.textPrimary, marginTop: 6, textAlign: 'center'}, realizedAmount: {color: Colors.primary},
  creditAmount: {color: '#EE971C'},
  negativeAmount: {color: Colors.danger},
  debitActualNote: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 7, marginHorizontal: 3},
  group: {marginTop: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 19, backgroundColor: Colors.surface, overflow: 'hidden'},
  groupButton: {backgroundColor: Colors.surface, padding: 15},
  groupButtonPressed: {opacity: 0.82},
  groupButtonExpanded: {backgroundColor: '#FCFDFC'},
  groupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10},
  groupInfo: {flex: 1, marginRight: 12},
  groupTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  groupTitle: {fontSize: 14, fontWeight: '900', color: Colors.textPrimary},
  itemCount: {minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center'},
  itemCountText: {fontSize: 11, fontWeight: '800', color: Colors.primary},
  groupMeta: {fontSize: 11, color: Colors.textSecondary, marginTop: 5},
  groupRight: {flexDirection: 'row', alignItems: 'center', gap: 7},
  groupTotal: {fontSize: 13, fontWeight: '800', color: Colors.primary},
  item: {backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, padding: 15},
  itemTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10}, itemNameWrap: {flex: 1, marginRight: 8},
  itemActions: {flexDirection: 'row', alignItems: 'center', gap: 6},
  itemName: {fontSize: 16, fontWeight: '800', color: Colors.textPrimary}, itemSource: {fontSize: 11, color: Colors.textSecondary, marginTop: 4},
  numbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12}, numberLabel: {fontSize: 9, color: Colors.textSecondary, marginBottom: 3}, budgetAmount: {fontSize: 13, fontWeight: '900', color: Colors.textPrimary}, remaining: {fontSize: 12, color: Colors.textSecondary},
  transferRow: {flexDirection: 'row', gap: 8},
  cashButton: {flex: 1, marginTop: 13, minHeight: 39, borderRadius: 10, borderWidth: 1, borderColor: '#B8DCCE', backgroundColor: Colors.primarySoft, paddingHorizontal: 7, paddingVertical: 9, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center'},
  savingsButton: {backgroundColor: '#F3F0FF', borderColor: '#D8CFFF'}, savingsButtonText: {fontSize: 11, color: '#6546C9', fontWeight: '800'},
  cashButtonDone: {backgroundColor: Colors.primary}, cashText: {fontSize: 12, color: Colors.primary, fontWeight: '800'}, cashTextDone: {color: Colors.white},
  copyLink: {textAlign: 'center', color: Colors.primary, fontWeight: '700', marginTop: 24},
  savingsSection: {marginTop: 28, borderWidth: 1, borderColor: Colors.border, borderRadius: 19, backgroundColor: Colors.surface, overflow: 'hidden'},
  savingsHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15},
  savingsTitle: {fontSize: 17, fontWeight: '900', color: Colors.primary, letterSpacing: 0.6},
  savingsTotal: {fontSize: 16, fontWeight: '900', color: Colors.primary},
  searchWrap: {height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface},
  searchInput: {flex: 1, color: Colors.textPrimary, fontSize: 13, marginLeft: 8, paddingVertical: 0},
  filters: {gap: 8, paddingTop: 10, paddingBottom: 2},
  filterChip: {minWidth: 82, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 19, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border},
  filterChipActive: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  filterText: {fontSize: 11, color: Colors.textSecondary, fontWeight: '700'},
  filterTextActive: {color: Colors.white},
  emergencyCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, padding: 16, marginTop: 12},
  emergencyTop: {flexDirection: 'row', alignItems: 'center'},
  emergencyIcon: {width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center'},
  emergencyInfo: {flex: 1, marginLeft: 11},
  emergencyTitle: {fontSize: 16, fontWeight: '900', color: Colors.textPrimary},
  emergencyMeta: {fontSize: 11, color: Colors.textSecondary, marginTop: 3},
  emergencyBalanceRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 14},
  emergencyBalanceLabel: {fontSize: 12, color: Colors.textSecondary},
  emergencyBalance: {fontSize: 17, fontWeight: '900', color: Colors.primary},
  emergencyComplete: {fontSize: 12, color: Colors.success, fontWeight: '700', marginTop: 12},
  cashSummary: {marginTop: 10, padding: 15, borderRadius: 16, backgroundColor: Colors.primarySoft},
  cashSummaryName: {fontSize: 16, fontWeight: '900', color: Colors.textPrimary, marginBottom: 10},
  cashSummaryRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5},
  cashSummaryLabel: {fontSize: 12, color: Colors.textSecondary},
  cashSummaryValue: {fontSize: 13, fontWeight: '800', color: Colors.textPrimary},
  cashSummaryRemaining: {color: Colors.primary},
  cashHelp: {fontSize: 11, lineHeight: 17, color: Colors.textSecondary, marginTop: 9},
});
