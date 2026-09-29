import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import FeedScreen, { Topic } from './components/FeedScreen';
import PaywallScreen from './PaywallScreen';

// Set this to the development computer's Wi-Fi/LAN address for a physical phone.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (
  Platform.OS === 'web' || Platform.OS === 'ios' ? 'http://127.0.0.1:8000' : 'http://10.0.2.2:8000'
);
const REQUEST_TIMEOUT_MS = 60000;
const LIBRARY_STORAGE_KEY = '@scrolled/topics';

type UploadState = 'idle' | 'loading' | 'error';

export default function UploadScreen() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [status, setStatus] = useState<UploadState>('idle');
  const [showPaywall, setShowPaywall] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(LIBRARY_STORAGE_KEY)
      .then((value) => {
        if (!value) return;
        const saved = JSON.parse(value) as Topic[];
        if (Array.isArray(saved) && saved.length > 0) setTopics(saved);
      })
      .catch(() => undefined)
      .finally(() => setLibraryReady(true));
  }, []);

  async function persistTopics(nextTopics: Topic[]) {
    setTopics(nextTopics.length > 0 ? nextTopics : null);
    await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextTopics));
  }

  async function uploadAndProcessFile() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    if (file.mimeType && file.mimeType !== 'application/pdf') {
      setStatus('error');
      setError('Выберите файл в формате PDF.');
      return;
    }

    setStatus('loading');
    const form = new FormData();
    if (Platform.OS === 'web' && file.file) {
      form.append('file', file.file);
    } else {
      form.append('file', new File(file.uri));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const requestFetch = Platform.OS === 'web' ? fetch : expoFetch;
      const response = await requestFetch(`${API_URL}/process-pdf`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          setStatus('idle');
          setShowPaywall(true);
          return;
        }
        throw new Error(payload?.error ?? payload?.detail ?? `Server error (${response.status})`);
      }
      const parsed = validateTopic(payload);
      const nextTopics = [...(topics ?? []), parsed];
      await persistTopics(nextTopics);
      setIsAdding(false);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Запрос превысил лимит ожидания. Попробуйте ещё раз.');
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось обработать PDF.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!libraryReady) return null;
  if (showPaywall) return <PaywallScreen onClose={() => setShowPaywall(false)} onPurchased={() => setShowPaywall(false)} />;
  if (topics && !isAdding) return (
      <FeedScreen
        key={topics.map((topic) => topic.title).join('|')}
        topics={topics}
        onAdd={() => setIsAdding(true)}
        onDelete={(index) => void persistTopics(topics.filter((_, topicIndex) => topicIndex !== index))}
      />
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View><Text style={styles.logo}>ScrollEd</Text><Text style={styles.headerMeta}>ЛЕНТА ОБУЧЕНИЯ</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={isAdding ? 'Back to library' : 'Open Pro'} onPress={() => isAdding ? setIsAdding(false) : setShowPaywall(true)} hitSlop={8}>
          <Text style={styles.proLink}>{isAdding ? 'Назад' : 'Pro'}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        {status === 'loading' ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator size="small" color="#E47752" />
            <Text style={styles.loadingTitle}>Создаём учебную ленту</Text>
            <Text style={styles.secondary}>Читаем PDF и создаём короткие карточки.</Text>
          </View>
        ) : (
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>ИЗ PDF В ПРАКТИКУ</Text>
            <Text style={styles.title}>Запоминайте больше из каждой книги.</Text>
            <Text style={styles.secondary}>Загрузите PDF и получите короткие карточки, итог и проверочный вопрос.</Text>
            <Pressable accessibilityRole="button" onPress={uploadAndProcessFile} style={styles.button}>
              <Text style={styles.buttonText}>Выбрать PDF</Text>
              <Text style={styles.buttonHint}>до 25 МБ</Text>
            </Pressable>
            {status === 'error' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function validateTopic(value: unknown): Topic {
  if (!value || typeof value !== 'object') throw new Error('Сервер вернул некорректный JSON.');
  const topic = value as Partial<Topic>;
  if (typeof topic.title !== 'string' || !Array.isArray(topic.cards) || !topic.quiz) {
    throw new Error('Ответ сервера не соответствует формату ScrollEd.');
  }
  if (topic.cards.length === 0 || !Array.isArray(topic.quiz.options) ||
      typeof topic.quiz.correctAnswer !== 'number' ||
      topic.quiz.correctAnswer < 0 || topic.quiz.correctAnswer >= topic.quiz.options.length) {
    throw new Error('Данные карточек или теста повреждены.');
  }
  return topic as Topic;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101418' },
  header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#283139' },
  logo: { color: '#F6F3EA', fontSize: 20, fontWeight: '800' },
  headerMeta: { color: '#A7B3B0', fontSize: 10, letterSpacing: 1, marginTop: 2 },
  proLink: { color: '#E47752', fontSize: 13, fontWeight: '800' },
  content: { flex: 1, padding: 20, justifyContent: 'center' },
  intro: { maxWidth: 440 },
  eyebrow: { color: '#E47752', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 12 },
  title: { color: '#F6F3EA', fontSize: 28, lineHeight: 34, fontWeight: '800' },
  secondary: { color: '#B6C1BD', fontSize: 15, lineHeight: 22, marginTop: 12 },
  button: { marginTop: 24, minHeight: 54, paddingHorizontal: 18, backgroundColor: '#E47752', borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  buttonText: { color: '#101418', fontSize: 16, fontWeight: '800' },
  buttonHint: { color: '#613123', fontSize: 12, fontWeight: '700' },
  loadingPanel: { alignItems: 'center', padding: 22, borderWidth: 1, borderColor: '#283139', borderRadius: 8 },
  loadingTitle: { color: '#F6F3EA', fontSize: 17, fontWeight: '700', marginTop: 12 },
  error: { color: '#F0A38C', fontSize: 14, lineHeight: 20, marginTop: 18 },
});
