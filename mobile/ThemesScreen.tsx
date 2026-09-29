import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { apiGet, Category } from './api';
import StoryFeed from './StoryFeed';

const Stack = createNativeStackNavigator();

function CategoryCatalog({ navigation }: { navigation: any }) {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { void apiGet<Category[]>('/api/categories').then(setCategories).catch(() => undefined); }, []);
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList data={categories} numColumns={2} contentContainerStyle={styles.grid} keyExtractor={(item) => String(item.id)} renderItem={({ item }) => (
        <Pressable style={styles.category} onPress={() => navigation.navigate('ThemeDetail', { categoryId: item.id, title: item.title })}>
          <Text style={styles.emoji}>{item.emoji}</Text><Text style={styles.title}>{item.title}</Text>
        </Pressable>
      )} ListEmptyComponent={<Text style={styles.muted}>Темы пока недоступны</Text>} />
    </SafeAreaView>
  );
}

function ThemeDetail({ route }: { route: any }) {
  return <StoryFeed endpoint={`/api/categories/${route.params.categoryId}/stories`} />;
}

export default function ThemesScreen() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#080808' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: '#080808' } }}>
      <Stack.Screen name="CategoryCatalog" component={CategoryCatalog} options={{ title: 'Темы' }} />
      <Stack.Screen name="ThemeDetail" component={ThemeDetail} options={({ route }: any) => ({ title: route.params?.title ?? 'Сюжеты' })} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  grid: { padding: 12, gap: 12 },
  category: { flex: 1, minHeight: 150, margin: 6, padding: 18, justifyContent: 'flex-end', backgroundColor: '#171717', borderRadius: 7, borderWidth: 1, borderColor: '#2A2A2A' },
  emoji: { fontSize: 42, marginBottom: 22 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  muted: { color: '#999', padding: 24, textAlign: 'center' },
});
