import React, { useMemo, useState } from 'react';
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
import PrimaryButton from '../../components/Button/PrimaryButton';
import { EmptyMessage, FAB, ProgressBar, SummaryCard } from '../../components/FinanceUI';
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
import {
  addMonthsToPeriod,
  buildInstallmentSchedule,
  canEditOrDeleteDebt,
} from '../../domain/debt';
import type {
  Debt,
  DebtInstallment,
  DebtOriginType,
  DebtType,
  Receivable,
} from '../../models';
import {
  accelerateDebtPayoff,
  createDebt,
  createReceivable,
  deleteDebt,
  deleteReceivable,
  recordReceivablePayment,
  updateDebt,
  updateDebtInstallmentAmount,
} from '../../services/firebase';
import { useBudget } from '../../state/BudgetContext';
import { formatRupiah } from '../../utils/currency';
import { isValidISODate, periodLabel, todayISO } from '../../utils/period';

function displayDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '-';
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function generatePeriodOptions(startPeriodId: string, count = 24) {
  const basePeriod = startPeriodId || todayISO().slice(0, 7);
  const options: Array<{ label: string; value: string }> = [];
  for (let i = 0; i < count; i++) {
    const pId = addMonthsToPeriod(basePeriod, i);
    options.push({ label: periodLabel(pId), value: pId });
  }
  return options;
}

