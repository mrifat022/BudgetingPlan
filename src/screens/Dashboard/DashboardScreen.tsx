import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import PrimaryButton from '../../components/Button/PrimaryButton';
import {
  ProgressBar,
  SectionTitle,
  SummaryCard,
} from '../../components/FinanceUI';
import Colors from '../../constants/colors';
import type { ActivityLog, HouseholdMember } from '../../models';
import { setPeriodClosed, subscribeActivities, subscribeMembers } from '../../services/firebase';
import {
  availableCreditLimit,
  fundSourceTypeForBudget,
  groupBudgets,
  summarizePeriod,
} from '../../domain/budgeting';
import { useBudget } from '../../state/BudgetContext';
import { formatRupiah } from '../../utils/currency';
import { useAuth } from '../../state/AuthContext';
import {periodLabel} from '../../utils/period';

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const {profile} = useAuth();
  const {
    data,
    previousPeriodData,
    fundSources,
    householdId,
    activePeriodId,
    activePeriod,
  } = useBudget();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [activityError, setActivityError] = useState('');
  useEffect(() => {
    if (!householdId || !activePeriodId) { setActivities([]); return; }
    setActivities([]);
    return subscribeActivities(householdId, activePeriodId, setActivities, setActivityError);
  }, [householdId, activePeriodId]);
  useEffect(() => {
    if (!householdId) { return; }
    return subscribeMembers(householdId, setMembers, setActivityError);
  }, [householdId]);
  const summary = useMemo(
    () => summarizePeriod(data, fundSources),
    [data, fundSources],
  );
  const sources = useMemo(
    () => groupBudgets(data.budgets, 'fundSource'),
    [data.budgets],
  );
  const monthlyChecklist = useMemo(() => {
    const creditSources = fundSources.filter(item => item.type === 'credit_card');
    return [
      {label: 'Pemasukan Debit sudah dicatat', done: data.incomes.length > 0},
      {label: 'Limit kartu kredit sudah diperbarui', done: creditSources.every(source => data.creditLimits.some(limit => limit.fundSourceId === source.id))},
      {label: 'Rencana budgeting sudah dibuat', done: data.budgets.length > 0},
      {label: 'Alokasi tidak melebihi dana tersedia', done: summary.unallocatedDebit >= 0 && summary.unallocatedCredit >= 0},
    ];
  }, [data.budgets.length, data.creditLimits, data.incomes.length, fundSources, summary.unallocatedCredit, summary.unallocatedDebit]);
  const completedChecklist = monthlyChecklist.filter(item => item.done).length;
  const changePeriodStatus = () => {
    if (!activePeriod || activePeriod.status === 'archived') { return; }
    const closing = activePeriod.status === 'active';
    Alert.alert(
      closing ? 'Tutup periode ini?' : 'Buka kembali periode?',
      closing
        ? `Data ${periodLabel(activePeriodId)} akan menjadi hanya-baca. Pemilik household dapat membukanya kembali.`
        : `Data ${periodLabel(activePeriodId)} akan dapat diubah kembali dari kedua perangkat.`,
      [
        {text: 'Batal', style: 'cancel'},
        {text: closing ? 'Tutup Periode' : 'Buka Kembali', onPress: async () => {
          try { await setPeriodClosed(householdId, activePeriodId, profile!.id, closing); }
          catch (cause) { Alert.alert('Gagal memperbarui periode', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
        }},
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <AppHeader
        title="Rifcazi Budget"
        subtitle="Rencana keuangan keluarga"
        logoSource={require('../../assets/branding/logo-icon.png')}
        onSettings={() => navigation.navigate('Settings')}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Sisa budget bulan ini</Text>
          <Text style={styles.heroAmount}>
            {formatRupiah(summary.remainingBudget)}
          </Text>
          <Text style={styles.heroSub}>dari total {formatRupiah(summary.totalBudget)}</Text>
          <ProgressBar value={summary.progress} color={Colors.accent} />
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              Terealisasi {Math.round(summary.progress * 100)}%
            </Text>
            <Text style={styles.progressText}>
              {formatRupiah(summary.budgetRealized)}
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          <SummaryCard
            label="Pemasukan Debit"
            amount={summary.totalIncome}
            style={styles.gridCard}
          />
          <SummaryCard
            label="Total budget"
            amount={summary.totalBudget}
            style={styles.gridCard}
          />
          <SummaryCard
            label="Realisasi"
            amount={summary.totalRealized}
            style={styles.gridCard}
          />
          <SummaryCard
            label="Sisa budget"
            amount={summary.remainingBudget}
            style={styles.gridCard}
          />
        </View>

        <View style={styles.unallocatedCard}>
          <Text style={styles.cardTitle}>Dana Belum Dialokasikan</Text>
          <View style={styles.allocationRow}><View style={[styles.allocationDot, styles.debitDot]} /><Text style={styles.allocationLabel}>Saldo Debit</Text><Text style={[styles.allocationValue, summary.unallocatedDebit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedDebit)}</Text></View>
          <View style={styles.allocationRow}><View style={[styles.allocationDot, styles.creditDot]} /><Text style={styles.allocationLabel}>Limit belum dialokasikan</Text><Text style={[styles.allocationValue, styles.creditValue, summary.unallocatedCredit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedCredit)}</Text></View>
        </View>

        <View style={styles.checklistCard}>
          <View style={styles.checklistTop}><Text style={styles.cardTitle}>Checklist Bulanan</Text><View style={styles.checklistBadge}><Text style={styles.checklistPercent}>{completedChecklist}/{monthlyChecklist.length}</Text></View></View>
          <View style={styles.checklistItems}>{monthlyChecklist.map(item => <View key={item.label} style={styles.checklistItem}><MaterialCommunityIcons name={item.done ? 'check-circle' : 'alert-circle-outline'} size={18} color={item.done ? Colors.success : Colors.warning} /><Text style={[styles.checklistLabel, item.done && styles.checklistDone]}>{item.label}</Text></View>)}</View>
        </View>
        {profile?.role === 'owner' && activePeriod?.status !== 'archived' ? <View style={styles.periodControl}><View style={styles.periodControlInfo}><MaterialCommunityIcons name={activePeriod?.status === 'closed' ? 'lock-outline' : 'lock-open-variant-outline'} size={21} color={Colors.primary} /><View style={styles.periodControlBody}><Text style={styles.periodControlTitle}>{activePeriod?.status === 'closed' ? 'Periode sudah ditutup' : 'Kunci laporan akhir bulan'}</Text><Text style={styles.periodControlText}>{activePeriod?.status === 'closed' ? 'Buka kembali hanya jika perlu memperbaiki data.' : 'Tutup periode agar data lama tidak berubah tanpa sengaja.'}</Text></View></View><PrimaryButton title={activePeriod?.status === 'closed' ? 'Buka kembali periode' : 'Tutup periode'} variant="secondary" onPress={changePeriodStatus} /></View> : null}

        <SectionTitle title="Ringkasan sumber dana" />
        {sources.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Belum ada budget pada periode ini.
            </Text>
          </View>
        ) : (
          sources.map(source => {
            const value = source.budget ? source.realized / source.budget : 0;
            const sourceMaster = fundSources.find(
              item => item.id === source.id,
            );
            const sampleBudget = data.budgets.find(
              item => item.fundSourceId === source.id,
            );
            const sourceType = sampleBudget
              ? fundSourceTypeForBudget(sampleBudget, fundSources)
              : sourceMaster?.type;
            const creditLimit =
              sourceType === 'credit_card'
                ? data.creditLimits.find(
                    item => item.fundSourceId === source.id,
                  )
                : undefined;
            return (
              <View key={source.id} style={styles.sourceCard}>
                <View style={styles.sourceHeader}>
                  <Text style={styles.sourceName}>{source.name}</Text>
                  <Text style={styles.sourceRemaining}>
                    {sourceType === 'credit_card'
                      ? creditLimit
                        ? `${formatRupiah(
                            creditLimit.amount - source.budget,
                          )} belum dialokasikan`
                        : 'Limit belum diatur'
                      : `${formatRupiah(source.remaining)} sisa budget`}
                  </Text>
                </View>
                <View style={styles.sourceNumbers}>
                  <Text style={styles.muted}>
                    Budget {formatRupiah(source.budget)}
                  </Text>
                  <Text style={styles.muted}>
                    Realisasi {formatRupiah(source.realized)}
                  </Text>
                </View>
                {creditLimit ? (
                  <Text style={styles.limitLine}>
                    Limit tersedia{' '}
                    {formatRupiah(
                      availableCreditLimit(
                        data,
                        source.id,
                        previousPeriodData,
                      ),
                    )}{' '}
                    • Plafon {formatRupiah(creditLimit.amount)}
                  </Text>
                ) : null}
                <ProgressBar value={value} />
              </View>
            );
          })
        )}
        <SectionTitle title="Aktivitas terbaru" />
        <Text style={styles.activityHint}>Perubahan data keluarga pada bulan aktif dari kedua perangkat.</Text>
        {activityError ? <Text style={styles.activityError}>{activityError}</Text> : null}
        {activities.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>Belum ada aktivitas tercatat.</Text></View>
        ) : activities.map(item => {
          const actor = members.find(member => member.id === item.createdBy)?.displayName ?? `Pengguna ${item.createdBy.slice(0, 6)}`;
          const time = item.createdAt?.toDate?.().toLocaleString('id-ID', {dateStyle: 'medium', timeStyle: 'short'}) ?? 'Baru saja';
          return <View key={item.id} style={styles.activityCard}>
            <View style={styles.activityDot} />
            <View style={styles.activityBody}>
              <Text style={styles.activityDescription}>{item.description}</Text>
              <Text style={styles.activityMeta}>{actor} • {time}</Text>
            </View>
          </View>;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 },
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: 24,
    padding: 20,
  },
  heroLabel: { color: '#D7EBE3', fontSize: 13, fontWeight: '700' },
  heroAmount: {
    color: Colors.white,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 7,
    letterSpacing: -0.8,
  },
  heroSub: {color: '#C9E4D9', fontSize: 12, marginTop: 4, marginBottom: 17},
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  progressText: { color: '#D7EBE3', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  gridCard: { width: '48.5%' },
  unallocatedCard: {backgroundColor: Colors.surface, borderRadius: 18, padding: 17, borderWidth: 1, borderColor: Colors.border, marginTop: 14},
  cardTitle: {fontSize: 14, fontWeight: '900', color: Colors.textPrimary},
  allocationRow: {flexDirection: 'row', alignItems: 'center', marginTop: 14},
  allocationDot: {width: 9, height: 9, borderRadius: 5, marginRight: 11},
  debitDot: {backgroundColor: Colors.primary}, creditDot: {backgroundColor: '#EE971C'},
  allocationLabel: {flex: 1, fontSize: 13, color: Colors.textSecondary},
  allocationValue: {fontSize: 14, fontWeight: '900', color: Colors.primary},
  creditValue: {color: '#EE971C'}, negative: {color: Colors.danger},
  checklistCard: {backgroundColor: Colors.surface, borderRadius: 18, padding: 17, borderWidth: 1, borderColor: Colors.border, marginTop: 14},
  checklistTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10},
  checklistBadge: {backgroundColor: Colors.primarySoft, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5},
  checklistPercent: {fontSize: 12, fontWeight: '900', color: Colors.primary},
  checklistItems: {marginTop: 12, gap: 9},
  checklistItem: {flexDirection: 'row', alignItems: 'center', gap: 8},
  checklistLabel: {fontSize: 12, color: Colors.textPrimary, flex: 1},
  checklistDone: {color: Colors.textSecondary, textDecorationLine: 'line-through'},
  periodControl: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 17, padding: 16, marginTop: 10},
  periodControlInfo: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 13},
  periodControlBody: {flex: 1, marginLeft: 10},
  periodControlTitle: {fontSize: 13, fontWeight: '800', color: Colors.textPrimary},
  periodControlText: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 3},
  sourceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 17,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceName: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  sourceRemaining: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  sourceNumbers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 13,
    marginBottom: 9,
  },
  muted: { fontSize: 11, color: Colors.textSecondary },
  limitLine: { fontSize: 11, color: Colors.textSecondary, marginBottom: 9 },
  emptyCard: { backgroundColor: Colors.surface, padding: 20, borderRadius: 16 },
  emptyText: { color: Colors.textSecondary, textAlign: 'center' },
  activityHint: {fontSize: 11, color: Colors.textSecondary, marginBottom: 10},
  activityError: {fontSize: 12, color: Colors.danger, marginBottom: 10},
  activityCard: {flexDirection: 'row', backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 8},
  activityDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6, marginRight: 11},
  activityBody: {flex: 1},
  activityDescription: {fontSize: 13, fontWeight: '700', color: Colors.textPrimary},
  activityMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 5},
});
