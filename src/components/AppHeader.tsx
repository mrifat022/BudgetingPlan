import React, {useMemo, useState} from 'react';
import {Image, type ImageSourcePropType, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import {useNavigation} from '@react-navigation/native';
import Colors from '../constants/colors';
import {useBudget} from '../state/BudgetContext';
import {periodLabel} from '../utils/period';

interface Props {
  title?: string;
  subtitle?: string;
  onSettings?: () => void;
  logoSource?: ImageSourcePropType;
}

export default function AppHeader({onSettings, logoSource}: Props) {
  const navigation = useNavigation<any>();
  const {periods, activePeriodId, activePeriod, setActivePeriodId, loading, error, lastSyncedAt, isPeriodReadOnly} = useBudget();
  const [open, setOpen] = useState(false);
  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => a.id.localeCompare(b.id)), [periods]);
  const activeIndex = sortedPeriods.findIndex(period => period.id === activePeriodId);
  const movePeriod = (offset: number) => {
    const next = sortedPeriods[activeIndex + offset];
    if (next) { setActivePeriodId(next.id); }
  };
  const syncLabel = error
    ? 'Sinkronisasi bermasalah'
    : loading
      ? 'Menyinkronkan data…'
      : lastSyncedAt
        ? `Realtime aktif • diperbarui ${lastSyncedAt.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'})}`
        : 'Menghubungkan realtime…';

  return (
    <View style={styles.header}>
      <SafeAreaView edges={['top']}>
        <View style={styles.topRow}>
          <View style={styles.brandWrap}>
            <Image source={logoSource ?? require('../assets/branding/logo-icon.png')} style={styles.brandLogo} resizeMode="contain" accessibilityLabel="Logo Rifcazi Budget" />
            <View style={styles.titleWrap}>
              <Text style={styles.title} numberOfLines={1}>Rifcazi Budget</Text>
              <Text style={styles.subtitle} numberOfLines={1}>Rencana keuangan keluarga</Text>
            </View>
          </View>
          <View style={[styles.realtimePill, error && styles.realtimeError]}>
            <View style={[styles.realtimeDot, error && styles.realtimeDotError]} />
            <Text style={[styles.realtimeText, error && styles.realtimeTextError]}>{error ? 'Offline' : 'Realtime'}</Text>
          </View>
          <Pressable accessibilityLabel="Buka pengaturan" style={styles.iconButton} onPress={onSettings ?? (() => navigation.navigate('Settings'))}><MaterialCommunityIcons name="cog-outline" size={24} color={Colors.textSecondary} /></Pressable>
        </View>

        <View style={styles.periodButton}>
          <Pressable disabled={activeIndex <= 0} accessibilityLabel="Periode sebelumnya" style={styles.periodArrow} onPress={() => movePeriod(-1)}><MaterialCommunityIcons name="chevron-left" size={25} color={activeIndex <= 0 ? '#B9C3BE' : Colors.textSecondary} /></Pressable>
          <Pressable style={styles.periodCenter} onPress={() => setOpen(true)}><Text style={styles.periodText}>{periodLabel(activePeriodId)}</Text></Pressable>
          <Pressable disabled={activeIndex < 0 || activeIndex >= sortedPeriods.length - 1} accessibilityLabel="Periode berikutnya" style={styles.periodArrow} onPress={() => movePeriod(1)}><MaterialCommunityIcons name="chevron-right" size={25} color={activeIndex < 0 || activeIndex >= sortedPeriods.length - 1 ? '#B9C3BE' : Colors.textSecondary} /></Pressable>
        </View>
        <Text style={[styles.syncText, error && styles.syncError]} numberOfLines={1}>{syncLabel}</Text>
        {isPeriodReadOnly ? <View style={styles.readOnlyBanner}><MaterialCommunityIcons name="lock-outline" size={15} color={Colors.warning} /><Text style={styles.readOnlyText}>{activePeriod?.status === 'closed' ? 'Periode ditutup • data hanya dapat dilihat' : 'Periode arsip • data hanya dapat dilihat'}</Text></View> : null}
      </SafeAreaView>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Pilih periode</Text>
            <ScrollView style={styles.periodList}>
              {[...sortedPeriods].reverse().map(period => <Pressable key={period.id} style={[styles.periodOption, period.id === activePeriodId && styles.periodOptionActive]} onPress={() => { setActivePeriodId(period.id); setOpen(false); }}><Text style={[styles.optionText, period.id === activePeriodId && styles.optionTextActive]}>{period.label || periodLabel(period.id)}</Text>{period.id === activePeriodId ? <MaterialCommunityIcons name="check-circle" size={20} color={Colors.primary} /> : null}</Pressable>)}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {paddingHorizontal: 20, paddingBottom: 13, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border},
  topRow: {height: 58, flexDirection: 'row', alignItems: 'center'},
  brandWrap: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center'},
  brandLogo: {width: 42, height: 42, marginRight: 9},
  titleWrap: {flex: 1, minWidth: 0},
  title: {fontSize: 18, fontWeight: '900', color: Colors.textPrimary, letterSpacing: -0.3},
  subtitle: {fontSize: 11, color: Colors.textSecondary, marginTop: 1},
  realtimePill: {height: 32, paddingHorizontal: 10, borderRadius: 17, backgroundColor: Colors.primarySoft, flexDirection: 'row', alignItems: 'center', marginLeft: 5},
  realtimeError: {backgroundColor: Colors.dangerSoft},
  realtimeDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#75C9AA', marginRight: 5},
  realtimeDotError: {backgroundColor: Colors.danger},
  realtimeText: {fontSize: 11, color: Colors.primary, fontWeight: '800'},
  realtimeTextError: {color: Colors.danger},
  iconButton: {width: 42, height: 42, borderRadius: 15, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', marginLeft: 8},
  periodButton: {height: 50, marginTop: 5, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#FAFBFA', flexDirection: 'row', alignItems: 'center'},
  periodArrow: {width: 52, height: '100%', alignItems: 'center', justifyContent: 'center'},
  periodCenter: {flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center'},
  periodText: {fontSize: 16, color: Colors.textPrimary, fontWeight: '900'},
  syncText: {fontSize: 10, color: Colors.textSecondary, textAlign: 'center', marginTop: 9},
  syncError: {color: Colors.danger},
  readOnlyBanner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, backgroundColor: Colors.warningSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10},
  readOnlyText: {fontSize: 10, color: Colors.warning, fontWeight: '700'},
  backdrop: {flex: 1, backgroundColor: 'rgba(13,27,21,0.48)', justifyContent: 'flex-end'},
  sheet: {maxHeight: '62%', backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 16},
  handle: {width: 44, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 15},
  sheetTitle: {fontSize: 20, fontWeight: '900', color: Colors.textPrimary, marginBottom: 12},
  periodList: {maxHeight: 360},
  periodOption: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 14, marginBottom: 6},
  periodOptionActive: {backgroundColor: Colors.primarySoft},
  optionText: {fontSize: 15, color: Colors.textPrimary},
  optionTextActive: {fontWeight: '800', color: Colors.primary},
});
