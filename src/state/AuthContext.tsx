import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import type {User} from '@react-native-firebase/auth';
import type {UserProfile} from '../models';
import {getUserProfile, listenToAuth, login, logout} from '../services/firebase';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return listenToAuth(async currentUser => {
      setUser(currentUser);
      setError(null);
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      try {
        setProfile(await getUserProfile(currentUser.uid));
      } catch (cause) {
        setProfile(null);
        setError(cause instanceof Error ? cause.message : 'Profil gagal dimuat.');
      } finally {
        setLoading(false);
      }
    }, message => {
      setError(message);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    profile,
    loading,
    error,
    signIn: async (username, password) => {
      setLoading(true);
      setError(null);
      try {
        await login(username, password);
      } catch (cause) {
        setLoading(false);
        const raw = cause instanceof Error ? cause.message : 'Login gagal.';
        throw new Error(raw.includes('invalid-credential') ? 'Username atau password salah.' : raw);
      }
    },
    signOut: logout,
  }), [error, loading, profile, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth harus digunakan di dalam AuthProvider.');
  }
  return value;
}
