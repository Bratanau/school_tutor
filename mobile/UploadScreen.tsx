import React, { useState } from 'react';
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

type UploadState = 'idle' | 'loading' | 'error';

export default function UploadScreen() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [status, setStatus] = useState<UploadState>('idle');
  const [showPaywall, setShowPaywall] = useState(false);
  const [error, setError] = useState('');

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
      setTopics([parsed]);
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

  if (showPaywall) return <PaywallScreen onClose={() => setShowPaywall(false)} onPurchased={() => setShowPaywall(false)} />;
  if (topics) return <FeedScreen topics={topics} />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Text style={styles.logo}>ScrollEd</Text><Text style={styles.label}>PDF TO LEARNING FEED</Text></View>
      <View style={styles.content}>
        {status === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#E47752" />
            <Text style={styles.loadingTitle}>Искусственный интеллект изучает вашу книгу...</Text>
            <Text style={styles.secondary}>Обычно это занимает несколько секунд</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Превратите учебник в ленту</Text>
            <Text style={styles.secondary}>Выберите PDF, чтобы получить короткие карточки и проверочный вопрос.</Text>
            <Pressable accessibilityRole="button" onPress={uploadAndProcessFile} style={styles.button}>
              <Text style={styles.buttonText}>Выбрать PDF</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setShowPaywall(true)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Улучшить до Pro · $7/месяц</Text>
            </Pressable>
            {status === 'error' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </>
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
  header: { height: 76, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#283139' },
  logo: { color: '#F6F3EA', fontSize: 24, fontWeight: '800' },
  label: { color: '#A7B3B0', fontSize: 10, letterSpacing: 1 },
  content: { flex: 1, padding: 26, justifyContent: 'center' },
  title: { color: '#F6F3EA', fontSize: 32, lineHeight: 39, fontWeight: '800' },
  secondary: { color: '#B6C1BD', fontSize: 16, lineHeight: 24, marginTop: 14 },
  button: { marginTop: 28, minHeight: 54, backgroundColor: '#E47752', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#101418', fontSize: 16, fontWeight: '800' },
  secondaryButton: { marginTop: 12, minHeight: 50, borderWidth: 1, borderColor: '#E47752', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#E47752', fontSize: 15, fontWeight: '700' },
  loading: { alignItems: 'center', paddingHorizontal: 12 },
  loadingTitle: { color: '#F6F3EA', fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  error: { color: '#F0A38C', fontSize: 14, lineHeight: 20, marginTop: 18 },
});
