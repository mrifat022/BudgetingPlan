import React, {useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View, Pressable} from 'react-native';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, ProgressBar, StatusPill, SummaryCard} from '../../components/FinanceUI';
import Colors from '../../constants/colors';
import {budgetStatus, fundSourceTypeForBudget, groupBudgets, remainingForBudget, summarizePeriod} from '../../domain/budgeting';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {isUnexpectedBudget} from '../../domain/unexpected';

export default function LaporanScreen() {
  const {data, fundSources} = useBudget();
  const [groupBy, setGroupBy] = useState<'category' | 'fundSource'>('category');
  const summary = useMemo(() => summarizePeriod(data, fundSources), [data, fundSources]);
  const groups = useMemo(() => groupBudgets(data.budgets, groupBy), [data.budgets, groupBy]);
  const unrealized = data.budgets.filter(item => item.realizedAmount === 0);
  const unexpectedBudgets = data.budgets.filter(item => isUnexpectedBudget(item.id));
  const unexpectedExpenses = data.expenses.filter(item => isUnexpectedBudget(item.budgetId));

  return (
    <View style={styles.screen}>
      <AppHeader title="Laporan" subtitle="Budgeting dibandingkan dengan realisasi" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          <SummaryCard label="Pemasukan Debit" amount={summary.totalIncome} style={styles.gridCard} />
          <SummaryCard label="Budget" amount={summary.totalBudget} style={styles.gridCard} />
          <SummaryCard label="Realisasi" amount={summary.totalRealized} style={styles.gridCard} />
          <SummaryCard label="Sisa" amount={summary.remainingBudget} tone="primary" style={styles.gridCard} />
        </View>

        <Text style={styles.section}>Alokasi Debit dan Kredit</Text>
        <View style={styles.fundingCard}>
          <Text style={styles.fundingTitle}>DEBIT / REKENING</Text>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Saldo dari pemasukan</Text><Text style={styles.fundingValue}>{formatRupiah(summary.totalIncome)}</Text></View>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Sudah dialokasikan</Text><Text style={styles.fundingValue}>{formatRupiah(summary.debitBudget)}</Text></View>
          <View style={styles.fundingDivider} />
          <View style={styles.fundingRow}><Text style={styles.fundingStrong}>Belum dialokasikan</Text><Text style={[styles.fundingStrong, summary.unallocatedDebit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedDebit)}</Text></View>
          <Text style={styles.fundingHint}>Dana ini dapat dialokasikan ke tabungan atau belanja tak terduga.</Text>
        </View>
        <View style={styles.fundingCard}>
          <Text style={styles.fundingTitle}>KARTU KREDIT</Text>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Limit tersedia</Text><Text style={styles.fundingValue}>{formatRupiah(summary.totalCreditLimit)}</Text></View>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Sudah dialokasikan</Text><Text style={styles.fundingValue}>{formatRupiah(summary.creditBudget)}</Text></View>
          <View style={styles.fundingDivider} />
          <View style={styles.fundingRow}><Text style={styles.fundingStrong}>Sisa limit belum dialokasikan</Text><Text style={[styles.fundingStrong, summary.unallocatedCredit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedCredit)}</Text></View>
          <Text style={styles.fundingHint}>Sisa ini adalah limit kredit, bukan saldo yang dapat ditabung.</Text>
        </View>

        <View style={styles.tabs}>
          <Pressable style={[styles.tab, groupBy === 'category' && styles.activeTab]} onPress={() => setGroupBy('category')}><Text style={[styles.tabText, groupBy === 'category' && styles.activeTabText]}>Per kategori</Text></Pressable>
          <Pressable style={[styles.tab, groupBy === 'fundSource' && styles.activeTab]} onPress={() => setGroupBy('fundSource')}><Text style={[styles.tabText, groupBy === 'fundSource' && styles.activeTabText]}>Per sumber dana</Text></Pressable>
        </View>

        {groups.length === 0 ? <EmptyMessage icon="chart-box-outline" title="Belum ada laporan" message="Laporan otomatis tersedia setelah budgeting dibuat." /> : groups.map(group => {
          const sampleBudget = data.budgets.find(item => groupBy === 'fundSource'
            ? item.fundSourceId === group.id
            : item.categoryId === group.id);
          const isCredit = groupBy === 'fundSource' && sampleBudget
            ? fundSourceTypeForBudget(sampleBudget, fundSources) === 'credit_card'
            : false;
          const creditLimit = isCredit ? data.creditLimits.find(item => item.fundSourceId === group.id) : undefined;
          return (
            <View key={group.id} style={styles.groupCard}>
              <View style={styles.groupTop}><Text style={styles.groupName}>{group.name}</Text><Text style={styles.groupRemaining}>{isCredit
                ? creditLimit ? `${formatRupiah(creditLimit.amount - group.budget)} sisa limit` : 'Limit belum diatur'
                : `${formatRupiah(group.remaining)} sisa budget`}</Text></View>
              <View style={styles.groupNumbers}><Text style={styles.meta}>Budget {formatRupiah(group.budget)}</Text><Text style={styles.meta}>Realisasi {formatRupiah(group.realized)}</Text></View>
              {creditLimit ? <Text style={styles.limitMeta}>Limit periode {formatRupiah(creditLimit.amount)}</Text> : null}
              <ProgressBar value={group.budget ? group.realized / group.budget : 0} />
            </View>
          );
        })}

        <Text style={styles.section}>Evaluasi Belanja Tak Terduga</Text>
        {unexpectedBudgets.map(item => (
          <View key={item.id} style={styles.fundingCard}>
            <Text style={styles.fundingTitle}>{item.fundSourceName}</Text>
            <Text style={styles.meta}>Alokasi {formatRupiah(item.amount)} • Terpakai {formatRupiah(item.realizedAmount)}</Text>
            <Text style={styles.fundingHint}>Sisa {formatRupiah(remainingForBudget(item))}</Text>
          </View>
        ))}
        {unexpectedExpenses.length === 0 ? <Text style={styles.meta}>Belum ada penggunaan Belanja Tak Terduga pada periode ini.</Text> : unexpectedExpenses.map(item => (
          <View key={item.id} style={styles.detailCard}>
            <Text style={styles.detailName}>{formatRupiah(item.amount)} • {item.fundSourceName}</Text>
            <Text style={styles.detailMeta}>{item.date}</Text>
            <Text style={styles.fundingHint}>{item.note || 'Tanpa catatan'}</Text>
          </View>
        ))}

        <Text style={styles.section}>Detail budgeting</Text>
        {data.budgets.map(item => (
          <View key={item.id} style={styles.detailCard}>
            <View style={styles.detailTop}><Text style={styles.detailName}>{item.name}</Text><StatusPill status={budgetStatus(item)} /></View>
            <Text style={styles.detailMeta}>{item.categoryName} • {item.fundSourceName}</Text>
            <View style={styles.detailNumbers}>
              <View><Text style={styles.numberLabel}>Budget</Text><Text style={styles.number}>{formatRupiah(item.amount)}</Text></View>
              <View><Text style={styles.numberLabel}>Realisasi</Text><Text style={styles.number}>{formatRupiah(item.realizedAmount)}</Text></View>
              <View><Text style={styles.numberLabel}>Sisa</Text><Text style={styles.number}>{formatRupiah(remainingForBudget(item))}</Text></View>
            </View>
          </View>
        ))}

        <Text style={styles.section}>Belum terealisasi</Text>
        {unrealized.length === 0 ? <View style={styles.complete}><Text style={styles.completeText}>Semua rencana sudah memiliki realisasi.</Text></View> : unrealized.map(item => (
          <View key={item.id} style={styles.unrealized}><Text style={styles.unrealizedName}>{item.name}</Text><Text style={styles.unrealizedAmount}>{formatRupiah(item.amount)}</Text></View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingBottom: 30},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10}, gridCard: {width: '48.5%'},
  tabs: {flexDirection: 'row', backgroundColor: '#E8ECEA', padding: 4, borderRadius: 13, marginTop: 22, marginBottom: 12},
  tab: {flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10}, activeTab: {backgroundColor: Colors.surface},
  tabText: {fontSize: 12, fontWeight: '700', color: Colors.textSecondary}, activeTabText: {color: Colors.primary},
  groupCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 9},
  groupTop: {flexDirection: 'row', justifyContent: 'space-between'}, groupName: {fontSize: 15, fontWeight: '800', color: Colors.textPrimary}, groupRemaining: {fontSize: 11, color: Colors.primary, fontWeight: '700'},
  groupNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 9}, meta: {fontSize: 11, color: Colors.textSecondary},
  limitMeta: {fontSize: 11, color: Colors.textSecondary, marginBottom: 9},
  fundingCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 9},
  fundingTitle: {fontSize: 12, fontWeight: '900', color: Colors.primary, letterSpacing: 0.5, marginBottom: 10},
  fundingRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6},
  fundingLabel: {fontSize: 12, color: Colors.textSecondary}, fundingValue: {fontSize: 12, color: Colors.textPrimary, fontWeight: '700'},
  fundingDivider: {height: 1, backgroundColor: Colors.border, marginVertical: 9},
  fundingStrong: {fontSize: 13, color: Colors.textPrimary, fontWeight: '900'}, negative: {color: Colors.danger},
  fundingHint: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 9},
  section: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginTop: 24, marginBottom: 12},
  detailCard: {backgroundColor: Colors.surface, borderRadius: 15, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 8},
  detailTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, detailName: {fontSize: 15, fontWeight: '800', color: Colors.textPrimary}, detailMeta: {fontSize: 11, color: Colors.textSecondary, marginTop: 4},
  detailNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 14}, numberLabel: {fontSize: 9, color: Colors.textSecondary, textTransform: 'uppercase'}, number: {fontSize: 12, color: Colors.textPrimary, fontWeight: '800', marginTop: 3},
  unrealized: {flexDirection: 'row', justifyContent: 'space-between', backgroundColor: Colors.warningSoft, padding: 13, borderRadius: 12, marginBottom: 7}, unrealizedName: {fontSize: 13, fontWeight: '700', color: Colors.textPrimary}, unrealizedAmount: {fontSize: 13, fontWeight: '800', color: Colors.warning},
  complete: {backgroundColor: Colors.successSoft, padding: 16, borderRadius: 13}, completeText: {color: Colors.success, textAlign: 'center', fontWeight: '700'},
});
