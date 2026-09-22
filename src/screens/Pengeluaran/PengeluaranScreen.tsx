import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, FAB, SummaryCard} from '../../components/FinanceUI';
import {FormActions, FormModal, Label, MoneyField, SelectField, TextField} from '../../components/FormUI';
import Colors from '../../constants/colors';
import {remainingForBudget, validateExpense} from '../../domain/budgeting';
import type {Budget, Expense} from '../../models';
import {addExpense, addUnexpectedExpense, deleteExpense} from '../../services/firebase';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {isValidISODate, todayISO} from '../../utils/period';
import {isUnexpectedBudget, unexpectedBudgetId, unexpectedAvailable, UNEXPECTED_NAME, UNEXPECTED_CATEGORY_ID} from '../../domain/unexpected';

function isUnexpectedCategory(categoryId: string, categoryName: string) {
  return categoryId === UNEXPECTED_CATEGORY_ID || categoryName.trim().toLowerCase() === UNEXPECTED_NAME.toLowerCase();
}

export default function PengeluaranScreen() {
  const {householdId, uid, activePeriodId, data, fundSources} = useBudget();
  const directOptions = useMemo(() => {
    const debitBudget = data.budgets.find(item => item.id === 'dana-darurat');
    const debit = fundSources.find(item => item.type === 'debit' && item.id === debitBudget?.fundSourceId)
      ?? fundSources.find(item => item.type === 'debit' && item.name.toLowerCase() === 'debit')
      ?? fundSources.find(item => item.type === 'debit');
    return fundSources.filter(source => source.type === 'credit_card' || source.id === debit?.id).map(source => ({
      id: unexpectedBudgetId(source), source,
      available: unexpectedAvailable(data, source, fundSources),
    }));
  }, [data, fundSources]);
  const availableBudgets = useMemo(() => data.budgets.filter(item => !isUnexpectedBudget(item.id) && item.realizationType === 'transaction' && remainingForBudget(item) > 0), [data.budgets]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [budgetId, setBudgetId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const direct = directOptions.find(item => item.id === budgetId);
  const selected = direct ? {
    id: direct.id, name: UNEXPECTED_NAME, categoryName: UNEXPECTED_NAME,
    categoryId: UNEXPECTED_CATEGORY_ID, fundSourceName: direct.source.name,
    amount: Math.max(0, direct.available), realizedAmount: 0,
  } : data.budgets.find(item => item.id === budgetId);
  const options = [
    ...availableBudgets.map(item => ({label: `${item.name} • ${item.fundSourceName} — sisa ${formatRupiah(remainingForBudget(item))}`, value: item.id})),
    ...directOptions.map(item => ({label: `${UNEXPECTED_NAME} • ${item.source.name} — tersedia ${formatRupiah(Math.max(0, item.available))}`, value: item.id})),
  ];
  const total = data.budgets.reduce((sum, item) => sum + item.realizedAmount, 0);
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, {name: string; expenses: Expense[]; cashAllocations: Budget[]; total: number}>();
    const groupFor = (id: string, name: string) => {
      if (!groups.has(id)) { groups.set(id, {name, expenses: [], cashAllocations: [], total: 0}); }
      return groups.get(id)!;
    };
    data.expenses.filter(item => !isUnexpectedCategory(item.categoryId, item.categoryName) && !isUnexpectedBudget(item.budgetId)).forEach(item => {
      const group = groupFor(item.categoryId, item.categoryName);
      group.expenses.push(item);
      group.total += item.amount;
    });
    data.budgets.filter(item => item.realizationType === 'cash_allocation' && item.cashAllocated && !isUnexpectedCategory(item.categoryId, item.categoryName)).forEach(item => {
      const group = groupFor(item.categoryId, item.categoryName);
      group.cashAllocations.push(item);
      group.total += item.realizedAmount;
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [data.budgets, data.expenses]);
  const unexpectedGroups = useMemo(() => {
    const groups = new Map<string, {name: string; expenses: Expense[]; cashAllocations: Budget[]; total: number}>();
    data.expenses.filter(item => isUnexpectedCategory(item.categoryId, item.categoryName) || isUnexpectedBudget(item.budgetId)).forEach(item => {
      const group = groups.get(item.fundSourceId) ?? {name: item.fundSourceName, expenses: [], cashAllocations: [], total: 0};
      group.expenses.push(item);
      group.total += item.amount;
      groups.set(item.fundSourceId, group);
    });
    data.budgets.filter(item => item.realizationType === 'cash_allocation' && item.cashAllocated && isUnexpectedCategory(item.categoryId, item.categoryName)).forEach(item => {
      const group = groups.get(item.fundSourceId) ?? {name: item.fundSourceName, expenses: [], cashAllocations: [], total: 0};
      group.cashAllocations.push(item);
      group.total += item.realizedAmount;
      groups.set(item.fundSourceId, group);
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [data.budgets, data.expenses]);

  const expenseCard = (item: Expense) => (
    <Pressable key={item.id} style={styles.card} onLongPress={() => confirmDelete(item)}>
      <View style={styles.icon}><MaterialCommunityIcons name="arrow-up" size={19} color={Colors.danger} /></View>
      <View style={styles.body}><Text style={styles.name}>{item.budgetName}</Text><Text style={styles.meta}>{item.categoryName} • {item.fundSourceName}</Text><Text style={styles.date}>{item.date}{item.note ? ` • ${item.note}` : ''}</Text></View>
      <Text style={styles.amount}>-{formatRupiah(item.amount)}</Text>
    </Pressable>
  );

  const cashAllocationCard = (item: Budget) => (
    <View key={item.id} style={styles.card}>
      <View style={[styles.icon, styles.cashIcon]}><MaterialCommunityIcons name="cash-check" size={19} color={Colors.primary} /></View>
      <View style={styles.body}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.fundSourceName} • Alokasi Cash</Text><Text style={styles.date}>Sudah diserahkan dari halaman Budgeting</Text></View>
      <Text style={styles.cashAmount}>-{formatRupiah(item.realizedAmount)}</Text>
    </View>
  );

  const showForm = (budget?: Budget) => {
    setBudgetId(budget?.id ?? availableBudgets[0]?.id ?? directOptions[0]?.id ?? '');
    setAmount(null); setDate(todayISO()); setNote(''); setOpen(true);
  };

  const submit = async () => {
    if (saving) { return; }
    if (!selected || amount === null || !isValidISODate(date)) {
      Alert.alert('Data belum lengkap', 'Pilih budget, isi nominal, dan gunakan tanggal YYYY-MM-DD.');
      return;
    }
    const validation = validateExpense(amount, remainingForBudget(selected));
    if (isUnexpectedBudget(selected.id) && !note.trim()) {
      Alert.alert('Isi catatan belanja', 'Tuliskan kebutuhan yang dibayar agar dapat dievaluasi pada akhir bulan.');
      return;
    }
    if (validation) { Alert.alert('Nominal tidak valid', validation); return; }
    setSaving(true);
    try {
      if (direct) {
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

  return (
    <View style={styles.screen}>
      <AppHeader title="Pengeluaran" subtitle="Realisasi rencana dan belanja tak terduga" />
      <ScrollView contentContainerStyle={styles.content}>
        <SummaryCard label="Total realisasi (termasuk cash)" amount={total} tone="primary" />
        <Text style={styles.section}>Realisasi per kategori budget</Text>
        {categoryGroups.length === 0 ? <EmptyMessage icon="receipt-text-outline" title="Belum ada realisasi" message="Catat pengeluaran dari budget atau tandai alokasi cash yang sudah diserahkan." /> : categoryGroups.map(([id, group]) => (
          <View key={id} style={styles.group}>
            <View style={styles.groupHeader}><Text style={styles.groupTitle}>{group.name.toUpperCase()}</Text><Text style={styles.groupTotal}>{formatRupiah(group.total)}</Text></View>
            {group.expenses.map(expenseCard)}
            {group.cashAllocations.map(cashAllocationCard)}
          </View>
        ))}
        <Text style={styles.section}>Belanja Tak Terduga</Text>
        {unexpectedGroups.length === 0 ? <Text style={styles.emptyGroup}>Belum ada belanja tak terduga.</Text> : unexpectedGroups.map(([id, group]) => (
          <View key={id} style={styles.group}>
            <View style={styles.groupHeader}><Text style={styles.groupTitle}>{group.name.toUpperCase()}</Text><Text style={styles.groupTotal}>{formatRupiah(group.total)}</Text></View>
            {group.expenses.map(expenseCard)}
            {group.cashAllocations.map(cashAllocationCard)}
          </View>
        ))}
        {data.expenses.length > 0 ? <Text style={styles.hint}>Tahan transaksi untuk menghapus dan mengembalikan sisa budget.</Text> : null}
      </ScrollView>
      <FAB onPress={() => showForm()} label="Realisasi" />
      <FormModal visible={open} title="Tambah pengeluaran" onClose={() => { if (!saving) { setOpen(false); } }}>
        {options.length === 0 ? <EmptyMessage icon="check-all" title="Tidak ada budget tersedia" message="Semua budget transaksi sudah terealisasi atau belum dibuat." /> : (
          <>
            <Label>Item budgeting</Label><SelectField value={budgetId} onChange={setBudgetId} options={options} />
            {selected ? <View style={styles.budgetInfo}><Text style={styles.infoName}>{selected.name}</Text><Text style={styles.infoLine}>Kategori: {selected.categoryName}</Text><Text style={styles.infoLine}>Sumber dana: {selected.fundSourceName}</Text><View style={styles.infoNumbers}><Text>{direct ? (direct.source.type === 'debit' ? 'Saldo Debit tersedia' : 'Sisa limit tersedia') : 'Budget'} {formatRupiah(selected.amount)}</Text>{!direct ? <Text>Sisa {formatRupiah(remainingForBudget(selected))}</Text> : null}</View></View> : null}
            <Label>Nominal realisasi</Label><MoneyField value={amount} onChangeValue={setAmount} />
            <Label>Tanggal</Label><TextField value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
            <Label>{selected && isUnexpectedBudget(selected.id) ? 'Catatan belanja (wajib untuk evaluasi)' : 'Catatan (opsional)'}</Label><TextField value={note} onChangeText={setNote} multiline placeholder="Contoh: Perbaikan pompa air" />
            <FormActions saveLabel={saving ? 'Menyimpan...' : 'Simpan'} onSave={submit} onCancel={() => { if (!saving) { setOpen(false); } }} />
          </>
        )}
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingBottom: 100},
  section: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginTop: 24, marginBottom: 12},
  group: {marginBottom: 4},
  groupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 4},
  groupTitle: {fontSize: 13, fontWeight: '800', color: Colors.textPrimary, flex: 1},
  groupTotal: {fontSize: 12, fontWeight: '800', color: Colors.primary},
  emptyGroup: {fontSize: 12, color: Colors.textSecondary, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 16},
  cashIcon: {backgroundColor: Colors.primarySoft},
  cashAmount: {fontSize: 14, fontWeight: '900', color: Colors.primary},
  card: {flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 9, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface},
  icon: {width: 38, height: 38, borderRadius: 12, backgroundColor: Colors.dangerSoft, alignItems: 'center', justifyContent: 'center'},
  body: {flex: 1, marginLeft: 11}, name: {fontSize: 14, fontWeight: '800', color: Colors.textPrimary}, meta: {fontSize: 10, color: Colors.textSecondary, marginTop: 3}, date: {fontSize: 10, color: Colors.textSecondary, marginTop: 2},
  amount: {fontSize: 14, fontWeight: '900', color: Colors.danger}, hint: {fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 8},
  budgetInfo: {backgroundColor: Colors.primarySoft, borderRadius: 14, padding: 14, marginTop: 14}, infoName: {fontSize: 16, fontWeight: '800', color: Colors.primary}, infoLine: {fontSize: 12, color: Colors.textSecondary, marginTop: 4},
  infoNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12},
});
