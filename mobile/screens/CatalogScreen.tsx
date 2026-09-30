import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useActiveExam } from '../ActiveExamContext';
import { apiDelete, apiGet, Exam, ExamTopic } from '../api';

type CatalogExam = Exam & { learned_topics?: number };

export default function CatalogScreen() {
  const { activeExamId, setActiveExamId } = useActiveExam();
  const [exams, setExams] = useState<CatalogExam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<Record<string, ExamTopic[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExams(await apiGet<CatalogExam[]>('/api/exams/me'));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить каталог');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggleExam = async (examId: string) => {
    await setActiveExamId(examId);
    if (topics[examId]) {
      setTopics((current) => { const next = { ...current }; delete next[examId]; return next; });
      return;
    }
    const result = await apiGet<ExamTopic[]>(`/api/exams/${examId}/topics`);
    setTopics((current) => ({ ...current, [examId]: result }));
  };

  const removeExam = async (examId: string) => {
    await apiDelete(`/api/exams/${examId}`);
    if (activeExamId === examId) await setActiveExamId(null);
    setExams((current) => current.filter((exam) => exam.id !== examId));
    setTopics((current) => { const next = { ...current }; delete next[examId]; return next; });
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#F28A62" size="large" /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;

  return (
    <FlatList
      style={styles.safe}
      data={exams}
      keyExtractor={(exam) => exam.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<><Text style={styles.eyebrow}>МОИ ЭКЗАМЕНЫ</Text><Text style={styles.title}>Каталог</Text><Text style={styles.subtitle}>Выберите предмет для подготовки.</Text></>}
      ListEmptyComponent={<Text style={styles.empty}>Экзаменов пока нет. Создайте программу во вкладке «Экзамены».</Text>}
      renderItem={({ item }) => {
        const total = item.topics_count;
        const learned = item.learned_topics ?? 0;
        const selected = item.id === activeExamId;
        return <View style={[styles.examCard, selected && styles.examCardSelected]}>
          <Pressable onPress={() => { void toggleExam(item.id); }} style={styles.examButton}>
            <View style={styles.cardTop}><Text style={styles.examName}>{item.name}</Text>{selected && <Text style={styles.selected}>АКТИВЕН</Text>}</View>
            <Text style={styles.progress}>{total} тем · {learned} изучено</Text>
          </Pressable>
          <Pressable onPress={() => { void removeExam(item.id); }} style={styles.deleteButton} accessibilityLabel="Удалить экзамен"><Ionicons name="close" size={20} color="#D87868" /></Pressable>
          {topics[item.id]?.map((topic) => <View key={topic.id} style={styles.topicRow}><Text style={styles.topicTitle}>{topic.title}</Text><Text style={styles.topicScore}>{Math.round(topic.mastery_score)}%</Text></View>)}
        </View>;
      }}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050505' },
  content: { padding: 20, paddingBottom: 38 },
  center: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#F28A62', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: 12 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 7 },
  subtitle: { color: '#919191', fontSize: 15, marginTop: 9, marginBottom: 26 },
  examButton: { paddingRight: 28 },
  deleteButton: { position: 'absolute', top: 12, right: 10, padding: 4 },
  topicRow: { borderTopWidth: 1, borderTopColor: '#292929', paddingVertical: 11, flexDirection: 'row', justifyContent: 'space-between' },
  topicTitle: { color: '#D7D7D7', fontSize: 14, flex: 1, paddingRight: 12 },
  topicScore: { color: '#73C99A', fontWeight: '800', fontSize: 13 },
  examCard: { backgroundColor: '#121212', borderWidth: 1, borderColor: '#292929', borderRadius: 7, padding: 16, marginBottom: 10 },
  examCardSelected: { borderColor: '#F28A62', backgroundColor: '#1A1513' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  examName: { color: '#F5F5F5', fontSize: 17, fontWeight: '900', flex: 1 },
  selected: { color: '#F28A62', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  progress: { color: '#A0A0A0', fontSize: 14, marginTop: 16, marginBottom: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#303030', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#73C99A', borderRadius: 3 },
  empty: { color: '#777', fontSize: 15, lineHeight: 22 },
  error: { color: '#D87868', textAlign: 'center' },
  retry: { marginTop: 18, borderWidth: 1, borderColor: '#F28A62', padding: 12, borderRadius: 6 },
  retryText: { color: '#F28A62', fontWeight: '800' },
});
