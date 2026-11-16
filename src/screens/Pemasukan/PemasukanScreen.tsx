import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import { EmptyMessage, FAB } from '../../components/FinanceUI';
import {
  DateField,
  FormActions,
  FormModal,
  Label,
  MoneyField,
  SegmentedField,
  SelectField,
  TextField,
} from '../../components/FormUI';
import Colors from '../../constants/colors';
import { availableCreditLimit } from '../../domain/budgeting';
import type { FundSource, Income } from '../../models';
import {
  deleteIncome,
  recordFullCreditPayment,
  saveCreditLimit,
  saveIncome,
} from '../../services/firebase';
import { useBudget } from '../../state/BudgetContext';
import { formatRupiah } from '../../utils/currency';
import { isValidISODate, periodLabel, todayISO } from '../../utils/period';

export default function PemasukanScreen() {
  const {
    householdId,
    uid,
    activePeriodId,
    incomeCategories,
    fundSources,
    data,
    previousPeriodData,
    isPeriodReadOnly,
  } = useBudget();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [limitSource, setLimitSource] = useState<FundSource | null>(null);
  const [limitAmount, setLimitAmount] = useState<number | null>(null);
  const [limitMode, setLimitMode] = useState<'opening' | 'payment'>('opening');
  const [availableBeforePayment, setAvailableBeforePayment] = useState<
    number | null
  >(null);
  const [paymentBalanceEdited, setPaymentBalanceEdited] = useState(false);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const total = data.incomes.reduce((sum, item) => sum + item.amount, 0);
  const creditSources = fundSources.filter(item => item.type === 'credit_card');
  const displayDate = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

  const showLimitForm = (source: FundSource) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode hanya-baca',
        'Buka kembali periode dari Dashboard untuk mengubah limit.',
      );
      return;
    }
    const current = data.creditLimits.find(
      item => item.fundSourceId === source.id,
    );
    setLimitSource(source);
    setLimitAmount(current?.amount ?? source.monthlyLimit ?? null);
    setLimitMode(current ? 'payment' : 'opening');
    setAvailableBeforePayment(
      current
        ? availableCreditLimit(data, source.id, previousPeriodData)
        : null,
    );
    setPaymentBalanceEdited(false);
    setPaymentDate(todayISO());
  };

  const submitPayment = async () => {
    if (
      !limitSource ||
      availableBeforePayment === null ||
      !isValidISODate(paymentDate)
    ) {
      Alert.alert(
        'Data belum lengkap',
        'Isi limit sebelum pembayaran dan tanggal pembayaran.',
      );
      return;
    }
    try {
      const paid = await recordFullCreditPayment(
        householdId,
        activePeriodId,
        uid,
        limitSource,
        availableBeforePayment,
        paymentDate,
        paymentBalanceEdited,
      );
      setLimitSource(null);
      Alert.alert(
        'Pembayaran tercatat',
        `${formatRupiah(paid)} dikurangi dari saldo Debit. Limit ${
          limitSource.name
        } kembali penuh dan tidak dihitung sebagai pengeluaran.`,
      );
    } catch (cause) {
      Alert.alert(
        'Gagal mencatat pembayaran',
        cause instanceof Error ? cause.message : 'Terjadi kesalahan.',
      );
    }
  };

  const submitLimit = async () => {
    if (!limitSource || !limitAmount || limitAmount <= 0) {
      Alert.alert(
        'Limit belum diisi',
        'Masukkan limit kartu kredit yang tersedia untuk periode ini.',
      );
      return;
    }
    try {
      await saveCreditLimit(
        householdId,
        activePeriodId,
        uid,
        limitSource,
        limitAmount,
      );
      setLimitSource(null);
    } catch (cause) {
      Alert.alert(
        'Gagal menyimpan limit',
        cause instanceof Error ? cause.message : 'Terjadi kesalahan.',
      );
    }
  };

  useEffect(() => {
    if (
      !limitSource ||
      limitMode !== 'payment' ||
      paymentBalanceEdited
    ) {
      return;
    }
    setAvailableBeforePayment(
      availableCreditLimit(data, limitSource.id, previousPeriodData),
    );
  }, [data, limitMode, limitSource, paymentBalanceEdited, previousPeriodData]);

  const showForm = (item?: Income) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode hanya-baca',
        'Buka kembali periode dari Dashboard untuk mengubah pemasukan.',
      );
      return;
    }
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
      Alert.alert(
        'Data belum lengkap',
        'Pilih kategori, isi nominal, dan pilih tanggal yang valid.',
      );
      return;
    }
    try {
      await saveIncome(
        householdId,
        activePeriodId,
        uid,
        {
          categoryId: category.id,
          categoryName: category.name,
          amount,
          date,
          note: note.trim(),
        },
        editing?.id,
      );
      setOpen(false);
    } catch (cause) {
      Alert.alert(
        'Gagal menyimpan',
        cause instanceof Error ? cause.message : 'Terjadi kesalahan.',
      );
    }
  };

  const confirmDelete = (item: Income) =>
    Alert.alert(
      'Hapus pemasukan?',
      `${item.categoryName} • ${formatRupiah(item.amount)}`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => deleteIncome(householdId, activePeriodId, item.id),
        },
      ],
    );

  const showActions = (item: Income) =>
    Alert.alert(
      item.categoryName,
      `${formatRupiah(item.amount)} • ${item.date}`,
      isPeriodReadOnly
        ? [{ text: 'Tutup' }]
        : [
            { text: 'Batal', style: 'cancel' },
            { text: 'Edit', onPress: () => showForm(item) },
            {
              text: 'Hapus',
              style: 'destructive',
              onPress: () => confirmDelete(item),
            },
          ],
    );

  return (
    <View style={styles.screen}>
      <AppHeader
        title="Pemasukan"
        subtitle="Dana tersedia sebelum direncanakan"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total Pemasukan Debit</Text>
          <Text style={styles.heroAmount}>{formatRupiah(total)}</Text>
          <Text style={styles.heroMeta}>
            {data.incomes.length} transaksi bulan ini
          </Text>
        </View>
        {creditSources.map(source => {
          const current = data.creditLimits.find(
            item => item.fundSourceId === source.id,
          );
          const allocated = data.budgets
            .filter(item => item.fundSourceId === source.id)
            .reduce((sum, item) => sum + item.amount, 0);
          const availableNow = availableCreditLimit(
            data,
            source.id,
            previousPeriodData,
          );
          return (
            <Pressable
              key={source.id}
              style={styles.limitCard}
              onPress={() => showLimitForm(source)}
            >
              <View style={styles.limitTop}>
                <View>
                  <Text style={styles.limitName}>{source.name}</Text>
                  <Text style={styles.limitPeriod}>
                    Kapasitas pinjaman kartu kredit
                  </Text>
                </View>
                <View style={styles.updateButton}>
                  <Text style={styles.updateText}>
                    {current ? 'Bayar / Atur' : 'Atur'}
                  </Text>
                </View>
              </View>
              {current ? (
                <>
                  <View style={styles.limitDivider} />
                  <View style={styles.limitValueRow}>
                    <Text style={styles.limitValueLabel}>
                      Limit tersedia saat ini
                    </Text>
                    <Text style={styles.limitAmount}>
                      {formatRupiah(availableNow)}
                    </Text>
                  </View>
                  <Text style={styles.limitMeta}>
                    Plafon budgeting: {formatRupiah(current.amount)} • Sisa
                    setelah dialokasikan:{' '}
                    {formatRupiah(current.amount - allocated)}. Limit bukan
                    pemasukan.
                  </Text>
                </>
              ) : (
                <Text style={styles.limitUnset}>
                  Ketuk untuk mengisi limit tersedia
                </Text>
              )}
            </Pressable>
          );
        })}
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Daftar Pemasukan</Text>
            <Text style={styles.listCount}>{data.incomes.length} item</Text>
          </View>
          {data.incomes.length === 0 ? (
            <EmptyMessage
              icon="cash-plus"
              title="Belum ada pemasukan"
              message="Masukkan pemasukan untuk memulai rencana bulan ini."
            />
          ) : (
            data.incomes.map((item, index) => (
              <Pressable
                key={item.id}
                style={[styles.card, index > 0 && styles.cardBorder]}
                onPress={() => showActions(item)}
              >
                <View style={styles.icon}>
                  <MaterialCommunityIcons
                    name="currency-usd"
                    size={21}
                    color={Colors.primary}
                  />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.name}>{item.categoryName}</Text>
                  <Text style={styles.meta}>
                    {displayDate(item.date)}
                    {item.note ? ` • ${item.note}` : ''}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatRupiah(item.amount)}</Text>
                <MaterialCommunityIcons
                  name="dots-vertical"
                  size={20}
                  color={Colors.textSecondary}
                />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
      {!isPeriodReadOnly ? <FAB onPress={() => showForm()} /> : null}
      <FormModal
        visible={open}
        title={editing ? 'Edit pemasukan' : 'Tambah pemasukan'}
        onClose={() => setOpen(false)}
      >
        <Label>Kategori pemasukan</Label>
        <SelectField
          value={categoryId}
          onChange={setCategoryId}
          options={incomeCategories.map(item => ({
            label: item.name,
            value: item.id,
          }))}
        />
        <Label>Nominal</Label>
        <MoneyField value={amount} onChangeValue={setAmount} />
        <Label>Tanggal</Label>
        <DateField value={date} onChange={setDate} />
        <Label>Catatan (opsional)</Label>
        <TextField
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Contoh: Gaji bulan Agustus"
        />
        <FormActions
          saveLabel={editing ? 'Perbarui Pemasukan' : 'Simpan Pemasukan'}
          onSave={submit}
          onCancel={() => setOpen(false)}
        />
      </FormModal>
      <FormModal
        visible={Boolean(limitSource)}
        title="Limit kartu kredit"
        onClose={() => setLimitSource(null)}
      >
        <Label>Kartu kredit</Label>
        <TextField value={limitSource?.name ?? ''} editable={false} />
        <Label>Tindakan</Label>
        <SegmentedField
          value={limitMode}
          onChange={value => setLimitMode(value as 'opening' | 'payment')}
          options={[
            { label: 'Atur Plafon', value: 'opening' },
            { label: 'Bayar Tagihan', value: 'payment' },
          ]}
        />
        {limitMode === 'opening' ? (
          <>
            <Text style={styles.limitHelp}>
              Atur plafon budgeting kartu untuk {periodLabel(activePeriodId)}.
              Gunakan ini saat pertama kali menyiapkan kartu atau melakukan
              koreksi.
            </Text>
            <Label>Plafon kartu kredit</Label>
            <MoneyField value={limitAmount} onChangeValue={setLimitAmount} />
            <FormActions
              saveLabel="Simpan Plafon"
              onSave={submitLimit}
              onCancel={() => setLimitSource(null)}
            />
          </>
        ) : (
          <>
            <Text style={styles.limitHelp}>
              Masukkan limit aktual tepat sebelum pembayaran. Sistem menghitung
              pelunasan sampai plafon penuh, mengurangi saldo Debit, dan
              menandai transaksi kartu sampai tanggal pembayaran sebagai lunas.
            </Text>
            <Label>Limit sebelum pembayaran</Label>
            <MoneyField
              value={availableBeforePayment}
              onChangeValue={value => {
                setAvailableBeforePayment(value);
                setPaymentBalanceEdited(true);
              }}
            />
            <Label>Tanggal pembayaran</Label>
            <DateField value={paymentDate} onChange={setPaymentDate} />
            <View style={styles.paymentPreview}>
              <Text style={styles.paymentPreviewLabel}>
                Tagihan yang dibayar
              </Text>
              <Text style={styles.paymentPreviewValue}>
                {formatRupiah(
                  Math.max(
                    0,
                    (limitAmount ?? 0) - (availableBeforePayment ?? 0),
                  ),
                )}
              </Text>
            </View>
            <FormActions
              saveLabel="Catat Pembayaran"
              onSave={submitPayment}
              onCancel={() => setLimitSource(null)}
            />
          </>
        )}
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 92 },
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
  },
  heroLabel: { fontSize: 13, color: '#D7EBE3', fontWeight: '700' },
  heroAmount: {
    fontSize: 34,
    color: Colors.white,
    fontWeight: '900',
    marginTop: 7,
    letterSpacing: -0.8,
  },
  heroMeta: { fontSize: 11, color: '#C9E4D9', marginTop: 5 },
  listCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 19,
    overflow: 'hidden',
    marginTop: 14,
  },
  listHeader: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  listTitle: { fontSize: 14, fontWeight: '900', color: Colors.textPrimary },
  listCount: { fontSize: 11, color: Colors.textSecondary },
  card: {
    minHeight: 75,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  meta: {
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  amount: { fontSize: 14, fontWeight: '900', color: Colors.primary },
  limitCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 19,
    padding: 17,
    marginBottom: 10,
  },
  limitTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  limitName: { fontSize: 14, fontWeight: '900', color: Colors.textPrimary },
  limitPeriod: { fontSize: 11, color: Colors.textSecondary, marginTop: 3 },
  updateButton: {
    borderWidth: 1,
    borderColor: '#B9DCCE',
    backgroundColor: Colors.primarySoft,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  updateText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  limitDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },
  limitValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  limitValueLabel: { fontSize: 12, color: Colors.textSecondary },
  limitAmount: { fontSize: 20, fontWeight: '900', color: '#EE971C' },
  limitMeta: {
    fontSize: 9,
    lineHeight: 14,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  limitUnset: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '700',
    marginTop: 14,
  },
  limitHelp: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  paymentPreview: {
    marginTop: 16,
    padding: 15,
    borderRadius: 14,
    backgroundColor: Colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentPreviewLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '700',
  },
  paymentPreviewValue: {
    fontSize: 17,
    color: Colors.primary,
    fontWeight: '900',
  },
});
