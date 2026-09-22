import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import PrimaryButton from '../../components/Button/PrimaryButton';
import PrimaryInput from '../../components/Input/PrimaryInput';
import Colors from '../../constants/colors';
import { useAuth } from '../../state/AuthContext';

export default function LoginScreen() {
  const { signIn, signOut, loading, error, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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
          <Text style={styles.subtitle}>
            Rencanakan keuangan keluarga bersama.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.welcome}>Selamat datang</Text>
          <Text style={styles.helper}>Masuk ke budgeting keluarga Anda</Text>
          <Text style={styles.label}>Username</Text>
          <PrimaryInput
            placeholder="Masukkan username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
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
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={Colors.danger}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={styles.loader} />
          ) : (
            <PrimaryButton title="Masuk" onPress={submit} />
          )}
          {user && error ? (
            <View style={styles.reset}>
              <PrimaryButton
                title="Gunakan akun lain"
                variant="secondary"
                onPress={signOut}
              />
            </View>
          ) : null}
        </View>
        <Text style={styles.private}>
          Akses privat • Data tersinkron untuk anggota keluarga
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.primary },
  container: { flex: 1, justifyContent: 'center', padding: 22 },
  brand: { alignItems: 'center', marginBottom: 26 },
  logo: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: { width: 92, height: 92 },
  title: {
    fontSize: 29,
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
  card: { backgroundColor: Colors.surface, borderRadius: 23, padding: 21 },
  welcome: { fontSize: 21, fontWeight: '900', color: Colors.textPrimary },
  helper: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 15,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
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
  loader: { height: 48 },
  reset: { marginTop: 9 },
  private: {
    fontSize: 10,
    color: '#D7EBE3',
    textAlign: 'center',
    marginTop: 18,
  },
});