export default function HutangPiutangScreen() {
  const {
    householdId,
    uid,
    activePeriodId,
    fundSources,
    debts,
    receivables,
    data,
    isPeriodReadOnly,
  } = useBudget();

  const [activeTab, setActiveTab] = useState<'hutang' | 'piutang'>('hutang');

  // Modal Hutang Form
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [debtName, setDebtName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('one_time');
  const [originType, setOriginType] = useState<DebtOriginType>('purchase');
  const [fundSourceId, setFundSourceId] = useState('');
  const [inputMode, setInputMode] = useState<'total' | 'monthly'>('total');
  const [inputAmount, setInputAmount] = useState<number | null>(null);
  const [tenor, setTenor] = useState('6');
  const [startPeriodId, setStartPeriodId] = useState(activePeriodId || todayISO().slice(0, 7));
  const [debtNote, setDebtNote] = useState('');

  // Modal Debt Detail
  const [selectedDebtDetail, setSelectedDebtDetail] = useState<Debt | null>(null);

  // Modal Edit Installment Amount
  const [editInstallmentModalOpen, setEditInstallmentModalOpen] = useState(false);
  const [editingInstallment, setEditingInstallment] = useState<DebtInstallment | null>(null);
  const [newInstallmentAmount, setNewInstallmentAmount] = useState<number | null>(null);

  // Modal Piutang Form
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [debtorName, setDebtorName] = useState('');
  const [recAmount, setRecAmount] = useState<number | null>(null);
  const [recDate, setRecDate] = useState(todayISO());
  const [recDueDate, setRecDueDate] = useState('');
  const [hasDueDate, setHasDueDate] = useState(false);
  const [recNote, setRecNote] = useState('');

  // Modal Record Payment for Piutang
  const [payRecModalOpen, setPayRecModalOpen] = useState(false);
  const [targetReceivable, setTargetReceivable] = useState<Receivable | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<number | null>(null);
  const [receivedDate, setReceivedDate] = useState(todayISO());

  const periodOptions = useMemo(
    () => generatePeriodOptions(activePeriodId || todayISO().slice(0, 7), 24),
    [activePeriodId],
  );

  const eligibleFundSources = useMemo(
    () =>
      fundSources.filter(
        item => item.type === 'debit' || item.type === 'credit_card',
      ),
    [fundSources],
  );

  const fundSourceOptions = useMemo(
    () =>
      eligibleFundSources.map(s => ({
        label: `${s.name} (${s.type === 'debit' ? 'Debit' : 'Kartu Kredit'})`,
        value: s.id,
      })),
    [eligibleFundSources],
  );

  // Calculations for Hutang Summary
  const debtSummary = useMemo(() => {
    const activeDebts = debts.filter(d => d.status === 'active');
    const totalActive = activeDebts.reduce((sum, d) => sum + d.totalAmount, 0);
    const totalPaid = activeDebts.reduce((sum, d) => {
      const paid = d.installments
        .filter(inst => inst.status === 'paid')
        .reduce((s, inst) => s + inst.amount, 0);
      return sum + paid;
    }, 0);
    const totalRemaining = Math.max(0, totalActive - totalPaid);
    return {
      totalActive,
      totalPaid,
      totalRemaining,
    };
  }, [debts]);

  // Calculations for Piutang Summary
  const receivableSummary = useMemo(() => {
    const total = receivables.reduce((sum, r) => sum + r.amount, 0);
    const paid = receivables.reduce((sum, r) => sum + r.paidAmount, 0);
    const remaining = Math.max(0, total - paid);
    return {
      total,
      paid,
      remaining,
    };
  }, [receivables]);

  // Preview installment schedule
  const previewSchedule = useMemo(() => {
    if (!inputAmount || inputAmount <= 0) {
      return null;
    }
    const parsedTenor = parseInt(tenor, 10);
    if (debtType === 'installment' && (!parsedTenor || parsedTenor < 1)) {
      return null;
    }
    const t = debtType === 'one_time' ? 1 : Math.max(1, parsedTenor || 1);
    return buildInstallmentSchedule({
      debtId: 'preview',
      debtType,
      inputMode,
      inputAmount,
      tenor: t,
      startPeriodId: startPeriodId || activePeriodId || todayISO().slice(0, 7),
    });
  }, [debtType, inputMode, inputAmount, tenor, startPeriodId, activePeriodId]);

  // Form Handlers
  const openCreateDebt = () => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk menambah data.',
      );
      return;
    }
    setEditingDebt(null);
    setDebtName('');
    setDebtType('one_time');
    setOriginType('purchase');
    setFundSourceId(eligibleFundSources[0]?.id ?? '');
    setInputMode('total');
    setInputAmount(null);
    setTenor('6');
    setStartPeriodId(activePeriodId || todayISO().slice(0, 7));
    setDebtNote('');
    setDebtModalOpen(true);
  };

  const openEditDebt = (debt: Debt) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk mengubah data.',
      );
      return;
    }
    if (!canEditOrDeleteDebt(debt, data.budgets)) {
      Alert.alert(
        'Hutang Tidak Dapat Diubah',
        'Hutang tidak dapat diubah karena sudah ada cicilan yang terealisasi. Hapus transaksi terkait di Pengeluaran terlebih dahulu.',
      );
      return;
    }
    setEditingDebt(debt);
    setDebtName(debt.name);
    setDebtType(debt.debtType);
    setOriginType(debt.originType);
    setFundSourceId(debt.fundSourceId);
    setInputMode('total');
    setInputAmount(debt.totalAmount);
    setTenor(String(debt.tenor));
    setStartPeriodId(debt.startPeriodId);
    setDebtNote(debt.note || '');
    setDebtModalOpen(true);
  };

  const handleSaveDebt = async () => {
    if (!debtName.trim()) {
      Alert.alert('Nama Hutang Wajib', 'Masukkan nama atau deskripsi hutang.');
      return;
    }
    if (!inputAmount || inputAmount <= 0) {
      Alert.alert('Nominal Tidak Valid', 'Masukkan nominal hutang yang valid.');
      return;
    }
    const selectedSource = eligibleFundSources.find(s => s.id === fundSourceId) ?? eligibleFundSources[0];
    if (!selectedSource) {
      Alert.alert('Sumber Dana Wajib', 'Pilih sumber dana pembayaran hutang.');
      return;
    }
    const parsedTenor = parseInt(tenor, 10);
    if (debtType === 'installment' && (!parsedTenor || parsedTenor < 1)) {
      Alert.alert('Tenor Tidak Valid', 'Masukkan jumlah bulan tenor cicilan (minimal 1).');
      return;
    }
    const safeTenor = debtType === 'one_time' ? 1 : Math.max(1, parsedTenor || 1);
    const schedule = buildInstallmentSchedule({
      debtId: editingDebt?.id ?? 'temp',
      debtType,
      inputMode,
      inputAmount,
      tenor: safeTenor,
      startPeriodId: startPeriodId || activePeriodId || todayISO().slice(0, 7),
    });

    try {
      if (editingDebt) {
        await updateDebt(householdId, uid, editingDebt.id, {
          name: debtName.trim(),
          debtType,
          originType,
          fundSourceId: selectedSource.id,
          fundSourceName: selectedSource.name,
          fundSourceType: selectedSource.type,
          totalAmount: schedule.totalAmount,
          tenor: safeTenor,
          startPeriodId: startPeriodId || activePeriodId || todayISO().slice(0, 7),
          installments: schedule.installments,
          note: debtNote.trim(),
        });
      } else {
        await createDebt(householdId, uid, {
          name: debtName.trim(),
          debtType,
          originType,
          fundSourceId: selectedSource.id,
          fundSourceName: selectedSource.name,
          fundSourceType: selectedSource.type,
          totalAmount: schedule.totalAmount,
          tenor: safeTenor,
          startPeriodId: startPeriodId || activePeriodId || todayISO().slice(0, 7),
          installments: schedule.installments,
          note: debtNote.trim(),
        });
      }
      setDebtModalOpen(false);
      setSelectedDebtDetail(null);
    } catch (err) {
      Alert.alert('Gagal Menyimpan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const handleDeleteDebt = (debt: Debt) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk menghapus data.',
      );
      return;
    }
    if (!canEditOrDeleteDebt(debt, data.budgets)) {
      Alert.alert(
        'Hutang Tidak Dapat Dihapus',
        'Hutang tidak dapat dihapus karena sudah ada cicilan yang terealisasi. Hapus transaksi terkait di Pengeluaran terlebih dahulu.',
      );
      return;
    }
    Alert.alert(
      'Hapus Hutang?',
      `Hapus ${debt.name} beserta seluruh jadwal cicilannya?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDebt(householdId, uid, debt);
              setSelectedDebtDetail(null);
            } catch (err) {
              Alert.alert('Gagal Menghapus', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            }
          },
        },
      ],
    );
  };

  const handleAcceleratePayoff = (debt: Debt) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk mengubah data.',
      );
      return;
    }
    const unpaidList = debt.installments
      .slice(0, debt.effectiveTenor)
      .filter(i => i.status === 'unpaid');
    if (unpaidList.length < 2) {
      Alert.alert(
        'Tidak Dapat Dipercepat',
        'Percepatan pelunasan membutuhkan minimal 2 termin yang belum lunas.',
      );
      return;
    }
    const targetInstallment = unpaidList[0];
    const totalRemaining = unpaidList.reduce((s, i) => s + i.amount, 0);

    Alert.alert(
      'Lunasi Semua Sisa Cicilan?',
      `Seluruh sisa cicilan (${formatRupiah(totalRemaining)}) akan digabungkan ke termin ${targetInstallment.index} pada periode ${periodLabel(targetInstallment.periodId)}.\n\nTermin bulan berikutnya (${targetInstallment.index + 1} s.d. ${debt.effectiveTenor}) akan dihapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Lunasi Sekarang',
          style: 'default',
          onPress: async () => {
            try {
              await accelerateDebtPayoff(householdId, uid, debt.id, targetInstallment.index);
              setSelectedDebtDetail(null);
            } catch (err) {
              Alert.alert('Gagal Mempercepat', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            }
          },
        },
      ],
    );
  };

  const handleOpenEditInstallment = (inst: DebtInstallment) => {
    setEditingInstallment(inst);
    setNewInstallmentAmount(inst.amount);
    setEditInstallmentModalOpen(true);
  };

  const handleSaveInstallmentAmount = async () => {
    if (!selectedDebtDetail || !editingInstallment || !newInstallmentAmount || newInstallmentAmount <= 0) {
      Alert.alert('Nominal Tidak Valid', 'Masukkan nominal yang valid.');
      return;
    }
    try {
      await updateDebtInstallmentAmount(
        householdId,
        uid,
        selectedDebtDetail.id,
        editingInstallment.index,
        Math.round(newInstallmentAmount),
      );
      setEditInstallmentModalOpen(false);
      // Update selected detail modal locally
      const updatedInsts = selectedDebtDetail.installments.map(item =>
        item.index === editingInstallment.index
          ? { ...item, amount: Math.round(newInstallmentAmount) }
          : item,
      );
      const newTotal = updatedInsts.reduce((s, i) => s + i.amount, 0);
      setSelectedDebtDetail({
        ...selectedDebtDetail,
        installments: updatedInsts,
        totalAmount: newTotal,
      });
    } catch (err) {
      Alert.alert('Gagal Mengubah Termin', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  // Piutang Form Handlers
  const openCreateReceivable = () => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk menambah data.',
      );
      return;
    }
    setDebtorName('');
    setRecAmount(null);
    setRecDate(todayISO());
    setRecDueDate('');
    setHasDueDate(false);
    setRecNote('');
    setRecModalOpen(true);
  };

  const handleSaveReceivable = async () => {
    if (!debtorName.trim()) {
      Alert.alert('Nama Peminjam Wajib', 'Masukkan nama peminjam.');
      return;
    }
    if (!recAmount || recAmount <= 0) {
      Alert.alert('Nominal Tidak Valid', 'Masukkan nominal piutang yang valid.');
      return;
    }
    if (!isValidISODate(recDate)) {
      Alert.alert('Tanggal Tidak Valid', 'Pilih tanggal pemberian pinjaman yang valid.');
      return;
    }
    if (hasDueDate && recDueDate && !isValidISODate(recDueDate)) {
      Alert.alert('Jatuh Tempo Tidak Valid', 'Pilih tanggal jatuh tempo yang valid.');
      return;
    }

    try {
      await createReceivable(householdId, uid, {
        debtorName: debtorName.trim(),
        amount: Math.round(recAmount),
        date: recDate,
        dueDate: hasDueDate && recDueDate ? recDueDate : undefined,
        note: recNote.trim(),
      });
      setRecModalOpen(false);
    } catch (err) {
      Alert.alert('Gagal Menyimpan Piutang', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const openRecordPaymentModal = (rec: Receivable) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk mencatat penerimaan.',
      );
      return;
    }
    const remaining = rec.amount - rec.paidAmount;
    setTargetReceivable(rec);
    setReceivedAmount(remaining);
    setReceivedDate(todayISO());
    setPayRecModalOpen(true);
  };

  const handleSavePayment = async () => {
    if (!targetReceivable || !receivedAmount || receivedAmount <= 0) {
      Alert.alert('Nominal Tidak Valid', 'Masukkan nominal yang diterima.');
      return;
    }
    if (!isValidISODate(receivedDate)) {
      Alert.alert('Tanggal Tidak Valid', 'Pilih tanggal penerimaan yang valid.');
      return;
    }

    try {
      await recordReceivablePayment(
        householdId,
        uid,
        targetReceivable.id,
        Math.round(receivedAmount),
        receivedDate,
      );
      setPayRecModalOpen(false);
    } catch (err) {
      Alert.alert('Gagal Mencatat Pembayaran', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const handleDeleteReceivable = (rec: Receivable) => {
    if (isPeriodReadOnly) {
      Alert.alert(
        'Periode Hanya Baca',
        'Buka kembali periode di Dashboard untuk menghapus data.',
      );
      return;
    }
    if (rec.paidAmount > 0 || (rec.payments && rec.payments.length > 0)) {
      Alert.alert(
        'Tidak Dapat Dihapus',
        'Piutang yang sudah menerima pembayaran tidak dapat dihapus.',
      );
      return;
    }
    Alert.alert(
      'Hapus Piutang?',
      `Hapus piutang kepada ${rec.debtorName} sebesar ${formatRupiah(rec.amount)}?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReceivable(householdId, uid, rec);
            } catch (err) {
              Alert.alert('Gagal Menghapus', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <AppHeader
        title="Hutang & Piutang"
        subtitle="Kelola pinjaman dan piutang keluarga"
      />

      <View style={styles.tabSwitchContainer}>
        <SegmentedField
          value={activeTab}
          onChange={val => setActiveTab(val as 'hutang' | 'piutang')}
          options={[
            { label: 'Hutang', value: 'hutang' },
            { label: 'Piutang', value: 'piutang' },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {activeTab === 'hutang' ? (
          <>
            {/* Hutang Summary */}
            <View style={styles.summaryGrid}>
              <SummaryCard
                label="Hutang Aktif"
                amount={debtSummary.totalActive}
                style={styles.summaryCardItem}
              />
              <SummaryCard
                label="Sudah Dibayar"
                amount={debtSummary.totalPaid}
                tone="primary"
                style={styles.summaryCardItem}
              />
              <SummaryCard
                label="Sisa Hutang"
                amount={debtSummary.totalRemaining}
                tone="warning"
                style={styles.summaryCardItem}
              />
            </View>

            {/* List of Debts */}
            {debts.length === 0 ? (
              <EmptyMessage
                icon="handshake-outline"
                title="Belum Ada Hutang"
                message="Catat hutang sekali bayar atau cicilan untuk memantau jadwal pembayarannya secara otomatis."
              />
            ) : (
              debts.map(debt => {
                const paid = debt.installments
                  .filter(inst => inst.status === 'paid')
                  .reduce((sum, inst) => sum + inst.amount, 0);
                const remaining = Math.max(0, debt.totalAmount - paid);
                const paidCount = debt.installments.filter(i => i.status === 'paid').length;
                const progress = debt.totalAmount > 0 ? paid / debt.totalAmount : 0;
                const isPaidFull = debt.status === 'paid' || remaining === 0;

                return (
                  <Pressable
                    key={debt.id}
                    style={styles.debtCard}
                    onPress={() => setSelectedDebtDetail(debt)}>
                    <View style={styles.debtCardHeader}>
                      <View style={styles.debtCardTitleArea}>
                        <Text style={styles.debtCardTitle}>{debt.name}</Text>
                        <View style={styles.badgeRow}>
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>
                              {debt.debtType === 'one_time'
                                ? 'Sekali Bayar'
                                : `Cicilan ${paidCount}/${debt.effectiveTenor} bln`}
                            </Text>
                          </View>
                          <View style={[styles.badge, styles.badgeSecondary]}>
                            <Text style={styles.badgeTextSecondary}>
                              {debt.originType === 'cash_loan'
                                ? 'Pinjaman Dana'
                                : 'Belanja Non-Tunai'}
                            </Text>
                          </View>
                          <View style={[styles.badge, styles.badgeNeutral]}>
                            <Text style={styles.badgeTextNeutral}>
                              {debt.fundSourceName}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          isPaidFull ? styles.statusPillPaid : styles.statusPillActive,
                        ]}>
                        <Text
                          style={[
                            styles.statusPillText,
                            isPaidFull ? styles.statusTextPaid : styles.statusTextActive,
                          ]}>
                          {isPaidFull ? 'Lunas' : 'Aktif'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.progressContainer}>
                      <ProgressBar
                        value={progress}
                        color={isPaidFull ? Colors.success : Colors.primary}
                      />
                    </View>

                    <View style={styles.amountRow}>
                      <View>
                        <Text style={styles.amountLabel}>Terbayar</Text>
                        <Text style={styles.amountValuePaid}>{formatRupiah(paid)}</Text>
                      </View>
                      <View style={styles.amountRight}>
                        <Text style={styles.amountLabel}>Sisa Hutang</Text>
                        <Text style={styles.amountValueRemaining}>{formatRupiah(remaining)}</Text>
                      </View>
                    </View>

                    {debt.note ? (
                      <Text style={styles.cardNote} numberOfLines={2}>
                        {debt.note}
                      </Text>
                    ) : null}

                    <View style={styles.cardFooter}>
                      <Text style={styles.cardDetailLink}>Lihat Jadwal Cicilan →</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </>
        ) : (
          <>
            {/* Piutang Summary */}
            <View style={styles.summaryGrid}>
              <SummaryCard
                label="Total Piutang"
                amount={receivableSummary.total}
                style={styles.summaryCardItem}
              />
              <SummaryCard
                label="Sudah Diterima"
                amount={receivableSummary.paid}
                tone="primary"
                style={styles.summaryCardItem}
              />
              <SummaryCard
                label="Sisa Piutang"
                amount={receivableSummary.remaining}
                tone="warning"
                style={styles.summaryCardItem}
              />
            </View>

            {/* List of Receivables */}
            {receivables.length === 0 ? (
              <EmptyMessage
                icon="account-cash-outline"
                title="Belum Ada Piutang"
                message="Catat uang yang dipinjamkan kepada orang lain untuk memantau pengembaliannya."
              />
            ) : (
              receivables.map(rec => {
                const remaining = Math.max(0, rec.amount - rec.paidAmount);
                const progress = rec.amount > 0 ? rec.paidAmount / rec.amount : 0;
                const isPaid = rec.status === 'paid' || remaining === 0;

                return (
                  <View key={rec.id} style={styles.debtCard}>
                    <View style={styles.debtCardHeader}>
                      <View style={styles.debtCardTitleArea}>
                        <Text style={styles.debtCardTitle}>{rec.debtorName}</Text>
                        <Text style={styles.recDateText}>
                          Dipinjamkan: {displayDate(rec.date)}
                        </Text>
                        {rec.dueDate ? (
                          <Text style={styles.recDueDateText}>
                            Jatuh tempo: {displayDate(rec.dueDate)}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          isPaid
                            ? styles.statusPillPaid
                            : rec.paidAmount > 0
                            ? styles.statusPillPartial
                            : styles.statusPillActive,
                        ]}>
                        <Text
                          style={[
                            styles.statusPillText,
                            isPaid
                              ? styles.statusTextPaid
                              : rec.paidAmount > 0
                              ? styles.statusTextPartial
                              : styles.statusTextActive,
                          ]}>
                          {isPaid ? 'Lunas' : rec.paidAmount > 0 ? 'Sebagian' : 'Belum Lunas'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.progressContainer}>
                      <ProgressBar
                        value={progress}
                        color={isPaid ? Colors.success : Colors.primary}
                      />
                    </View>

                    <View style={styles.amountRow}>
                      <View>
                        <Text style={styles.amountLabel}>Total Pinjaman</Text>
                        <Text style={styles.amountValueNeutral}>{formatRupiah(rec.amount)}</Text>
                      </View>
                      <View>
                        <Text style={styles.amountLabel}>Diterima</Text>
                        <Text style={styles.amountValuePaid}>{formatRupiah(rec.paidAmount)}</Text>
                      </View>
                      <View style={styles.amountRight}>
                        <Text style={styles.amountLabel}>Sisa</Text>
                        <Text style={styles.amountValueRemaining}>{formatRupiah(remaining)}</Text>
                      </View>
                    </View>

                    {rec.note ? (
                      <Text style={styles.cardNote}>{rec.note}</Text>
                    ) : null}

                    <View style={styles.recActionRow}>
                      {!isPaid && !isPeriodReadOnly ? (
                        <Pressable
                          style={styles.payButton}
                          onPress={() => openRecordPaymentModal(rec)}>
                          <MaterialCommunityIcons
                            name="check-circle-outline"
                            size={16}
                            color={Colors.primary}
                          />
                          <Text style={styles.payButtonText}>Sudah Dibayar</Text>
                        </Pressable>
                      ) : null}
                      {rec.paidAmount === 0 && (!rec.payments || rec.payments.length === 0) && !isPeriodReadOnly ? (
                        <Pressable
                          style={styles.deleteButton}
                          onPress={() => handleDeleteReceivable(rec)}>
                          <MaterialCommunityIcons
                            name="trash-can-outline"
                            size={16}
                            color={Colors.danger}
                          />
                          <Text style={styles.deleteButtonText}>Hapus</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {!isPeriodReadOnly ? (
        <FAB
          onPress={activeTab === 'hutang' ? openCreateDebt : openCreateReceivable}
          label={activeTab === 'hutang' ? 'Tambah Hutang' : 'Tambah Piutang'}
        />
      ) : null}

      {/* MODAL: Tambah / Edit Hutang */}
      <FormModal
        visible={debtModalOpen}
        title={editingDebt ? 'Edit Hutang' : 'Tambah Hutang'}
        onClose={() => setDebtModalOpen(false)}>
        <Label>Nama Hutang</Label>
        <TextField
          placeholder="Misal: Cicilan Motor, Pinjam Saudara"
          value={debtName}
          onChangeText={setDebtName}
        />

        <Label>Jenis Hutang</Label>
        <SegmentedField
          value={debtType}
          onChange={val => setDebtType(val as DebtType)}
          options={[
            { label: 'Sekali Bayar', value: 'one_time' },
            { label: 'Cicilan Bulanan', value: 'installment' },
          ]}
        />

        <Label>Asal Hutang</Label>
        <SelectField
          value={originType}
          onChange={val => setOriginType(val as DebtOriginType)}
          options={[
            { label: 'Belanja / Non-Tunai', value: 'purchase' },
            {
              label: 'Pinjaman Dana (Masuk Saldo Debit)',
              value: 'cash_loan',
            },
          ]}
        />

        <Label>Sumber Dana Pembayaran</Label>
        <SelectField
          value={fundSourceId}
          onChange={setFundSourceId}
          options={fundSourceOptions}
        />

        {debtType === 'one_time' ? (
          <>
            <Label>Nominal Hutang</Label>
            <MoneyField value={inputAmount} onChangeValue={setInputAmount} />

            <Label>Bulan Jatuh Tempo</Label>
            <SelectField
              value={startPeriodId}
              onChange={setStartPeriodId}
              options={periodOptions}
            />
          </>
        ) : (
          <>
            <Label>Mode Perhitungan</Label>
            <SegmentedField
              value={inputMode}
              onChange={val => setInputMode(val as 'total' | 'monthly')}
              options={[
                { label: 'Dari Total Hutang', value: 'total' },
                { label: 'Dari Cicilan per Bulan', value: 'monthly' },
              ]}
            />

            <Label>
              {inputMode === 'total' ? 'Total Nominal Hutang' : 'Nominal Cicilan per Bulan'}
            </Label>
            <MoneyField value={inputAmount} onChangeValue={setInputAmount} />

            <Label>Tenor Cicilan (Bulan)</Label>
            <TextField
              placeholder="Jumlah bulan (misal: 6, 10, 18, 24)"
              value={tenor}
              onChangeText={text => setTenor(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />

            <Label>Bulan Cicilan Pertama (1/N)</Label>
            <SelectField
              value={startPeriodId}
              onChange={setStartPeriodId}
              options={periodOptions}
            />

            {previewSchedule ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>Pratinjau Jadwal Cicilan</Text>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Total Hutang:</Text>
                  <Text style={styles.previewValue}>
                    {formatRupiah(previewSchedule.totalAmount)}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Cicilan / Bulan:</Text>
                  <Text style={styles.previewValue}>
                    {formatRupiah(previewSchedule.installments[0]?.amount ?? 0)}
                  </Text>
                </View>
                {previewSchedule.installments.length > 1 &&
                previewSchedule.installments[previewSchedule.installments.length - 1]
                  .amount !== previewSchedule.installments[0].amount ? (
                  <Text style={styles.previewNote}>
                    * Termin terakhir:{' '}
                    {formatRupiah(
                      previewSchedule.installments[
                        previewSchedule.installments.length - 1
                      ].amount,
                    )}{' '}
                    (termasuk selisih pembulatan).
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        <Label>Catatan (opsional)</Label>
        <TextField
          placeholder="Catatan tambahan / nomor perjanjian"
          value={debtNote}
          onChangeText={setDebtNote}
          multiline
        />

        <FormActions
          saveLabel="Simpan Hutang"
          onSave={handleSaveDebt}
          onCancel={() => setDebtModalOpen(false)}
        />
      </FormModal>

      {/* MODAL: Detail & Jadwal Cicilan */}
      <FormModal
        visible={Boolean(selectedDebtDetail)}
        title={selectedDebtDetail?.name ?? 'Detail Hutang'}
        onClose={() => setSelectedDebtDetail(null)}>
        {selectedDebtDetail ? (
          <View>
            <View style={styles.detailHeaderCard}>
              <View style={styles.detailHeaderRow}>
                <Text style={styles.detailHeaderLabel}>Total Hutang</Text>
                <Text style={styles.detailHeaderValue}>
                  {formatRupiah(selectedDebtDetail.totalAmount)}
                </Text>
              </View>
              <View style={styles.detailHeaderRow}>
                <Text style={styles.detailHeaderLabel}>Sumber Dana</Text>
                <Text style={styles.detailHeaderValue}>
                  {selectedDebtDetail.fundSourceName}
                </Text>
              </View>
              <View style={styles.detailHeaderRow}>
                <Text style={styles.detailHeaderLabel}>Jenis & Asal</Text>
                <Text style={styles.detailHeaderValue}>
                  {selectedDebtDetail.debtType === 'one_time' ? 'Sekali Bayar' : 'Cicilan'}{' '}
                  •{' '}
                  {selectedDebtDetail.originType === 'cash_loan'
                    ? 'Pinjaman Dana'
                    : 'Belanja Non-Tunai'}
                </Text>
              </View>
            </View>

            <Text style={styles.scheduleTitle}>Jadwal Termin Pembayaran</Text>
            {selectedDebtDetail.installments
              .slice(0, selectedDebtDetail.effectiveTenor)
              .map(inst => {
                const isPaid = inst.status === 'paid';
                return (
                  <View key={inst.index} style={styles.installmentRow}>
                    <View style={styles.installmentInfo}>
                      <Text style={styles.installmentIndex}>
                        {selectedDebtDetail.debtType === 'one_time'
                          ? 'Jatuh Tempo'
                          : `Termin ${inst.index}/${selectedDebtDetail.effectiveTenor}`}
                      </Text>
                      <Text style={styles.installmentPeriod}>
                        {periodLabel(inst.periodId)}
                      </Text>
                    </View>

                    <View style={styles.installmentRight}>
                      <Text style={styles.installmentAmount}>
                        {formatRupiah(inst.amount)}
                      </Text>
                      <View
                        style={[
                          styles.statusPillSmall,
                          isPaid ? styles.statusPillPaid : styles.statusPillActive,
                        ]}>
                        <Text
                          style={[
                            styles.statusPillTextSmall,
                            isPaid ? styles.statusTextPaid : styles.statusTextActive,
                          ]}>
                          {isPaid ? 'Lunas' : 'Belum'}
                        </Text>
                      </View>
                    </View>

                    {!isPaid && !isPeriodReadOnly ? (
                      <Pressable
                        style={styles.editInstallmentBtn}
                        onPress={() => handleOpenEditInstallment(inst)}>
                        <MaterialCommunityIcons
                          name="pencil-outline"
                          size={16}
                          color={Colors.primary}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

            {/* Tombol Lunasi Semua Sisa Cicilan */}
            {selectedDebtDetail.debtType === 'installment' &&
            selectedDebtDetail.installments
              .slice(0, selectedDebtDetail.effectiveTenor)
              .filter(i => i.status === 'unpaid').length >= 2 &&
            !isPeriodReadOnly ? (
              <View style={styles.accelerateBtnContainer}>
                <PrimaryButton
                  title="Lunasi Semua Sisa Cicilan"
                  variant="secondary"
                  onPress={() => handleAcceleratePayoff(selectedDebtDetail)}
                />
              </View>
            ) : null}

            {/* Tombol Edit & Hapus Hutang */}
            {!isPeriodReadOnly ? (
              <View style={styles.detailActionsRow}>
                <Pressable
                  style={styles.detailEditBtn}
                  onPress={() => openEditDebt(selectedDebtDetail)}>
                  <MaterialCommunityIcons
                    name="pencil-outline"
                    size={18}
                    color={Colors.primary}
                  />
                  <Text style={styles.detailEditBtnText}>Edit Hutang</Text>
                </Pressable>
                <Pressable
                  style={styles.detailDeleteBtn}
                  onPress={() => handleDeleteDebt(selectedDebtDetail)}>
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={18}
                    color={Colors.danger}
                  />
                  <Text style={styles.detailDeleteBtnText}>Hapus Hutang</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </FormModal>

      {/* MODAL: Edit Nominal Termin */}
      <FormModal
        visible={editInstallmentModalOpen}
        title={`Edit Termin ${editingInstallment?.index}`}
        onClose={() => setEditInstallmentModalOpen(false)}>
        <Text style={styles.helperText}>
          Ubah nominal cicilan untuk termin periode{' '}
          {editingInstallment ? periodLabel(editingInstallment.periodId) : ''}{' '}
          (misal jika ada penyesuaian tagihan atau denda).
        </Text>
        <Label>Nominal Baru</Label>
        <MoneyField
          value={newInstallmentAmount}
          onChangeValue={setNewInstallmentAmount}
        />
        <FormActions
          saveLabel="Simpan Nominal"
          onSave={handleSaveInstallmentAmount}
          onCancel={() => setEditInstallmentModalOpen(false)}
        />
      </FormModal>

      {/* MODAL: Tambah Piutang */}
      <FormModal
        visible={recModalOpen}
        title="Catat Piutang Baru"
        onClose={() => setRecModalOpen(false)}>
        <Label>Nama Peminjam</Label>
        <TextField
          placeholder="Nama teman / keluarga"
          value={debtorName}
          onChangeText={setDebtorName}
        />

        <Label>Nominal Piutang</Label>
        <MoneyField value={recAmount} onChangeValue={setRecAmount} />

        <Label>Tanggal Dipinjamkan</Label>
        <DateField value={recDate} onChange={setRecDate} />

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setHasDueDate(!hasDueDate)}>
          <MaterialCommunityIcons
            name={hasDueDate ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={20}
            color={Colors.primary}
          />
          <Text style={styles.checkboxLabel}>Atur Tanggal Jatuh Tempo</Text>
        </Pressable>

        {hasDueDate ? (
          <>
            <Label>Tanggal Jatuh Tempo</Label>
            <DateField
              value={recDueDate || todayISO()}
              onChange={setRecDueDate}
            />
          </>
        ) : null}

        <Label>Catatan (opsional)</Label>
        <TextField
          placeholder="Keperluan / keterangan pinjaman"
          value={recNote}
          onChangeText={setRecNote}
          multiline
        />

        <FormActions
          saveLabel="Simpan Piutang"
          onSave={handleSaveReceivable}
          onCancel={() => setRecModalOpen(false)}
        />
      </FormModal>

      {/* MODAL: Konfirmasi Pembayaran Piutang */}
      <FormModal
        visible={payRecModalOpen}
        title="Terima Pembayaran Piutang"
        onClose={() => setPayRecModalOpen(false)}>
        {targetReceivable ? (
          <View>
            <View style={styles.payNoticeBox}>
              <MaterialCommunityIcons
                name="information-outline"
                size={20}
                color={Colors.primary}
              />
              <Text style={styles.payNoticeText}>
                Pembayaran otomatis dicatat ke Pemasukan kategori{' '}
                <Text style={styles.boldText}>Piutang</Text> pada periode tanggal
                tersebut dan menambah Saldo Debit Anda.
              </Text>
            </View>

            <View style={styles.targetRecBox}>
              <Text style={styles.targetRecDebtor}>
                {targetReceivable.debtorName}
              </Text>
              <Text style={styles.targetRecRemaining}>
                Sisa Piutang: {formatRupiah(targetReceivable.amount - targetReceivable.paidAmount)}
              </Text>
            </View>

            <Label>Nominal Diterima</Label>
            <MoneyField
              value={receivedAmount}
              onChangeValue={setReceivedAmount}
            />

            <Label>Tanggal Diterima</Label>
            <DateField value={receivedDate} onChange={setReceivedDate} />

            <FormActions
              saveLabel="Konfirmasi Pembayaran"
              onSave={handleSavePayment}
              onCancel={() => setPayRecModalOpen(false)}
            />
          </View>
        ) : null}
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  tabSwitchContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  content: {
    padding: 16,
    paddingBottom: 90,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryCardItem: {
    flex: 1,
  },
  debtCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  debtCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  debtCardTitleArea: {
    flex: 1,
    marginRight: 8,
  },
  debtCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  badgeSecondary: {
    backgroundColor: '#E8F1FC',
  },
  badgeTextSecondary: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D64BA',
  },
  badgeNeutral: {
    backgroundColor: '#F0F2F1',
  },
  badgeTextNeutral: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillPaid: {
    backgroundColor: '#E6F8F0',
  },
  statusPillActive: {
    backgroundColor: '#FFF4E5',
  },
  statusPillPartial: {
    backgroundColor: '#FFF9E6',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusTextPaid: {
    color: Colors.success,
  },
  statusTextActive: {
    color: Colors.warning,
  },
  statusTextPartial: {
    color: '#B78103',
  },
  progressContainer: {
    marginTop: 12,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  amountLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  amountValueNeutral: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  amountValuePaid: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
  },
  amountRight: {
    alignItems: 'flex-end',
  },
  amountValueRemaining: {
    fontSize: 13,
    fontWeight: '900',
    color: Colors.warning,
  },
  cardNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 8,
    fontStyle: 'italic',
  },
  cardFooter: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: 'flex-end',
  },
  cardDetailLink: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  recDateText: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  recDueDateText: {
    fontSize: 11,
    color: Colors.warning,
    marginTop: 2,
  },
  recActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B9DCCE',
  },
  payButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FDECEC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
  },
  previewBox: {
    backgroundColor: '#F6F9F8',
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  previewLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  previewValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  previewNote: {
    fontSize: 11,
    color: Colors.warning,
    marginTop: 6,
    fontStyle: 'italic',
  },
  detailHeaderCard: {
    backgroundColor: '#F7FAFA',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailHeaderLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  detailHeaderValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  installmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  installmentInfo: {
    flex: 1,
  },
  installmentIndex: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  installmentPeriod: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  installmentRight: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  installmentAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statusPillSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 2,
  },
  statusPillTextSmall: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  editInstallmentBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.primarySoft,
  },
  accelerateBtnContainer: {
    marginTop: 14,
    marginBottom: 8,
  },
  detailActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  detailEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B9DCCE',
  },
  detailEditBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  detailDeleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FDECEC',
    paddingVertical: 10,
    borderRadius: 12,
  },
  detailDeleteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },
  helperText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
  },
  checkboxLabel: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  payNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.primarySoft,
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#B9DCCE',
  },
  payNoticeText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '800',
  },
  targetRecBox: {
    backgroundColor: '#F7FAFA',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  targetRecDebtor: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  targetRecRemaining: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
    marginTop: 4,
  },
});
