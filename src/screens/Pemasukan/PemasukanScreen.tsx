import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, FAB, ProgressBar, SectionTitle, SummaryCard} from '../../components/FinanceUI';
import {FormActions, FormModal, Label, MoneyField, SelectField, TextField} from '../../components/FormUI';
import Colors from '../../constants/colors';
import type {FundSource, Income} from '../../models';
import {deleteIncome, saveCreditLimit, saveIncome} from '../../services/firebase';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {isValidISODate, periodLabel, todayISO} from '../../utils/period';

export default function PemasukanScreen() {
  const {householdId, uid, activePeriodId, incomeCategories, fundSources, data} = useBudget();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [limitSource, setLimitSource] = useState<FundSource | null>(null);
  const [limitAmount, setLimitAmount] = useState<number | null>(null);
  const total = data.incomes.reduce((sum, item) => sum + item.amount, 0);
  const creditSources = fundSources.filter(item => item.type === 'credit_card');

  const showLimitForm = (source: FundSource) => {
    const current = data.creditLimits.find(item => item.fundSourceId === source.id);
    setLimitSource(source);
    setLimitAmount(current?.amount ?? source.monthlyLimit ?? null);
  };

  const submitLimit = async () => {
    if (!limitSource || !limitAmount || limitAmount <= 0) {
      Alert.alert('Limit belum diisi', 'Masukkan limit kartu kredit yang tersedia untuk periode ini.');
      return;
    }
    try {
      await saveCreditLimit(householdId, activePeriodId, uid, limitSource, limitAmount);
      setLimitSource(null);
    } catch (cause) {
      Alert.alert('Gagal menyimpan limit', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    }
  };

  const showForm = (item?: Income) => {
    setEditing(item ?? null);
    setCategoryId(item?.categoryId ?? incomeCategories[0]?.id ?? '');
    setAmount(item?.amount ?? null);
    setDate(item?.date ?? todayISO());
    setNote(item?.note ?? '');
    setOpen(true);
  };

  const submit = async () => {
    const category = incomeCategories.find(item => item.id === categoryId);
    if (!category || !amount || amount <= 0 || !isValidISODate(date)) {
      Alert.alert('Data belum lengkap', 'Pilih kategori, isi nominal, dan gunakan tanggal YYYY-MM-DD.');
      return;
    }
    try {
      await saveIncome(householdId, activePeriodId, uid, {
        categoryId: category.id, categoryName: category.name, amount, date, note: note.trim(),
      }, editing?.id);
      setOpen(false);
    } catch (cause) {
      Alert.alert('Gagal menyimpan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    }
  };

  const confirmDelete = (item: Income) => Alert.alert('Hapus pemasukan?', `${item.categoryName} • ${formatRupiah(item.amount)}`, [
    {text: 'Batal', style: 'cancel'},
    {text: 'Hapus', style: 'destructive', onPress: () => deleteIncome(householdId, activePeriodId, item.id)},
  ]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Pemasukan" subtitle="Dana tersedia sebelum direncanakan" />
      <ScrollView contentContainerStyle={styles.content}>
        <SummaryCard label="Total pemasukan" amount={total} tone="primary" />
        <Text style={styles.section}>Daftar pemasukan</Text>
        {data.incomes.length === 0 ? <EmptyMessage icon="cash-plus" title="Belum ada pemasukan" message="Masukkan pemasukan untuk memulai rencana bulan ini." /> : data.incomes.map(item => (
          <Pressable key={item.id} style={styles.card} onPress={() => showForm(item)} onLongPress={() => confirmDelete(item)}>
            <View style={styles.icon}><MaterialCommunityIcons name="arrow-down" size={20} color={Colors.primary} /></View>
            <View style={styles.cardBody}>
              <Text style={styles.name}>{item.categoryName}</Text>
              <Text style={styles.meta}>{item.date}{item.note ? ` • ${item.note}` : ''}</Text>
            </View>
            <Text style={styles.amount}>{formatRupiah(item.amount)}</Text>
          </Pressable>
        ))}
        {data.incomes.length > 0 ? <Text style={styles.hint}>Ketuk untuk edit • tahan untuk hapus</Text> : null}
        {creditSources.length > 0 ? <SectionTitle title="Limit kartu kredit bulan ini" /> : null}
        {creditSources.map(source => {
          const current = data.creditLimits.find(item => item.fundSourceId === source.id);
          const allocated = data.budgets.filter(item => item.fundSourceId === source.id).reduce((sum, item) => sum + item.amount, 0);
          return (
            <Pressable key={source.id} style={styles.limitCard} onPress={() => showLimitForm(source)}>
              <View style={styles.limitTop}>
                <View><Text style={styles.limitName}>{source.name}</Text><Text style={styles.limitPeriod}>{periodLabel(activePeriodId)}</Text></View>
                <MaterialCommunityIcons name="pencil-outline" size={20} color={Colors.primary} />
              </View>
              {current ? <>
                <Text style={styles.limitAmount}>{formatRupiah(current.amount)}</Text>
                <View style={styles.limitNumbers}><Text style={styles.limitMeta}>Dialokasikan {formatRupiah(allocated)}</Text><Text style={styles.limitRemaining}>Sisa limit {formatRupiah(current.amount - allocated)}</Text></View>
                <ProgressBar value={current.amount ? allocated / current.amount : 0} />
              </> : <Text style={styles.limitUnset}>Ketuk untuk mengisi limit tersedia</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
      <FAB onPress={() => showForm()} />
      <FormModal visible={open} title={editing ? 'Edit pemasukan' : 'Tambah pemasukan'} onClose={() => setOpen(false)}>
        <Label>Kategori pemasukan</Label>
        <SelectField value={categoryId} onChange={setCategoryId} options={incomeCategories.map(item => ({label: item.name, value: item.id}))} />
        <Label>Nominal</Label><MoneyField value={amount} onChangeValue={setAmount} />
        <Label>Tanggal</Label><TextField value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
        <Label>Catatan (opsional)</Label><TextField value={note} onChangeText={setNote} multiline placeholder="Contoh: Gaji bulan Agustus" />
        <FormActions saveLabel={editing ? 'Perbarui' : 'Simpan'} onSave={submit} onCancel={() => setOpen(false)} />
      </FormModal>
      <FormModal visible={Boolean(limitSource)} title="Limit kartu kredit" onClose={() => setLimitSource(null)}>
        <Text style={styles.limitHelp}>Masukkan limit yang tersedia dari bank untuk {periodLabel(activePeriodId)}. Nilai ini tidak dihitung sebagai saldo atau tabungan.</Text>
        <Label>Kartu kredit</Label><TextField value={limitSource?.name ?? ''} editable={false} />
        <Label>Limit tersedia</Label><MoneyField value={limitAmount} onChangeValue={setLimitAmount} />
        <FormActions onSave={submitLimit} onCancel={() => setLimitSource(null)} />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingBottom: 92},
  section: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginTop: 24, marginBottom: 12},
  card: {flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 14, marginBottom: 9},
  icon: {width: 38, height: 38, borderRadius: 12, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center'},
  cardBody: {flex: 1, marginLeft: 12}, name: {fontSize: 15, fontWeight: '800', color: Colors.textPrimary},
  meta: {fontSize: 11, color: Colors.textSecondary, marginTop: 4}, amount: {fontSize: 15, fontWeight: '800', color: Colors.primary},
  hint: {fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 8},
  limitCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 9},
  limitTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  limitName: {fontSize: 15, fontWeight: '800', color: Colors.textPrimary}, limitPeriod: {fontSize: 10, color: Colors.textSecondary, marginTop: 3},
  limitAmount: {fontSize: 23, fontWeight: '900', color: Colors.textPrimary, marginTop: 13},
  limitNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 9},
  limitMeta: {fontSize: 10, color: Colors.textSecondary}, limitRemaining: {fontSize: 10, color: Colors.primary, fontWeight: '700'},
  limitUnset: {fontSize: 12, color: Colors.warning, fontWeight: '700', marginTop: 14},
  limitHelp: {fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 4},
});
