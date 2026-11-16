import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import AppHeader from '../../components/AppHeader';
import {EmptyMessage, ProgressBar, StatusPill} from '../../components/FinanceUI';
import Colors from '../../constants/colors';
import {budgetStatus, fundSourceTypeForBudget, groupBudgets, isSavingsBudget, isUnexpectedBudgetItem, remainingForBudget, summarizePeriod} from '../../domain/budgeting';
import {isUnexpectedBudget, UNEXPECTED_CATEGORY_ID} from '../../domain/unexpected';
import type {Budget, Expense} from '../../models';
import {getCashflowHistory, type CashflowPoint} from '../../services/firebase';
import {useBudget} from '../../state/BudgetContext';
import {formatRupiah} from '../../utils/currency';
import {periodLabel} from '../../utils/period';

function lastSixPeriods(activePeriodId: string) {
  if (!/^\d{4}-\d{2}$/.test(activePeriodId)) { return []; }
  const [year, month] = activePeriodId.split('-').map(Number);
  return Array.from({length: 6}, (_, index) => {
    const date = new Date(year, month - 1 - (5 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

function monthShort(periodId: string) {
  return periodLabel(periodId).split(' ')[0].slice(0, 3).toUpperCase();
}

export default function LaporanScreen() {
  const {data, fundSources, householdId, activePeriodId} = useBudget();
  const [history, setHistory] = useState<CashflowPoint[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [expandedUnexpected, setExpandedUnexpected] = useState<Set<string>>(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const periodIds = useMemo(() => lastSixPeriods(activePeriodId), [activePeriodId]);
  const summary = useMemo(() => summarizePeriod(data, fundSources), [data, fundSources]);
  const sourceGroups = useMemo(() => groupBudgets(data.budgets, 'fundSource'), [data.budgets]);
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, {name: string; items: Budget[]}>();
    data.budgets.forEach(item => {
      const current = groups.get(item.categoryId);
      groups.set(item.categoryId, {name: item.categoryName, items: [...(current?.items ?? []), item]});
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [data.budgets]);
  const unexpectedGroups = useMemo(() => {
    const groups = new Map<string, {name: string; items: Expense[]; total: number}>();
    data.expenses.filter(item => isUnexpectedBudget(item.budgetId) || item.categoryId === UNEXPECTED_CATEGORY_ID).forEach(item => {
      const sourceType = item.fundSourceType ?? fundSources.find(source => source.id === item.fundSourceId)?.type;
      const groupId = sourceType === 'credit_card' ? 'credit_card' : sourceType === 'debit' ? 'debit' : item.fundSourceId;
      const groupName = sourceType === 'credit_card' ? 'Kartu Kredit' : sourceType === 'debit' ? 'Debit / Rekening' : item.fundSourceName;
      const current = groups.get(groupId) ?? {name: groupName, items: [], total: 0};
      current.items.push(item);
      current.total += item.amount;
      groups.set(groupId, current);
    });
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'id'));
  }, [data.expenses, fundSources]);
  const unrealized = data.budgets.filter(item => item.realizedAmount === 0 && !isUnexpectedBudget(item.id));
  const totalBudgeting = data.budgets
    .filter(item => !isSavingsBudget(item) && !isUnexpectedBudgetItem(item))
    .reduce((sum, item) => sum + item.amount, 0);
  const surplus = totalBudgeting - summary.totalRealized;

  useEffect(() => {
    if (!householdId || !activePeriodId) { setHistory([]); return; }
    let active = true;
    setHistoryError('');
    getCashflowHistory(householdId, periodIds)
      .then(items => { if (active) { setHistory(items); } })
      .catch(cause => { if (active) { setHistoryError(cause instanceof Error ? cause.message : 'Tren arus kas gagal dimuat.'); } });
    return () => { active = false; };
  }, [activePeriodId, householdId, periodIds]);

  const cashflow = useMemo(() => periodIds.map(periodId => {
    if (periodId === activePeriodId) { return {periodId, budgeting: totalBudgeting, expense: summary.totalRealized}; }
    return history.find(item => item.periodId === periodId) ?? {periodId, budgeting: 0, expense: 0};
  }), [activePeriodId, history, periodIds, summary.totalRealized, totalBudgeting]);
  const chartMax = Math.max(1, ...cashflow.flatMap(item => [item.budgeting, item.expense]));

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter(current => {
    const next = new Set(current);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    return next;
  });

  return (
    <View style={styles.screen}>
      <AppHeader title="Laporan" subtitle="Evaluasi rencana dan realisasi keuangan" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.surplusCard}>
          <Text style={styles.heroTitle}>Ringkasan Bulan Ini</Text>
          <View style={styles.balanceGrid}>
            <View style={styles.balanceBox}><Text style={styles.balanceLabel}>Total Budgeting</Text><Text style={styles.balanceValue}>{formatRupiah(totalBudgeting)}</Text></View>
            <View style={[styles.balanceBox, styles.balanceBoxMiddle]}><Text style={styles.balanceLabel}>Total Pengeluaran</Text><Text style={styles.balanceValue}>{formatRupiah(summary.totalRealized)}</Text></View>
            <View style={styles.balanceBox}><Text style={styles.balanceLabel}>{surplus < 0 ? 'Defisit' : 'Surplus'}</Text><Text style={styles.balanceValue}>{formatRupiah(Math.abs(surplus))}</Text></View>
          </View>
          <View style={styles.statusPanel}><Text style={styles.statusTitle}>{surplus < 0 ? '⚠ Defisit' : surplus > 0 ? '✅ Surplus' : '✓ Seimbang'}</Text><Text style={styles.statusNote}>{surplus < 0 ? 'Pengeluaran bulan ini melebihi dana yang direncanakan' : 'Keuangan bulan ini terkendali dengan baik'}</Text></View>
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartTitleRow}><Text style={styles.cardEyebrow}>TREN BUDGETING VS PENGELUARAN</Text><Text style={styles.chartPeriod}>6 bulan</Text></View>
          {historyError ? <Text style={styles.errorText}>{historyError}</Text> : null}
          <View style={styles.chart}>{cashflow.map(item => (
            <View key={item.periodId} style={styles.chartColumn}>
              <View style={styles.bars}><View style={[styles.bar, styles.budgetingBar, {height: Math.max(3, item.budgeting / chartMax * 118)}]} /><View style={[styles.bar, styles.expenseBar, {height: Math.max(3, item.expense / chartMax * 118)}]} /></View>
              <Text style={styles.month}>{monthShort(item.periodId)}</Text>
            </View>
          ))}</View>
          <View style={styles.legend}><Text style={styles.budgetingLegend}>■ Budgeting</Text><Text style={styles.expenseLegend}>■ Pengeluaran</Text></View>
        </View>

        <Text style={styles.section}>Alokasi Debit dan Kredit</Text>
        <View style={styles.fundingCard}>
          <Text style={styles.fundingTitle}>DEBIT / REKENING</Text>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Saldo dari pemasukan</Text><Text style={styles.fundingValue}>{formatRupiah(summary.totalIncome)}</Text></View>
          {summary.totalCreditPayments > 0 ? <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Pembayaran kartu kredit</Text><Text style={styles.fundingValue}>-{formatRupiah(summary.totalCreditPayments)}</Text></View> : null}
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Saldo Debit tersedia</Text><Text style={styles.fundingValue}>{formatRupiah(summary.availableDebit)}</Text></View>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Budgeting Debit</Text><Text style={styles.fundingValue}>{formatRupiah(summary.debitBudget)}</Text></View>
          <View style={styles.fundingDivider} /><View style={styles.fundingRow}><Text style={styles.fundingStrong}>Belum dialokasikan</Text><Text style={[styles.fundingStrong, summary.unallocatedDebit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedDebit)}</Text></View>
          <Text style={styles.fundingHint}>Dana ini dapat dialokasikan ke tabungan atau belanja tak terduga.</Text>
        </View>
        <View style={styles.fundingCard}>
          <Text style={styles.fundingTitle}>KARTU KREDIT</Text>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Limit tersedia</Text><Text style={styles.fundingValue}>{formatRupiah(summary.totalCreditLimit)}</Text></View>
          <View style={styles.fundingRow}><Text style={styles.fundingLabel}>Sudah dialokasikan</Text><Text style={styles.fundingValue}>{formatRupiah(summary.creditBudget)}</Text></View>
          <View style={styles.fundingDivider} /><View style={styles.fundingRow}><Text style={styles.fundingStrong}>Sisa limit belum dialokasikan</Text><Text style={[styles.fundingStrong, summary.unallocatedCredit < 0 && styles.negative]}>{formatRupiah(summary.unallocatedCredit)}</Text></View>
          <Text style={styles.fundingHint}>Sisa ini adalah limit kredit, bukan saldo yang dapat ditabung.</Text>
        </View>

        <Text style={styles.section}>Laporan per Sumber Dana</Text>
        {sourceGroups.length === 0 ? <EmptyMessage icon="chart-box-outline" title="Belum ada laporan" message="Laporan otomatis tersedia setelah budgeting dibuat." /> : sourceGroups.map(group => {
          const sample = data.budgets.find(item => item.fundSourceId === group.id);
          const isCredit = sample ? fundSourceTypeForBudget(sample, fundSources) === 'credit_card' : false;
          const creditLimit = isCredit ? data.creditLimits.find(item => item.fundSourceId === group.id) : undefined;
          return <View key={group.id} style={styles.groupCard}><View style={styles.groupTop}><Text style={styles.groupName}>{group.name}</Text><Text style={styles.groupRemaining}>{isCredit ? creditLimit ? `${formatRupiah(creditLimit.amount - group.budget)} sisa limit` : 'Limit belum diatur' : `${formatRupiah(group.remaining)} sisa budget`}</Text></View><View style={styles.groupNumbers}><Text style={styles.meta}>Budget {formatRupiah(group.budget)}</Text><Text style={styles.meta}>Realisasi {formatRupiah(group.realized)}</Text></View>{creditLimit ? <Text style={styles.limitMeta}>Limit periode {formatRupiah(creditLimit.amount)}</Text> : null}<ProgressBar value={group.budget ? group.realized / group.budget : 0} /></View>;
        })}

        <Text style={styles.section}>Evaluasi Belanja Tak Terduga</Text>
        {unexpectedGroups.length === 0 ? <Text style={styles.emptyLine}>Belum ada penggunaan Belanja Tak Terduga pada periode ini.</Text> : unexpectedGroups.map(([sourceId, group]) => {
          const expanded = expandedUnexpected.has(sourceId);
          return <View key={sourceId} style={styles.accordion}><Pressable style={styles.accordionHeader} onPress={() => toggle(setExpandedUnexpected, sourceId)} accessibilityState={{expanded}}><View><Text style={styles.accordionTitle}>{group.name}</Text><Text style={styles.accordionMeta}>{group.items.length} transaksi</Text></View><View style={styles.accordionRight}><Text style={styles.accordionTotal}>{formatRupiah(group.total)}</Text><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.primary} /></View></Pressable>{expanded ? <View style={styles.accordionBody}>{group.items.map(item => <View key={item.id} style={styles.unexpectedItem}><View style={styles.itemBody}><Text style={styles.detailName}>{item.note || 'Tanpa catatan'}</Text><Text style={styles.detailMeta}>{item.date} • {item.fundSourceName}</Text></View><Text style={styles.itemAmount}>{formatRupiah(item.amount)}</Text></View>)}</View> : null}</View>;
        })}

        <Text style={styles.section}>Detail Budgeting per Kategori</Text>
        {categoryGroups.length === 0 ? <Text style={styles.emptyLine}>Belum ada budgeting pada periode ini.</Text> : categoryGroups.map(([categoryId, group]) => {
          const expanded = expandedCategories.has(categoryId);
          const budget = group.items.reduce((sum, item) => sum + item.amount, 0);
          const realized = group.items.reduce((sum, item) => sum + item.realizedAmount, 0);
          return <View key={categoryId} style={styles.accordion}><Pressable style={styles.accordionHeader} onPress={() => toggle(setExpandedCategories, categoryId)} accessibilityState={{expanded}}><View style={styles.categoryInfo}><Text style={styles.accordionTitle}>{group.name}</Text><Text style={styles.accordionMeta}>Budget {formatRupiah(budget)} • Realisasi {formatRupiah(realized)} • Sisa {formatRupiah(Math.max(0, budget - realized))}</Text></View><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.primary} /></Pressable>{expanded ? <View style={styles.accordionBody}>{group.items.map(item => <View key={item.id} style={styles.detailCard}><View style={styles.detailTop}><Text style={styles.detailName}>{item.name}</Text><StatusPill status={budgetStatus(item)} /></View><Text style={styles.detailMeta}>{item.fundSourceName}</Text><View style={styles.detailNumbers}><View><Text style={styles.numberLabel}>Budget</Text><Text style={styles.number}>{formatRupiah(item.amount)}</Text></View><View><Text style={styles.numberLabel}>Realisasi</Text><Text style={styles.number}>{formatRupiah(item.realizedAmount)}</Text></View><View><Text style={styles.numberLabel}>Sisa</Text><Text style={styles.number}>{formatRupiah(remainingForBudget(item))}</Text></View></View></View>)}</View> : null}</View>;
        })}

        <Text style={styles.section}>Belum terealisasi</Text>
        {unrealized.length === 0 ? <View style={styles.complete}><Text style={styles.completeText}>Semua rencana sudah memiliki realisasi.</Text></View> : unrealized.map(item => <View key={item.id} style={styles.unrealized}><View style={styles.itemBody}><Text style={styles.unrealizedName}>{item.name}</Text><Text style={styles.detailMeta}>{item.categoryName}</Text></View><Text style={styles.unrealizedAmount}>{formatRupiah(item.amount)}</Text></View>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, content: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32},
  surplusCard: {backgroundColor: Colors.primary, borderRadius: 24, padding: 20}, heroTitle: {fontSize: 14, fontWeight: '700', color: '#D7EBE3'}, balanceGrid: {flexDirection: 'row', marginTop: 16}, balanceBox: {flex: 1, alignItems: 'center', paddingHorizontal: 4}, balanceBoxMiddle: {borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.32)'}, balanceLabel: {fontSize: 9, color: '#BFE0D2', textAlign: 'center'}, balanceValue: {fontSize: 13, fontWeight: '900', color: Colors.white, marginTop: 6, textAlign: 'center'}, statusPanel: {backgroundColor: 'rgba(255,255,255,0.24)', borderRadius: 15, alignItems: 'center', padding: 14, marginTop: 17}, statusTitle: {fontSize: 24, fontWeight: '900', color: Colors.white}, statusNote: {fontSize: 10, color: '#E3F1EB', marginTop: 5, textAlign: 'center'}, deficit: {color: Colors.danger}, cardEyebrow: {fontSize: 13, fontWeight: '900', color: Colors.textPrimary},
  chartCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 20, padding: 17, marginTop: 14}, chartTitleRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, chartPeriod: {fontSize: 12, color: Colors.success, fontWeight: '800'}, chart: {height: 157, flexDirection: 'row', alignItems: 'flex-end', marginTop: 14}, chartColumn: {flex: 1, alignItems: 'center'}, bars: {height: 126, flexDirection: 'row', gap: 4, alignItems: 'flex-end'}, bar: {width: 10, borderRadius: 5}, budgetingBar: {backgroundColor: Colors.primary}, expenseBar: {backgroundColor: '#E24A4A'}, month: {fontSize: 10, color: Colors.textSecondary, marginTop: 7}, legend: {flexDirection: 'row', gap: 20, marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10}, budgetingLegend: {fontSize: 11, color: Colors.primary}, expenseLegend: {fontSize: 11, color: '#E24A4A'}, errorText: {fontSize: 10, color: Colors.danger, marginTop: 8},
  section: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginTop: 24, marginBottom: 12}, fundingCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 9}, fundingTitle: {fontSize: 12, fontWeight: '900', color: Colors.primary, letterSpacing: 0.5, marginBottom: 10}, fundingRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6}, fundingLabel: {fontSize: 12, color: Colors.textSecondary}, fundingValue: {fontSize: 12, color: Colors.textPrimary, fontWeight: '700'}, fundingDivider: {height: 1, backgroundColor: Colors.border, marginVertical: 9}, fundingStrong: {fontSize: 13, color: Colors.textPrimary, fontWeight: '900'}, negative: {color: Colors.danger}, fundingHint: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 9},
  groupCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 9}, groupTop: {flexDirection: 'row', justifyContent: 'space-between'}, groupName: {fontSize: 15, fontWeight: '800', color: Colors.textPrimary}, groupRemaining: {fontSize: 11, color: Colors.primary, fontWeight: '700'}, groupNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 9}, meta: {fontSize: 11, color: Colors.textSecondary}, limitMeta: {fontSize: 11, color: Colors.textSecondary, marginBottom: 9},
  accordion: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, marginBottom: 9, overflow: 'hidden'}, accordionHeader: {padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, accordionTitle: {fontSize: 14, fontWeight: '900', color: Colors.textPrimary}, accordionMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 5}, accordionRight: {flexDirection: 'row', alignItems: 'center', gap: 7}, accordionTotal: {fontSize: 14, fontWeight: '900', color: Colors.primary}, accordionBody: {borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background, padding: 9}, categoryInfo: {flex: 1, marginRight: 8}, unexpectedItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, padding: 12, borderRadius: 11, marginBottom: 6}, itemBody: {flex: 1, marginRight: 10}, itemAmount: {fontSize: 13, fontWeight: '900', color: Colors.danger},
  detailCard: {backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginBottom: 6}, detailTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, detailName: {fontSize: 13, fontWeight: '800', color: Colors.textPrimary}, detailMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 4}, detailNumbers: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12}, numberLabel: {fontSize: 8, color: Colors.textSecondary, textTransform: 'uppercase'}, number: {fontSize: 11, color: Colors.textPrimary, fontWeight: '800', marginTop: 3}, emptyLine: {fontSize: 12, color: Colors.textSecondary, backgroundColor: Colors.surface, padding: 16, borderRadius: 13}, unrealized: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.warningSoft, padding: 13, borderRadius: 12, marginBottom: 7}, unrealizedName: {fontSize: 13, fontWeight: '700', color: Colors.textPrimary}, unrealizedAmount: {fontSize: 13, fontWeight: '800', color: Colors.warning}, complete: {backgroundColor: Colors.successSoft, padding: 16, borderRadius: 13}, completeText: {color: Colors.success, textAlign: 'center', fontWeight: '700'},
});
