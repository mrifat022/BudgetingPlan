import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import PemasukanScreen from '../screens/Pemasukan/PemasukanScreen';
import BudgetingScreen from '../screens/Budgeting/BudgetingScreen';
import PengeluaranScreen from '../screens/Pengeluaran/PengeluaranScreen';
import LaporanScreen from '../screens/Laporan/LaporanScreen';
import Colors from '../constants/colors';

const Tab = createBottomTabNavigator();
type IconProps = {color: string; size: number};
const makeIcon = (name: string) => function TabIcon({color, size}: IconProps) {
  return <MaterialCommunityIcons name={name as never} color={color} size={size} />;
};
const DashboardIcon = makeIcon('home-variant-outline');
const IncomeIcon = makeIcon('cash');
const BudgetIcon = makeIcon('view-grid-outline');
const ExpenseIcon = makeIcon('currency-usd');
const ReportIcon = makeIcon('chart-box-outline');

export default function MainTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: Colors.primary,
      tabBarInactiveTintColor: '#84908B',
      tabBarLabelStyle: {fontSize: 11, fontWeight: '700', marginBottom: 7},
      tabBarIconStyle: {marginTop: 4},
      tabBarStyle: {height: 76, paddingTop: 5, backgroundColor: Colors.surface, borderTopColor: Colors.border, borderTopWidth: 1},
    }}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{tabBarLabel: 'Home', tabBarIcon: DashboardIcon}} />
      <Tab.Screen name="Pemasukan" component={PemasukanScreen} options={{tabBarIcon: IncomeIcon}} />
      <Tab.Screen name="Budgeting" component={BudgetingScreen} options={{tabBarIcon: BudgetIcon}} />
      <Tab.Screen name="Pengeluaran" component={PengeluaranScreen} options={{tabBarIcon: ExpenseIcon}} />
      <Tab.Screen name="Laporan" component={LaporanScreen} options={{tabBarIcon: ReportIcon}} />
    </Tab.Navigator>
  );
}
