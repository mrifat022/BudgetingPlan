import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../../constants/colors';
import PrimaryButton from '../../components/Button/PrimaryButton';
import {FormActions, FormModal, Label, MoneyField, SelectField, TextField} from '../../components/FormUI';
import {useAuth} from '../../state/AuthContext';
import {useBudget} from '../../state/BudgetContext';
import type {BudgetCategory, FundSource, FundSourceType, IncomeCategory} from '../../models';
import {archiveMaster, saveMaster} from '../../services/firebase';
import {formatRupiah} from '../../utils/currency';

type Tab = 'incomeCategories' | 'budgetCategories' | 'fundSources';
type MasterItem = IncomeCategory | BudgetCategory | FundSource;

const typeLabels: Record<FundSourceType, string> = {
  debit: 'Debit / Rekening', credit_card: 'Kartu Kredit', cash: 'Cash', other: 'Lainnya',
};

export default function SettingsScreen() {
  const navigation = useNavigation();
  const {profile, signOut} = useAuth();
  const {householdId, activePeriodId, uid, incomeCategories, budgetCategories, fundSources} = useBudget();
  const [tab, setTab] = useState<Tab>('incomeCategories');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<FundSourceType>('debit');
  const [limit, setLimit] = useState<number | null>(null);
  const items: MasterItem[] = tab === 'incomeCategories' ? incomeCategories : tab === 'budgetCategories' ? budgetCategories : fundSources;

  const showForm = (item?: MasterItem) => {
    setEditing(item ?? null); setName(item?.name ?? '');
    if (item && 'type' in item) { setSourceType(item.type); setLimit(item.monthlyLimit); }
    else { setSourceType('debit'); setLimit(null); }
    setOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) { Alert.alert('Nama wajib diisi'); return; }
    try {
      await saveMaster(householdId, activePeriodId, uid, tab, {
        name: name.trim(),
        ...(tab === 'fundSources' ? {type: sourceType, monthlyLimit: sourceType === 'credit_card' ? limit : null} : {}),
      }, editing?.id);
      setOpen(false);
    } catch (cause) { Alert.alert('Gagal menyimpan', cause instanceof Error ? cause.message : 'Terjadi kesalahan.'); }
  };

  const remove = (item: MasterItem) => Alert.alert('Hapus data master?', `${item.name} akan disembunyikan dari pilihan baru. Riwayat lama tetap aman.`, [
    {text: 'Batal', style: 'cancel'},
    {text: 'Hapus', style: 'destructive', onPress: () => archiveMaster(householdId, activePeriodId, uid, tab, item.id)},
  ]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()}><MaterialCommunityIcons name="arrow-left" size={25} color={Colors.textPrimary} /></Pressable>
        <Text style={styles.title}>Pengaturan & Data Master</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.displayName?.slice(0, 1).toUpperCase() || 'B'}</Text></View>
          <View style={styles.profileBody}><Text style={styles.profileName}>{profile?.displayName}</Text><Text style={styles.profileMeta}>@{profile?.username} • {profile?.role === 'owner' ? 'Pemilik household' : 'Anggota household'}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Data master</Text>
        <View style={styles.tabs}>
          {([
            ['incomeCategories', 'Pemasukan'], ['budgetCategories', 'Budget'], ['fundSources', 'Sumber Dana'],
          ] as Array<[Tab, string]>).map(([value, label]) => (
            <Pressable key={value} style={[styles.tab, tab === value && styles.activeTab]} onPress={() => setTab(value)}><Text style={[styles.tabText, tab === value && styles.activeTabText]}>{label}</Text></Pressable>
          ))}
        </View>
        {items.map(item => (
          <Pressable key={item.id} style={styles.item} onPress={() => showForm(item)} onLongPress={() => remove(item)}>
            <View style={styles.itemIcon}><MaterialCommunityIcons name={tab === 'fundSources' ? 'wallet-outline' : 'tag-outline'} size={20} color={Colors.primary} /></View>
            <View style={styles.itemBody}><Text style={styles.itemName}>{item.name}</Text>{'type' in item ? <Text style={styles.itemMeta}>{typeLabels[item.type]}{item.monthlyLimit ? ` • Limit default ${formatRupiah(item.monthlyLimit)}` : ''}</Text> : null}</View>
            <MaterialCommunityIcons name="pencil-outline" size={19} color={Colors.textSecondary} />
          </Pressable>
        ))}
        <Pressable style={styles.add} onPress={() => showForm()}><MaterialCommunityIcons name="plus" size={20} color={Colors.primary} /><Text style={styles.addText}>Tambah {tab === 'fundSources' ? 'sumber dana' : 'kategori'}</Text></Pressable>
        <Text style={styles.hint}>Ketuk untuk edit • tahan untuk hapus</Text>
        <View style={styles.logout}><PrimaryButton title="Keluar dari akun" variant="secondary" onPress={signOut} /></View>
      </ScrollView>

      <FormModal visible={open} title={editing ? 'Edit data master' : 'Tambah data master'} onClose={() => setOpen(false)}>
        <Label>Nama</Label><TextField value={name} onChangeText={setName} placeholder="Masukkan nama" />
        {tab === 'fundSources' ? <>
          <Label>Jenis</Label><SelectField value={sourceType} onChange={value => setSourceType(value as FundSourceType)} options={Object.entries(typeLabels).map(([value, label]) => ({value, label}))} />
          {sourceType === 'credit_card' ? <><Label>Limit default (opsional)</Label><MoneyField value={limit} onChangeValue={setLimit} /><Text style={styles.formHint}>Limit aktual tetap dikonfirmasi pada halaman Pemasukan setiap awal bulan.</Text></> : null}
        </> : null}
        <FormActions saveLabel={editing ? 'Perbarui' : 'Simpan'} onSave={submit} onCancel={() => setOpen(false)} />
      </FormModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: Colors.background}, header: {height: 62, backgroundColor: Colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.border},
  back: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center'}, title: {fontSize: 18, fontWeight: '800', color: Colors.textPrimary}, content: {padding: 20, paddingBottom: 34},
  profile: {flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary, padding: 17, borderRadius: 18}, avatar: {width: 48, height: 48, borderRadius: 16, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center'}, avatarText: {fontSize: 22, color: Colors.primary, fontWeight: '900'},
  profileBody: {marginLeft: 13}, profileName: {fontSize: 17, color: Colors.white, fontWeight: '800'}, profileMeta: {fontSize: 11, color: '#D7EBE3', marginTop: 4},
  sectionTitle: {fontSize: 18, color: Colors.textPrimary, fontWeight: '800', marginTop: 24, marginBottom: 12},
  tabs: {flexDirection: 'row', backgroundColor: '#E8ECEA', borderRadius: 12, padding: 4, marginBottom: 12}, tab: {flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9}, activeTab: {backgroundColor: Colors.surface}, tabText: {fontSize: 11, fontWeight: '700', color: Colors.textSecondary}, activeTabText: {color: Colors.primary},
  item: {flexDirection: 'row', alignItems: 'center', padding: 13, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 8}, itemIcon: {width: 36, height: 36, backgroundColor: Colors.primarySoft, borderRadius: 11, alignItems: 'center', justifyContent: 'center'}, itemBody: {flex: 1, marginLeft: 11}, itemName: {fontSize: 14, fontWeight: '800', color: Colors.textPrimary}, itemMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 3},
  add: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 13, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: 13, marginTop: 3}, addText: {fontSize: 13, fontWeight: '800', color: Colors.primary}, hint: {fontSize: 10, textAlign: 'center', color: Colors.textSecondary, marginTop: 8}, logout: {marginTop: 30},
  formHint: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 6},
});
