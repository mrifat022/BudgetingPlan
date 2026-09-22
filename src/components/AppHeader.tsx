import React, {useState} from 'react';
import {
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../constants/colors';
import {useBudget} from '../state/BudgetContext';
import {periodLabel} from '../utils/period';

interface Props {
  title: string;
  subtitle?: string;
  onSettings?: () => void;
  logoSource?: ImageSourcePropType;
}

export default function AppHeader({title, subtitle, onSettings, logoSource}: Props) {
  const {periods, activePeriodId, setActivePeriodId} = useBudget();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <View style={styles.brandWrap}>
          {logoSource ? (
            <Image
              source={logoSource}
              style={styles.brandLogo}
              resizeMode="contain"
              accessibilityLabel="Logo Rifcazi Budget"
            />
          ) : null}
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {onSettings ? (
          <Pressable accessibilityLabel="Buka pengaturan" style={styles.iconButton} onPress={onSettings}>
            <MaterialCommunityIcons name="cog-outline" size={24} color={Colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>
      <Pressable style={styles.periodButton} onPress={() => setOpen(true)}>
        <MaterialCommunityIcons name="calendar-month-outline" size={18} color={Colors.primary} />
        <Text style={styles.periodText}>{periodLabel(activePeriodId)}</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={Colors.primary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <SafeAreaView style={styles.sheet}>
            <Text style={styles.sheetTitle}>Pilih periode</Text>
            <ScrollView style={styles.periodList}>
              {periods.map(period => (
                <Pressable
                  key={period.id}
                  style={[styles.periodOption, period.id === activePeriodId && styles.periodOptionActive]}
                  onPress={() => {
                    setActivePeriodId(period.id);
                    setOpen(false);
                  }}>
                  <Text style={[styles.optionText, period.id === activePeriodId && styles.optionTextActive]}>
                    {period.label || periodLabel(period.id)}
                  </Text>
                  {period.id === activePeriodId ? (
                    <MaterialCommunityIcons name="check" size={20} color={Colors.primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, backgroundColor: Colors.background},
  topRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  brandWrap: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10},
  brandLogo: {width: 42, height: 42},
  titleWrap: {flex: 1},
  title: {fontSize: 27, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5},
  subtitle: {marginTop: 3, fontSize: 13, color: Colors.textSecondary},
  iconButton: {width: 42, height: 42, borderRadius: 14, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center'},
  periodButton: {alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, backgroundColor: Colors.primarySoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12},
  periodText: {color: Colors.primary, fontWeight: '700', fontSize: 13},
  backdrop: {flex: 1, backgroundColor: 'rgba(10,20,16,0.45)', justifyContent: 'flex-end'},
  sheet: {maxHeight: '60%', backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20},
  sheetTitle: {fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 12},
  periodList: {maxHeight: 360},
  periodOption: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 12, marginBottom: 6},
  periodOptionActive: {backgroundColor: Colors.primarySoft},
  optionText: {fontSize: 16, color: Colors.textPrimary},
  optionTextActive: {fontWeight: '700', color: Colors.primary},
});
