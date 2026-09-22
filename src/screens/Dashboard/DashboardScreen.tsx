import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import AppHeader from '../../components/AppHeader';
import {
  ProgressBar,
  SectionTitle,
  SummaryCard,
} from '../../components/FinanceUI';
import Colors from '../../constants/colors';
import type { ActivityLog, HouseholdMember } from '../../models';
import { subscribeActivities, subscribeMembers } from '../../services/firebase';
import {
  fundSourceTypeForBudget,
  groupBudgets,
  summarizePeriod,
} from '../../domain/budgeting';
import { useBudget } from '../../state/BudgetContext';
import { formatRupiah } from '../../utils/currency';

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { data, fundSources, householdId, activePeriodId } = useBudget();
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
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {Math.round(summary.progress * 100)}% terealisasi
            </Text>
            <Text style={styles.progressText}>
              {formatRupiah(summary.totalRealized)} /{' '}
              {formatRupiah(summary.totalBudget)}
            </Text>
          </View>
          <ProgressBar value={summary.progress} color="#F4C542" />
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

        <SectionTitle title="Belum dialokasikan" />
        <View style={styles.gridNoTop}>
          <SummaryCard
            label="Saldo Debit"
            amount={summary.unallocatedDebit}
            tone={summary.unallocatedDebit < 0 ? 'warning' : 'default'}
            style={styles.gridCard}
          />
          <SummaryCard
            label="Limit Kartu Kredit"
            amount={summary.unallocatedCredit}
            tone={summary.unallocatedCredit < 0 ? 'warning' : 'default'}
            style={styles.gridCard}
          />
        </View>
        <Text style={styles.allocationHint}>
          Sisa Debit dapat dialokasikan ke tabungan atau belanja tak terduga. Sisa
          limit kartu kredit hanya kembali menjadi limit tersedia.
        </Text>

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
                          )} sisa limit`
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
                    Limit tersedia {formatRupiah(creditLimit.amount)}
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
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: 22,
    padding: 20,
    marginTop: 2,
  },
  heroLabel: { color: '#D7EBE3', fontSize: 13, fontWeight: '600' },
  heroAmount: {
    color: Colors.white,
    fontSize: 31,
    fontWeight: '900',
    marginTop: 7,
    letterSpacing: -0.8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  progressText: { color: '#D7EBE3', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  gridNoTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCard: { width: '48.5%' },
  allocationHint: {
    fontSize: 11,
    lineHeight: 17,
    color: Colors.textSecondary,
    marginTop: 9,
  },
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
