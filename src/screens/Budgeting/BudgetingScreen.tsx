import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, FAB, ProgressBar, StatusPill, SummaryCard} from '../../components/FinanceUI';
import {FormActions, FormModal, Label, MoneyField, SelectField, TextField} from '../../components/FormUI';
import PrimaryButton from '../../components/Button/PrimaryButton';
import Colors from '../../constants/colors';
import {budgetStatus, fundSourceTypeForBudget, remainingForBudget} from '../../domain/budgeting';
import type {Budget, RealizationType} from '../../models';
import {
  copyBudgetsFromPreviousPeriod,
  deleteBudget,
  saveBudget,
  setCashAllocation,
  releaseBudgetRemainder,
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
  const {householdId, uid, activePeriodId, budgetCategories, fundSources, data, periods} = useBudget();
  const [open, setOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fundSourceId, setFundSourceId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [realizationType, setRealizationType] = useState<RealizationType>('transaction');
  const [note, setNote] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const total = data.budgets.reduce((sum, item) => sum + item.amount, 0);
  const grouped = useMemo(() => {
    const result = new Map<string, {name: string; items: Budget[]}>();
    data.budgets.forEach(item => {
      const current = result.get(item.categoryId);
      result.set(item.categoryId, {
        name: item.categoryName,
        items: [...(current?.items ?? []), item],
      });
    });
    return [...result.entries()];
  }, [data.budgets]);

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
    if (item && isUnexpectedBudget(item.id)) {
      Alert.alert('Belanja Tak Terduga', 'Nominal mengikuti transaksi Pengeluaran secara otomatis. Lihat rincian penggunaannya di Laporan.');
      return;
    }
    setEditing(item ?? null);
    setName(item?.name ?? '');
    setCategoryId(item?.categoryId ?? budgetCategories[0]?.id ?? '');
    setFundSourceId(item?.fundSourceId ?? fundSources[0]?.id ?? '');
    setAmount(item?.amount ?? null);
    setRealizationType(item?.realizationType ?? 'transaction');
    setNote(item?.note ?? '');
    setOpen(true);
  };

  const submit = async () => {
    const category = budgetCategories.find(item => item.id === categoryId);
    const source = fundSources.find(item => item.id === fundSourceId);
    if (!name.trim() || !category || !source || !amount || amount <= 0) {
      Alert.alert('Data belum lengkap', 'Isi nama, kategori, nominal, dan sumber dana.');
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
        realizationType, note: note.trim(),
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

  const confirmTransfer = (item: Budget) => {
    const remaining = remainingForBudget(item);
    const sourceType = fundSourceTypeForBudget(item, fundSources);
    const destination = sourceType === 'credit_card' ? `limit ${item.fundSourceName}` : 'saldo Debit';
    Alert.alert(`Kembalikan sisa ke ${destination}?`,
      `${formatRupiah(remaining)} dari ${item.name} akan kembali ke ${destination}. Budget asal menjadi ${formatRupiah(item.realizedAmount)}. Dana yang tersedia dapat digunakan untuk budget lain atau Belanja Tak Terduga.`, [
        {text: 'Batal', style: 'cancel'},
        {text: 'Kembalikan', onPress: async () => {
          setTransferring(true);
          try {
            await releaseBudgetRemainder(householdId, activePeriodId, uid, item.id, remaining);
            Alert.alert('Berhasil', `Sisa budget telah dikembalikan ke ${destination}.`);
          } catch (cause) {
            Alert.alert('Gagal mengembalikan saldo', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
          } finally { setTransferring(false); }
        }},
      ]);
  };

  const toggleCash = async (item: Budget) => {
    try {
      await setCashAllocation(householdId, activePeriodId, uid, item.id, !item.cashAllocated);
    } catch (cause) {
      Alert.alert('Gagal memperbarui', cause instanceof Error ? cause.message : 'Terjadi kesalahan.');
    }
  };

  const copyPrevious = async () => {
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
        <SummaryCard label="Total dana direncanakan" amount={total} tone="primary" />
        <Text style={styles.limitHelp}>Belanja Tak Terduga dapat langsung dicatat dari halaman Pengeluaran menggunakan saldo Debit atau sisa limit kartu yang belum dialokasikan.</Text>
        {data.budgets.length === 0 ? (
          <View>
            <EmptyMessage icon="clipboard-text-outline" title="Belum ada rencana" message="Buat budget pertama atau salin rencana rutin bulan sebelumnya." />
            <PrimaryButton title="Salin budget bulan sebelumnya" variant="secondary" onPress={copyPrevious} />
          </View>
        ) : grouped.map(([groupCategoryId, groupData]) => {
          const {name: category, items} = groupData;
          const categoryTotal = items.reduce((sum, item) => sum + item.amount, 0);
          const realized = items.reduce((sum, item) => sum + item.realizedAmount, 0);
          const isExpanded = expandedCategories.has(groupCategoryId);
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
                return (
                  <Pressable key={item.id} style={styles.item} onPress={() => showForm(item)} onLongPress={isUnexpectedBudget(item.id) ? undefined : () => confirmDelete(item)}>
                    <View style={styles.itemTop}>
                      <View style={styles.itemNameWrap}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemSource}>{item.fundSourceName} • {item.realizationType === 'cash_allocation' ? 'Alokasi cash' : 'Transaksi'}</Text></View>
                      <StatusPill status={status} />
                    </View>
                    <View style={styles.numbers}>
                      <Text style={styles.budgetAmount}>{formatRupiah(item.amount)}</Text>
                      <Text style={styles.remaining}>Sisa {formatRupiah(remainingForBudget(item))}</Text>
                    </View>
                    {item.amount === 0 && !isUnexpectedBudget(item.id) ? <Text style={styles.groupMeta}>Budget ditutup • {item.note}</Text> : null}
                    {!isUnexpectedBudget(item.id) && remainingForBudget(item) > 0 && ['debit', 'credit_card'].includes(fundSourceTypeForBudget(item, fundSources)) ? (
                      <Pressable accessibilityRole="button" disabled={transferring} style={styles.cashButton} onPress={event => { event.stopPropagation(); confirmTransfer(item); }}>
                        <Text style={styles.cashText}>{transferring ? 'Mengembalikan...' : fundSourceTypeForBudget(item, fundSources) === 'credit_card' ? 'Kembalikan sisa ke limit kredit' : 'Kembalikan sisa ke saldo Debit'}</Text>
                      </Pressable>
                    ) : null}
                    {item.realizationType === 'cash_allocation' && item.amount > 0 ? (
                      <Pressable style={[styles.cashButton, item.cashAllocated && styles.cashButtonDone]} onPress={() => toggleCash(item)}>
                        <MaterialCommunityIcons name={item.cashAllocated ? 'check-circle' : 'cash-check'} size={17} color={item.cashAllocated ? Colors.white : Colors.primary} />
                        <Text style={[styles.cashText, item.cashAllocated && styles.cashTextDone]}>{item.cashAllocated ? 'Sudah diserahkan' : 'Tandai sudah diserahkan'}</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              }) : null}
            </View>
          );
        })}
        {data.budgets.length > 0 ? <Pressable onPress={copyPrevious}><Text style={styles.copyLink}>Salin budget bulan sebelumnya</Text></Pressable> : null}
      </ScrollView>
      <FAB onPress={() => showForm()} label="Budget" />
      <FormModal visible={open} title={editing ? 'Edit budget' : 'Tambah budget'} onClose={() => setOpen(false)}>
        <Label>Nama kebutuhan</Label><TextField value={name} onChangeText={setName} placeholder="Contoh: Listrik" />
        <Label>Kategori</Label><SelectField value={categoryId} onChange={setCategoryId} options={budgetCategories.map(item => ({label: item.name, value: item.id}))} />
        <Label>Nominal budget</Label><MoneyField value={amount} onChangeValue={setAmount} />
        <Label>Sumber dana</Label><SelectField value={fundSourceId} onChange={setFundSourceId} options={fundSources.map(item => ({label: item.name, value: item.id}))} />
        <Label>Jenis realisasi</Label><SelectField value={realizationType} onChange={value => setRealizationType(value as RealizationType)} options={[{label: 'Transaksi', value: 'transaction'}, {label: 'Alokasi Cash', value: 'cash_allocation'}]} />
        <Label>Catatan (opsional)</Label><TextField value={note} onChangeText={setNote} multiline placeholder="Keterangan tambahan" />
        <FormActions saveLabel={editing ? 'Perbarui' : 'Simpan'} onSave={submit} onCancel={() => setOpen(false)} />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingBottom: 100},
  group: {marginTop: 12},
  groupButton: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15},
  groupButtonPressed: {opacity: 0.82},
  groupButtonExpanded: {borderColor: Colors.primary},
  groupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10},
  groupInfo: {flex: 1, marginRight: 12},
  groupTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  groupTitle: {fontSize: 13, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.5},
  itemCount: {minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center'},
  itemCountText: {fontSize: 11, fontWeight: '800', color: Colors.primary},
  groupMeta: {fontSize: 11, color: Colors.textSecondary, marginTop: 5},
  groupRight: {flexDirection: 'row', alignItems: 'center', gap: 7},
  groupTotal: {fontSize: 13, fontWeight: '800', color: Colors.primary},
  item: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginTop: 10},
  itemTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'}, itemNameWrap: {flex: 1, marginRight: 8},
  itemName: {fontSize: 16, fontWeight: '800', color: Colors.textPrimary}, itemSource: {fontSize: 11, color: Colors.textSecondary, marginTop: 4},
  numbers: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14}, budgetAmount: {fontSize: 19, fontWeight: '900', color: Colors.textPrimary}, remaining: {fontSize: 12, color: Colors.textSecondary},
  cashButton: {marginTop: 13, borderRadius: 10, backgroundColor: Colors.primarySoft, paddingVertical: 9, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center'},
  cashButtonDone: {backgroundColor: Colors.primary}, cashText: {fontSize: 12, color: Colors.primary, fontWeight: '800'}, cashTextDone: {color: Colors.white},
  copyLink: {textAlign: 'center', color: Colors.primary, fontWeight: '700', marginTop: 24},
  limitHelp: {fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 4},
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
});
