import React, {useEffect, useState} from 'react';
import {Alert, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../../constants/colors';
import {APP_BUILD, APP_VERSION} from '../../constants/app';
import {FormActions, FormModal, Label, MoneyField, SelectField, TextField} from '../../components/FormUI';
import {useAuth} from '../../state/AuthContext';
import {useBudget} from '../../state/BudgetContext';
import type {BudgetCategory, FundSource, FundSourceType, HouseholdMember, IncomeCategory} from '../../models';
import {archiveMaster, saveMaster, subscribeMembers} from '../../services/firebase';
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
  const [expanded, setExpanded] = useState<Tab | 'members' | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<FundSourceType>('debit');
  const [limit, setLimit] = useState<number | null>(null);
  useEffect(() => {
    if (!householdId) { return; }
    return subscribeMembers(householdId, setMembers, () => undefined);
  }, [householdId]);
  const toggleSection = (next: Tab | 'members') => {
    if (next !== 'members') { setTab(next); }
    setExpanded(current => current === next ? null : next);
  };

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
        <Pressable style={styles.back} onPress={() => navigation.goBack()}><MaterialCommunityIcons name="arrow-left" size={23} color={Colors.primary} /><Text style={styles.backText}>Kembali</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.settingsBrand}><Image source={require('../../assets/branding/logo-icon.png')} style={styles.brandLogo} /><View><Text style={styles.title}>Pengaturan</Text><Text style={styles.brandSubtitle}>Rifcazi Budget</Text></View></View>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.displayName?.slice(0, 1).toUpperCase() || 'B'}</Text></View>
          <View style={styles.profileBody}><Text style={styles.profileName}>{profile?.displayName}</Text><Text style={styles.profileMeta}>{profile?.username}</Text><View style={styles.rolePill}><Text style={styles.roleText}>{profile?.role === 'owner' ? '♛ Owner' : 'Anggota'}</Text></View></View>
        </View>
        <View style={styles.accordion}>
          <Pressable style={styles.accordionHeader} onPress={() => toggleSection('members')}><Text style={styles.sectionIcon}>👥</Text><Text style={styles.accordionTitle}>Anggota Keluarga</Text><MaterialCommunityIcons name={expanded === 'members' ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.textSecondary} /></Pressable>
          {expanded === 'members' ? <View style={styles.accordionBody}>{members.map(member => <View key={member.id} style={styles.memberRow}><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{member.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.itemBody}><Text style={styles.itemName}>{member.displayName}</Text><Text style={styles.itemMeta}>{member.role === 'owner' ? 'Owner' : 'Anggota keluarga'}</Text></View></View>)}</View> : null}
        </View>
        {([
          ['incomeCategories', 'Kategori Pemasukan', '💰', incomeCategories],
          ['budgetCategories', 'Kategori Budget', '📋', budgetCategories],
          ['fundSources', 'Sumber Dana', '🏦', fundSources],
        ] as Array<[Tab, string, string, MasterItem[]]>).map(([value, label, icon, sectionItems]) => <View key={value} style={styles.accordion}>
          <Pressable style={styles.accordionHeader} onPress={() => toggleSection(value)}><Text style={styles.sectionIcon}>{icon}</Text><Text style={styles.accordionTitle}>{label}</Text><MaterialCommunityIcons name={expanded === value ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.textSecondary} /></Pressable>
          {expanded === value ? <View style={styles.accordionBody}>{sectionItems.map(item => <Pressable key={item.id} style={styles.item} onPress={() => { setTab(value); showForm(item); }} onLongPress={() => { setTab(value); remove(item); }}><View style={styles.itemBody}><Text style={styles.itemName}>{item.name}</Text>{'type' in item ? <Text style={styles.itemMeta}>{typeLabels[item.type]}{item.monthlyLimit ? ` • Limit default ${formatRupiah(item.monthlyLimit)}` : ''}</Text> : null}</View><MaterialCommunityIcons name="pencil-outline" size={18} color={Colors.textSecondary} /></Pressable>)}<Pressable style={styles.add} onPress={() => { setTab(value); showForm(); }}><MaterialCommunityIcons name="plus" size={19} color={Colors.primary} /><Text style={styles.addText}>Tambah {value === 'fundSources' ? 'sumber dana' : 'kategori'}</Text></Pressable><Text style={styles.hint}>Ketuk untuk edit • tahan untuk hapus</Text></View> : null}
        </View>)}
        <View style={styles.infoCard}><Text style={styles.infoTitle}>Informasi Aplikasi</Text><View style={styles.infoRow}><Text style={styles.infoLabel}>Versi</Text><Text style={styles.infoValue}>{APP_VERSION} (Build {APP_BUILD})</Text></View><View style={styles.infoRow}><Text style={styles.infoLabel}>Platform</Text><Text style={styles.infoValue}>Android</Text></View><View style={styles.infoRow}><Text style={styles.infoLabel}>Sinkronisasi</Text><Text style={styles.infoValue}>Realtime aktif</Text></View><View style={styles.infoRow}><Text style={styles.infoLabel}>Database</Text><Text style={styles.infoValue}>Cloud (aman)</Text></View></View>
        <Pressable style={styles.logout} onPress={signOut}><MaterialCommunityIcons name="logout" size={22} color={Colors.danger} /><Text style={styles.logoutText}>Keluar dari Akun</Text></Pressable>
        <Text style={styles.version}>Rifcazi Budget v{APP_VERSION} • © 2026</Text>
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
  screen: {flex: 1, backgroundColor: Colors.background}, header: {height: 48, backgroundColor: Colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.border},
  back: {height: 42, flexDirection: 'row', alignItems: 'center'}, backText: {fontSize: 14, color: Colors.primary, fontWeight: '700', marginLeft: 4}, title: {fontSize: 17, fontWeight: '900', color: Colors.textPrimary}, content: {padding: 20, paddingBottom: 34},
  settingsBrand: {flexDirection: 'row', alignItems: 'center', marginBottom: 18}, brandLogo: {width: 42, height: 42, marginRight: 10}, brandSubtitle: {fontSize: 12, color: Colors.textSecondary, marginTop: 2},
  profile: {flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary, padding: 20, borderRadius: 21, marginBottom: 14}, avatar: {width: 50, height: 50, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center'}, avatarText: {fontSize: 17, color: Colors.white, fontWeight: '900'},
  profileBody: {marginLeft: 14}, profileName: {fontSize: 18, color: Colors.white, fontWeight: '900'}, profileMeta: {fontSize: 11, color: '#D7EBE3', marginTop: 3}, rolePill: {alignSelf: 'flex-start', backgroundColor: '#F4C542', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, marginTop: 7}, roleText: {fontSize: 10, color: '#4D3C00', fontWeight: '900'},
  accordion: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, marginBottom: 12, overflow: 'hidden'}, accordionHeader: {height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16}, sectionIcon: {fontSize: 18, width: 32}, accordionTitle: {flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: '900'}, accordionBody: {borderTopWidth: 1, borderTopColor: Colors.border, padding: 10},
  item: {flexDirection: 'row', alignItems: 'center', padding: 11, backgroundColor: Colors.surface, borderRadius: 12, marginBottom: 3}, itemBody: {flex: 1}, itemName: {fontSize: 13, fontWeight: '800', color: Colors.textPrimary}, itemMeta: {fontSize: 10, color: Colors.textSecondary, marginTop: 3},
  memberRow: {flexDirection: 'row', alignItems: 'center', padding: 10}, smallAvatar: {width: 36, height: 36, borderRadius: 12, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10}, smallAvatarText: {fontSize: 12, fontWeight: '900', color: Colors.primary},
  add: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: 12, marginTop: 3}, addText: {fontSize: 12, fontWeight: '800', color: Colors.primary}, hint: {fontSize: 9, textAlign: 'center', color: Colors.textSecondary, marginTop: 7},
  infoCard: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, padding: 16, marginTop: 2}, infoTitle: {fontSize: 14, fontWeight: '900', color: Colors.textPrimary, marginBottom: 10}, infoRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8}, infoLabel: {fontSize: 12, color: Colors.textSecondary}, infoValue: {fontSize: 12, color: Colors.textPrimary, fontWeight: '700'},
  logout: {height: 58, marginTop: 14, borderWidth: 1, borderColor: Colors.border, borderRadius: 17, backgroundColor: Colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17}, logoutText: {fontSize: 14, color: Colors.danger, fontWeight: '900', marginLeft: 12},
  formHint: {fontSize: 10, lineHeight: 15, color: Colors.textSecondary, marginTop: 6},
  version: {fontSize: 10, color: Colors.textSecondary, textAlign: 'center', marginTop: 18},
});
