import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActiveExamProvider } from './ActiveExamContext';
import FeedScreen from './screens/FeedScreen';
import ProgressScreen from './screens/ProgressScreen';
import CatalogScreen from './screens/CatalogScreen';
import ExamsHubScreen from './screens/ExamsHubScreen';

type TabParamList = {
  Preparation: undefined;
  Progress: undefined;
  Topics: undefined;
  Exams: undefined;
};

const Tabs = createBottomTabNavigator<TabParamList>();
const navigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#050505', card: '#050505', border: '#262626' },
};

const icons: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Preparation: 'home',
  Progress: 'bar-chart',
  Topics: 'file-tray-stacked',
  Exams: 'document-text',
};

export default function App() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <ActiveExamProvider>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: '#F28A62',
          tabBarInactiveTintColor: '#777777',
          tabBarStyle: {
            height: 64,
            paddingTop: 7,
            paddingBottom: 7,
            backgroundColor: '#050505',
            borderTopColor: '#262626',
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
          tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
        })}
      >
        <Tabs.Screen name="Preparation" component={FeedScreen} options={{ title: 'Подготовка' }} />
        <Tabs.Screen name="Progress" component={ProgressScreen} options={{ title: 'Мой прогресс' }} />
        <Tabs.Screen name="Topics" component={CatalogScreen} options={{ title: 'Каталог' }} />
        <Tabs.Screen name="Exams" component={ExamsHubScreen} options={{ title: 'Экзамены' }} />
      </Tabs.Navigator>
      </ActiveExamProvider>
    </NavigationContainer>
  );
}
