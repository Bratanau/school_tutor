import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions, ViewToken } from 'react-native';
import { apiGet, Story, StoryCard } from './api';

type Props = { endpoint: string; onCategoryPress?: (categoryId: number) => void };

function Slide({ card, active, width, height }: { card: StoryCard; active: boolean; width: number; height: number }) {
  const player = useAudioPlayer(card.audio_url);
  const status = useAudioPlayerStatus(player);
  useEffect(() => { if (!active) player.pause(); return () => player.pause(); }, [active, player]);
  return <View style={[styles.slide, { width, height }]}>
    {card.image_url ? <Image source={{ uri: card.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, styles.emptyImage]} />}
    <View style={styles.scrim} /><View style={styles.bottomFade} />
    <View style={styles.copy}><Text style={styles.slideNumber}>{card.position + 1}</Text><Text style={styles.title}>{card.title ?? 'Учебный факт'}</Text><Text style={styles.script}>{card.text}</Text><Pressable onPress={() => status.playing ? player.pause() : player.play()} style={styles.audioButton} accessibilityRole="button" accessibilityLabel="Воспроизвести слайд"><Ionicons name={status.playing ? 'pause' : 'play'} size={18} color="#fff" /><Text style={styles.audioText}>{status.playing ? 'Пауза' : 'Слушать'}</Text></Pressable></View>
  </View>;
}

function StoryItem({ story, onCategoryPress }: { story: Story; onCategoryPress?: (id: number) => void }) {
  const { width, height } = useWindowDimensions();
  const [slideIndex, setSlideIndex] = useState(0);
  const [liked, setLiked] = useState(story.is_liked);
  const [likes, setLikes] = useState(story.likes_count);
  const cards = useMemo<StoryCard[]>(() => story.cards?.length ? story.cards : [{ id: `${story.id}-legacy`, position: 0, title: story.title, text: story.text_script, image_prompt: '', image_url: story.image_url, audio_url: story.audio_url }], [story]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => { const index = viewableItems[0]?.index; if (typeof index === 'number') setSlideIndex(index); }).current;

  return <View style={[styles.story, { height }]}>
    <FlatList data={cards} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={(item) => item.id} renderItem={({ item }) => <Slide card={item} active={cards.indexOf(item) === slideIndex} width={width} height={height} />} viewabilityConfig={viewabilityConfig} onViewableItemsChanged={onViewableItemsChanged} />
    <View style={styles.dots}>{cards.map((card, index) => <View key={card.id} style={[styles.dot, index === slideIndex && styles.dotActive]} />)}</View>
    <View style={styles.actions}>
      <Pressable onPress={() => { setLiked(!liked); setLikes((value) => value + (liked ? -1 : 1)); }} style={styles.action} accessibilityRole="button" accessibilityLabel="Поставить лайк"><Ionicons name={liked ? 'heart' : 'heart-outline'} size={34} color={liked ? '#FE2C55' : '#fff'} /><Text style={styles.count}>{likes}</Text></Pressable>
      <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="Комментарии"><Ionicons name="chatbubble-ellipses-outline" size={31} color="#fff" /><Text style={styles.count}>{story.comments_count}</Text></Pressable>
      {story.category_id !== null && onCategoryPress && <Pressable onPress={() => onCategoryPress(story.category_id!)} style={styles.topicButton} accessibilityRole="button" accessibilityLabel="Открыть категорию"><Text style={styles.topicEmoji}>{story.category_emoji ?? '📚'}</Text><Text style={styles.topicText} numberOfLines={2}>{story.category_title ?? 'Категория'}</Text></Pressable>}
    </View>
  </View>;
}

export default function StoryFeed({ endpoint, onCategoryPress }: Props) {
  const [stories, setStories] = useState<Story[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setStories(await apiGet<Story[]>(endpoint)); } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить ленту'); } finally { setLoading(false); } }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <View style={styles.center}><Text style={styles.muted}>Загружаем сюжеты...</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;
  if (!stories.length) return <View style={styles.center}><Text style={styles.muted}>Здесь пока нет опубликованных сюжетов</Text></View>;
  return <FlatList data={stories} pagingEnabled showsVerticalScrollIndicator={false} keyExtractor={(item) => item.id} renderItem={({ item }) => <StoryItem story={item} onCategoryPress={onCategoryPress} />} />;
}

const styles = StyleSheet.create({
  story: { backgroundColor: '#080808' }, slide: { backgroundColor: '#080808', justifyContent: 'flex-end' }, emptyImage: { backgroundColor: '#202020' }, scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.28)' }, bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 310, backgroundColor: 'rgba(0,0,0,0.72)' }, copy: { position: 'absolute', left: 20, right: 88, bottom: 110 }, slideNumber: { color: '#F1B28F', fontSize: 13, fontWeight: '900', marginBottom: 8 }, title: { color: '#fff', fontSize: 26, fontWeight: '900', marginBottom: 10 }, script: { color: '#F0F0F0', fontSize: 17, lineHeight: 24 }, audioButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 7 }, audioText: { color: '#fff', fontWeight: '700' }, actions: { position: 'absolute', right: 15, bottom: 112, alignItems: 'center', gap: 20 }, action: { alignItems: 'center' }, count: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 3 }, topicButton: { width: 68, alignItems: 'center' }, topicEmoji: { width: 52, height: 52, textAlign: 'center', textAlignVertical: 'center', fontSize: 28, backgroundColor: '#D16B4E', borderRadius: 26, overflow: 'hidden', borderWidth: 2, borderColor: '#fff' }, topicText: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', marginTop: 5 }, dots: { position: 'absolute', top: 54, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' }, dotActive: { width: 20, backgroundColor: '#fff' }, center: { flex: 1, backgroundColor: '#080808', alignItems: 'center', justifyContent: 'center', padding: 28 }, muted: { color: '#A9A9A9', fontSize: 16, textAlign: 'center' }, error: { color: '#F1A18B', textAlign: 'center', lineHeight: 21 }, retry: { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#D16B4E', borderRadius: 6 }, retryText: { color: '#111', fontWeight: '800' },
});

