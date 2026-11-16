import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import PrimaryButton from '../../components/Button/PrimaryButton';
import PrimaryInput from '../../components/Input/PrimaryInput';
import Colors from '../../constants/colors';
import {APP_VERSION} from '../../constants/app';
import { requestPasswordReset } from '../../services/firebase';
import { useAuth } from '../../state/AuthContext';

export default function LoginScreen() {
  const { signIn, signOut, loading, error, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) {
      Alert.alert('Data belum lengkap', 'Masukkan username dan password.');
      return;
    }
    try {
      await signIn(username, password);
    } catch (cause) {
      Alert.alert(
        'Tidak dapat masuk',
        cause instanceof Error ? cause.message : 'Login gagal.',
      );
    }
  };

  const forgotPassword = async () => {
    const email = username.trim();
    if (!email || !email.includes('@')) {
      Alert.alert(
        'Masukkan email',
        'Masukkan alamat email lengkap yang terdaftar pada kolom Username atau email, lalu tekan Lupa password.',
      );
      return;
    }
    try {
      setResettingPassword(true);
      await requestPasswordReset(email);
      Alert.alert(
        'Email reset dikirim',
        `Tautan untuk membuat password baru telah dikirim ke ${email.toLowerCase()}. Periksa juga folder Spam atau Promosi.`,
      );
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : 'Email reset gagal dikirim.';
      const message = raw.includes('invalid-email')
        ? 'Format alamat email tidak valid.'
        : raw.includes('network-request-failed')
          ? 'Tidak dapat terhubung ke internet. Periksa koneksi lalu coba lagi.'
          : raw;
      Alert.alert('Gagal mengirim email reset', message);
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Image
              source={require('../../assets/branding/login-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityLabel="Logo Rifcazi Budget"
            />
          </View>
          <Text style={styles.title}>Rifcazi Budget</Text>
          <Text style={styles.subtitle}>Rencana keuangan keluarga</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.welcome}>Masuk ke Akun</Text>
          <Text style={styles.label}>Email</Text>
          <PrimaryInput
            placeholder="nama@email.com"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.label}>Password</Text>
          <PrimaryInput
            placeholder="Masukkan password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {loading ? <ActivityIndicator color={Colors.primary} style={styles.loader} /> : <PrimaryButton title="Masuk" onPress={submit} disabled={!username.trim() || !password} />}
          <Pressable
            accessibilityRole="button"
            disabled={loading || resettingPassword}
            onPress={forgotPassword}
            style={styles.forgotPassword}
          >
            {resettingPassword ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <Text style={styles.forgotPasswordText}>Lupa password?</Text>
            )}
          </Pressable>
          {user && error ? (
            <View style={styles.reset}>
              <PrimaryButton
                title="Gunakan akun lain"
                variant="secondary"
                onPress={signOut}
              />
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.security}><View style={styles.securityIcon}><MaterialCommunityIcons name="shield-outline" size={18} color={Colors.primary} /></View><Text style={styles.securityText}>Data keuangan keluarga Anda tersimpan dengan aman dan disinkronkan secara realtime antara dua anggota keluarga.</Text></View>
        </View>
        <Text style={styles.private}>Rifcazi Budget v{APP_VERSION}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.primary },
  container: { flex: 1, justifyContent: 'center', padding: 25 },
  brand: { alignItems: 'center', marginBottom: 24 },
  logo: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: { width: 88, height: 88 },
  title: {
    fontSize: 27,
    fontWeight: '900',
    color: Colors.white,
    marginTop: 4,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 13,
    color: '#D7EBE3',
    textAlign: 'center',
    marginTop: 6,
  },
  card: { backgroundColor: Colors.surface, borderRadius: 25, padding: 25 },
  welcome: { fontSize: 22, fontWeight: '900', color: Colors.textPrimary, marginBottom: 15 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: Colors.dangerSoft,
    borderRadius: 11,
    padding: 11,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 11, lineHeight: 16, color: Colors.danger },
  forgotPassword: {
    alignSelf: 'center',
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 9,
    marginBottom: 0,
  },
  forgotPasswordText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  loader: { height: 48 },
  reset: { marginTop: 9 },
  divider: {height: 1, backgroundColor: Colors.border, marginTop: 13, marginBottom: 17},
  security: {flexDirection: 'row', alignItems: 'flex-start'},
  securityIcon: {width: 34, height: 34, borderRadius: 12, backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 11},
  securityText: {flex: 1, fontSize: 11, lineHeight: 18, color: Colors.textSecondary},
  private: {
    fontSize: 10,
    color: '#D7EBE3',
    textAlign: 'center',
    marginTop: 18,
  },
});
