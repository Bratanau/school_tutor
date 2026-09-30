import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { apiPost, API_URL } from '../api';

export default function ExamsHubScreen() {
  const navigation = useNavigation<any>();
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pdfSubmitting, setPdfSubmitting] = useState(false);

  const createExam = async () => {
    if (!name.trim() || !questions.trim()) {
      Alert.alert('Нужны название и вопросы', 'Укажите название экзамена и вставьте список вопросов.');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost<{ exam_id: string }>('/api/exams/parse', {
        name: name.trim(),
        text: questions.trim(),
      });
      setName('');
      setQuestions('');
      navigation.navigate('Topics');
    } catch (error) {
      Alert.alert('Не удалось создать экзамен', error instanceof Error ? error.message : 'Проверьте подключение к серверу.');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadPdf = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPdfSubmitting(true);
    try {
      const form = new FormData();
      if (Platform.OS === 'web' && asset.file) {
        form.append('file', asset.file);
      } else {
        form.append('file', { uri: asset.uri, name: asset.name, type: 'application/pdf' } as unknown as Blob);
      }
      form.append('name', name.trim() || asset.name.replace(/\.[^.]+$/, ''));
      const response = await fetch(`${API_URL}/api/exams/parse`, { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? payload?.detail ?? 'Не удалось обработать PDF');
      setName('');
      setQuestions('');
      navigation.navigate('Topics');
    } catch (error) {
      Alert.alert('Не удалось загрузить PDF', error instanceof Error ? error.message : 'Проверьте подключение к серверу.');
    } finally {
      setPdfSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.eyebrow}>ДОБАВИТЬ ЭКЗАМЕН</Text>
            <Text style={styles.title}>Новая программа</Text>
            <Text style={styles.subtitle}>Введите вопросы текстом или загрузите PDF.</Text>
          <View style={styles.studio}>
            <Text style={styles.sectionTitle}>Новый экзамен</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Например, Теория государства и права"
              placeholderTextColor="#6E6E6E"
              style={styles.nameInput}
              editable={!submitting}
            />
            <Pressable onPress={() => { void uploadPdf(); }} disabled={submitting || pdfSubmitting} style={styles.pdfButton}>
              <Text style={styles.pdfButtonText}>{pdfSubmitting ? 'ОБРАБАТЫВАЕМ PDF...' : 'ВЫБРАТЬ PDF'}</Text>
            </Pressable>
            <TextInput
              value={questions}
              onChangeText={setQuestions}
              placeholder="Вставьте список билетов или вопросов к экзамену..."
              placeholderTextColor="#6E6E6E"
              multiline
              textAlignVertical="top"
              style={styles.questionsInput}
              editable={!submitting}
            />
            {submitting ? (
              <View style={styles.aiLoading}>
                <ActivityIndicator color="#F28A62" size="large" />
                <Text style={styles.aiLoadingText}>Алгоритм Яндекса формирует вашу образовательную программу...</Text>
              </View>
            ) : (
              <Pressable onPress={() => { void createExam(); }} style={styles.submitButton}>
                <Text style={styles.submitText}>Отправить в ИИ</Text>
              </Pressable>
            )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050505' },
  content: { padding: 20, paddingBottom: 48 },
  eyebrow: { color: '#F28A62', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: 10 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 7 },
  subtitle: { color: '#929292', fontSize: 15, lineHeight: 22, marginTop: 9 },
  pdfButton: { minHeight: 50, marginTop: 12, borderWidth: 1, borderColor: '#5A5A5A', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pdfButtonText: { color: '#E7E7E7', fontWeight: '900' },
  orLabel: { color: '#777', fontSize: 12, textAlign: 'center', marginVertical: 12 },
  studio: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#292929' },
  examList: { marginBottom: 20 },
  examCard: { padding: 14, marginBottom: 8, backgroundColor: '#121212', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 7 },
  examCardActive: { borderColor: '#F28A62', backgroundColor: '#1A1513' },
  examCardName: { color: '#F5F5F5', fontSize: 16, fontWeight: '800' },
  examCardMeta: { color: '#929292', fontSize: 12, marginTop: 6 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 30, marginBottom: 12 },
  nameInput: { color: '#fff', borderWidth: 1, borderColor: '#343434', borderRadius: 6, paddingHorizontal: 14, minHeight: 52, fontSize: 16, backgroundColor: '#101010' },
  questionsInput: { minHeight: 250, maxHeight: 360, color: '#fff', borderWidth: 1, borderColor: '#343434', borderRadius: 6, padding: 14, marginTop: 10, fontSize: 16, lineHeight: 23, backgroundColor: '#101010' },
  submitButton: { minHeight: 54, marginTop: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F28A62', borderRadius: 6 },
  submitText: { color: '#19110F', fontWeight: '900', fontSize: 16 },
  aiLoading: { minHeight: 94, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  aiLoadingText: { color: '#D4D4D4', textAlign: 'center', lineHeight: 20, marginTop: 12 },
});
