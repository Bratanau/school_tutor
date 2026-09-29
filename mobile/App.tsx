import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeFeed from './HomeFeed';
import ThemesScreen from './ThemesScreen';
import CreateScreen from './CreateScreen';
import ProfileScreen from './ProfileScreen';

const Tabs = createBottomTabNavigator();

export default function App() {
  return <NavigationContainer>
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarShowLabel: true,
      tabBarActiveTintColor: '#FFFFFF',
      tabBarInactiveTintColor: '#777777',
      tabBarStyle: { height: 62, paddingBottom: 7, paddingTop: 6, backgroundColor: '#000000', borderTopColor: '#222222' },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      tabBarIcon: ({ color, size }) => {
        const names: Record<string, keyof typeof Ionicons.glyphMap> = { Home: 'home', Themes: 'grid', Create: 'add-circle', Profile: 'person' };
        return <Ionicons name={names[route.name]} size={route.name === 'Create' ? 36 : size} color={route.name === 'Create' ? '#E47752' : color} />;
      },
    })}>
      <Tabs.Screen name="Home" component={HomeFeed} options={{ title: 'Главная' }} />
      <Tabs.Screen name="Themes" component={ThemesScreen} options={{ title: 'Темы' }} />
      <Tabs.Screen name="Create" component={CreateScreen} options={{ title: 'Создать' }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
    </Tabs.Navigator>
  </NavigationContainer>;
}
