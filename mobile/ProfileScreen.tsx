import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { apiGet, Story } from './api';

export default function ProfileScreen() {
  const [stories, setStories] = useState<Story[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { setRefreshing(true); try { setStories(await apiGet<Story[]>('/api/users/me/stories')); } finally { setRefreshing(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <SafeAreaView style={styles.safe}>
    <FlatList data={stories} numColumns={3} keyExtractor={(item) => item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor="#E47752" />} ListHeaderComponent={<View style={styles.header}><View style={styles.avatar}><Text style={styles.avatarText}>S</Text></View><Text style={styles.name}>ScrollEd User</Text><Text style={styles.handle}>@learner</Text><Text style={styles.count}>{stories.length} сюжет(ов)</Text></View>} renderItem={({ item }) => <Pressable style={styles.tile}><Image source={{ uri: item.image_url ?? 'https://picsum.photos/seed/empty/400/600' }} style={styles.image} /><View style={styles.tileShade} /><Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text></Pressable>} ListEmptyComponent={<Text style={styles.empty}>Созданные сюжеты появятся здесь</Text>} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' }, header: { alignItems: 'center', paddingTop: 28, paddingBottom: 25 }, avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#E47752', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#101418', fontSize: 31, fontWeight: '900' }, name: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 13 }, handle: { color: '#999', marginTop: 4 }, count: { color: '#E47752', fontWeight: '800', marginTop: 12 }, tile: { width: '33.333%', aspectRatio: 0.68, padding: 2, backgroundColor: '#222' }, image: { width: '100%', height: '100%' }, tileShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' }, tileTitle: { position: 'absolute', left: 8, right: 8, bottom: 9, color: '#fff', fontSize: 12, fontWeight: '800' }, empty: { color: '#999', textAlign: 'center', padding: 25 },
});
