import React from 'react';
import {ActivityIndicator, Image, StyleSheet, View} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import LoginScreen from '../screens/Login/LoginScreen';
import MainTabNavigator from './MainTabNavigator';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import {useAuth} from '../state/AuthContext';
import {BudgetProvider} from '../state/BudgetContext';
import Colors from '../constants/colors';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const {profile, loading} = useAuth();
  if (loading && !profile) {
    return (
      <View style={styles.loading}>
        <Image
          source={require('../assets/branding/splash-logo.png')}
          style={styles.splashLogo}
          resizeMode="contain"
          accessibilityLabel="Rifcazi Budget"
        />
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  return (
    <NavigationContainer>
      {profile ? (
        <BudgetProvider>
          <Stack.Navigator screenOptions={{headerShown: false}}>
            <Stack.Screen name="MainTab" component={MainTabNavigator} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </BudgetProvider>
      ) : (
        <Stack.Navigator screenOptions={{headerShown: false}}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    gap: 20,
  },
  splashLogo: {width: 210, height: 210},
});
