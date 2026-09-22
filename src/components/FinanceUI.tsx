import React from 'react';
import {Pressable, StyleSheet, Text, View, type ViewStyle} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../constants/colors';
import {formatRupiah} from '../utils/currency';
import type {BudgetStatus} from '../models';
import {statusLabel} from '../domain/budgeting';

export function SummaryCard({label, amount, tone = 'default', style}: {
  label: string;
  amount: number;
  tone?: 'default' | 'primary' | 'warning';
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.summary, tone === 'primary' && styles.summaryPrimary, style]}>
      <Text style={[styles.summaryLabel, tone === 'primary' && styles.onPrimary]}>{label}</Text>
      <Text style={[styles.summaryAmount, tone === 'primary' && styles.onPrimary, tone === 'warning' && styles.warning]} numberOfLines={1} adjustsFontSizeToFit>
        {formatRupiah(amount)}
      </Text>
    </View>
  );
}

export function ProgressBar({value, color = Colors.primary}: {value: number; color?: string}) {
  const progress = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, {width: `${progress * 100}%`, backgroundColor: color}]} />
    </View>
  );
}

export function StatusPill({status}: {status: BudgetStatus}) {
  return (
    <View style={[
      styles.pill,
      status === 'unrealized' && styles.pillNeutral,
      status === 'partial' && styles.pillWarning,
      (status === 'realized' || status === 'cash_allocated') && styles.pillSuccess,
    ]}>
      <Text style={[
        styles.pillText,
        status === 'unrealized' && styles.pillTextNeutral,
        status === 'partial' && styles.pillTextWarning,
        (status === 'realized' || status === 'cash_allocated') && styles.pillTextSuccess,
      ]}>{statusLabel(status)}</Text>
    </View>
  );
}

export function SectionTitle({title, action, onAction}: {title: string; action?: string; onAction?: () => void}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction ? <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function FAB({onPress, label = 'Tambah'}: {onPress: () => void; label?: string}) {
  return (
    <Pressable accessibilityRole="button" style={styles.fab} onPress={onPress}>
      <MaterialCommunityIcons name="plus" size={24} color={Colors.white} />
      <Text style={styles.fabLabel}>{label}</Text>
    </Pressable>
  );
}

export function EmptyMessage({icon = 'inbox-outline', title, message}: {icon?: string; title: string; message: string}) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as never} size={36} color={Colors.textSecondary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {backgroundColor: Colors.surface, borderRadius: 18, padding: 16, minHeight: 94, borderWidth: 1, borderColor: Colors.border},
  summaryPrimary: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  summaryLabel: {fontSize: 12, color: Colors.textSecondary, fontWeight: '600'},
  summaryAmount: {fontSize: 21, color: Colors.textPrimary, fontWeight: '800', marginTop: 8, letterSpacing: -0.4},
  onPrimary: {color: Colors.white},
  warning: {color: Colors.warning},
  progressTrack: {height: 8, borderRadius: 5, backgroundColor: Colors.border, overflow: 'hidden'},
  progressFill: {height: '100%', backgroundColor: Colors.primary, borderRadius: 5},
  pill: {alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 9},
  pillNeutral: {backgroundColor: '#EEF1F0'},
  pillWarning: {backgroundColor: Colors.warningSoft},
  pillSuccess: {backgroundColor: Colors.successSoft},
  pillText: {fontSize: 11, fontWeight: '800'},
  pillTextNeutral: {color: Colors.textSecondary},
  pillTextWarning: {color: Colors.warning},
  pillTextSuccess: {color: Colors.success},
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 22},
  sectionTitle: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary},
  sectionAction: {fontSize: 13, color: Colors.primary, fontWeight: '700'},
  fab: {position: 'absolute', right: 20, bottom: 18, height: 52, borderRadius: 18, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17, gap: 7, elevation: 6, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: {width: 0, height: 4}},
  fabLabel: {color: Colors.white, fontWeight: '800'},
  empty: {alignItems: 'center', paddingHorizontal: 30, paddingVertical: 34},
  emptyTitle: {fontSize: 16, fontWeight: '800', color: Colors.textPrimary, marginTop: 10},
  emptyText: {fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: 5},
});
