import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import FeedScreen from './components/FeedScreen';
import UploadScreen from './UploadScreen';
import ProfileScreen from './ProfileScreen';

const Tabs = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarShowLabel: true,
          tabBarActiveTintColor: '#FFFFFF',
          tabBarInactiveTintColor: '#777777',
          tabBarStyle: { height: 58, paddingBottom: 7, paddingTop: 6, backgroundColor: '#000000', borderTopColor: '#222222' },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
          tabBarIcon: ({ color, size }) => {
            const names = { Home: 'home', Add: 'add-circle', Profile: 'person' } as const;
            return <Ionicons name={names[route.name as keyof typeof names] as never} size={route.name === 'Add' ? 34 : size} color={route.name === 'Add' ? '#E47752' : color} />;
          },
        })}
      >
        <Tabs.Screen name="Home" component={FeedScreen} options={{ title: 'Главная' }} />
        <Tabs.Screen name="Add" component={UploadScreen} options={{ title: 'Добавить' }} />
        <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
