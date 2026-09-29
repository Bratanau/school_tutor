import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ActivityIndicator, Image, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_URL, apiGet, apiPost, Category, Story } from './api';

type Stage = 'idle' | 'draft' | 'publishing';

export default function CreateScreen() {
  const [story, setStory] = useState<Story | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [busyMedia, setBusyMedia] = useState<'image' | 'audio' | null>(null);
  const [error, setError] = useState('');
  const player = useAudioPlayer(story?.audio_url ?? null);
  const audioStatus = useAudioPlayerStatus(player);

  useEffect(() => { void apiGet<Category[]>('/api/categories').then(setCategories).catch(() => undefined); }, []);
  useEffect(() => { if (story) setTitle(story.title); }, [story]);

  async function uploadPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    setError(''); setStage('publishing');
    try {
      const asset = result.assets[0];
      const form = new FormData();
      if (Platform.OS === 'web' && asset.file) form.append('file', asset.file);
      else form.append('file', new File(asset.uri) as unknown as Blob);
      const response = await fetch(`${API_URL}/api/studio/upload`, { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? payload?.detail ?? 'Не удалось создать сюжет');
      setStory(payload as Story); setStage('draft');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF'); setStage('idle'); }
  }

  async function regenerate(type: 'image' | 'audio') {
    if (!story || !prompt.trim()) { setError('Введите prompt для генерации'); return; }
    setBusyMedia(type); setError('');
    try {
      const result = await apiPost<{ type: string; url: string }>(`/api/studio/${story.id}/regenerate-media`, { type, custom_prompt: prompt.trim() });
      setStory((current) => current ? { ...current, [type === 'image' ? 'image_url' : 'audio_url']: result.url } : current);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось перегенерировать медиа'); }
    finally { setBusyMedia(null); }
  }

  async function publish() {
    if (!story || !title.trim() || categoryId === null) { setError('Укажите заголовок и тему'); return; }
    setStage('publishing'); setError('');
    try { setStory(await apiPost<Story>(`/api/studio/${story.id}/publish`, { title: title.trim(), category_id: categoryId })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось опубликовать сюжет'); }
    finally { setStage('draft'); }
  }

  if (!story) return (
    <SafeAreaView style={styles.safe}><View style={styles.empty}>
      <Text style={styles.eyebrow}>СТУДИЯ</Text><Text style={styles.heading}>Создайте новый сюжет</Text>
      <Text style={styles.muted}>Загрузите учебный PDF, а YandexGPT, YandexART и SpeechKit подготовят черновик.</Text>
      {stage === 'publishing' ? <ActivityIndicator color="#E47752" size="large" /> : <Pressable onPress={uploadPdf} style={styles.primary}><Ionicons name="cloud-upload-outline" size={21} color="#101010" /><Text style={styles.primaryText}>Загрузить PDF</Text></Pressable>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View></SafeAreaView>
  );

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>ПРЕДПРОСМОТР</Text><Text style={styles.heading}>Черновик сюжета</Text>
    <View style={styles.preview}>{story.image_url ? <Image source={{ uri: story.image_url }} style={styles.previewImage} /> : <View style={styles.previewImage} />}<View style={styles.previewOverlay}><Text style={styles.previewTitle}>{title || 'Без заголовка'}</Text><Pressable onPress={() => audioStatus.playing ? player.pause() : player.play()} style={styles.play}><Ionicons name={audioStatus.playing ? 'pause' : 'play'} size={24} color="#fff" /></Pressable></View></View>
    <TextInput value={prompt} onChangeText={setPrompt} placeholder="Твой prompt для перегенерации..." placeholderTextColor="#777" style={styles.input} multiline />
    <View style={styles.mediaActions}><Pressable onPress={() => void regenerate('image')} style={styles.mediaButton}><Ionicons name="image-outline" size={20} color="#fff" /><Text style={styles.mediaText}>{busyMedia === 'image' ? '...' : 'Картинка'}</Text></Pressable><Pressable onPress={() => void regenerate('audio')} style={styles.mediaButton}><Ionicons name="volume-high-outline" size={20} color="#fff" /><Text style={styles.mediaText}>{busyMedia === 'audio' ? '...' : 'Аудио'}</Text></Pressable></View>
    <Text style={styles.sectionTitle}>Выберите тему</Text><View style={styles.categoryRow}>{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.chip, categoryId === category.id && styles.chipSelected]}><Text style={styles.chipText}>{category.emoji} {category.title}</Text></Pressable>)}</View>
    <TextInput value={title} onChangeText={setTitle} placeholder="Заголовок сюжета" placeholderTextColor="#777" style={styles.input} />
    <Pressable onPress={publish} disabled={stage === 'publishing'} style={styles.publish}><Text style={styles.publishText}>{stage === 'publishing' ? 'ПУБЛИКУЕМ...' : 'ОПУБЛИКОВАТЬ'}</Text></Pressable>
    <Pressable onPress={() => { setStory(null); setStage('idle'); }} style={styles.reset}><Text style={styles.resetText}>Создать другой сюжет</Text></Pressable>
    {!!error && <Text style={styles.error}>{error}</Text>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' }, content: { padding: 18, paddingBottom: 40 }, empty: { flex: 1, justifyContent: 'center', padding: 24 }, eyebrow: { color: '#E47752', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }, heading: { color: '#fff', fontSize: 29, fontWeight: '900', marginBottom: 12 }, muted: { color: '#A6A6A6', fontSize: 15, lineHeight: 22, marginBottom: 26 }, primary: { minHeight: 54, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E47752', borderRadius: 6 }, primaryText: { color: '#111', fontWeight: '900', fontSize: 16 }, preview: { height: 390, borderRadius: 8, overflow: 'hidden', backgroundColor: '#222', marginBottom: 15 }, previewImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' }, previewOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', padding: 18, backgroundColor: 'rgba(0,0,0,0.3)' }, previewTitle: { color: '#fff', fontSize: 22, fontWeight: '900', paddingRight: 60 }, play: { position: 'absolute', right: 18, bottom: 18, width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#D16B4E' }, input: { minHeight: 52, maxHeight: 120, color: '#fff', backgroundColor: '#171717', borderWidth: 1, borderColor: '#303030', borderRadius: 6, padding: 14, marginBottom: 12 }, mediaActions: { flexDirection: 'row', gap: 10 }, mediaButton: { flex: 1, minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#232323', borderRadius: 6 }, mediaText: { color: '#fff', fontWeight: '800' }, sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 22, marginBottom: 10 }, categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 }, chip: { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#3A3A3A', borderRadius: 5 }, chipSelected: { backgroundColor: '#D16B4E', borderColor: '#D16B4E' }, chipText: { color: '#fff', fontWeight: '700' }, publish: { minHeight: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D43D3D', borderRadius: 6, marginTop: 4 }, publishText: { color: '#fff', fontSize: 17, fontWeight: '900' }, reset: { alignItems: 'center', padding: 18 }, resetText: { color: '#A9A9A9', fontWeight: '700' }, error: { color: '#F1A18B', lineHeight: 20, marginTop: 16 },
});
