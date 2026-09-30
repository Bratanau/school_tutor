import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useActiveExam } from '../ActiveExamContext';
import { apiGet, FeedTopic } from '../api';

function ProgressBar({ value, color }: { value: number; color: string }) {
  return <View style={styles.bar}><View style={[styles.fill, { width: `${Math.max(0, Math.min(value, 100))}%`, backgroundColor: color }]} /></View>;
}

export default function ProgressScreen() {
  const { activeExamId, isLoadingActiveExam } = useActiveExam();
  const [topics, setTopics] = useState<FeedTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    if (!activeExamId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    try {
      const result = await apiGet<FeedTopic[]>(`/api/feed/vertical?exam_id=${encodeURIComponent(activeExamId)}&limit=5`);
      setTopics(result.filter((topic) => topic.feed_type === 'topic'));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить отчет');
    } finally {
      setLoading(false);
    }
  }, [activeExamId, refreshKey]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const strong = useMemo(() => topics.filter((topic) => (topic.mastery_score ?? 0) >= 90).slice(0, 3), [topics]);
  const weak = useMemo(() => topics.filter((topic) => (topic.mastery_score ?? 0) < 50), [topics]);

  if (isLoadingActiveExam || loading) return <View style={styles.center}><ActivityIndicator color="#F28A62" size="large" /></View>;
  if (!activeExamId) return <View style={styles.center}><Text style={styles.empty}>Перейдите в каталог и выберите экзамен.</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable onPress={() => setRefreshKey((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;

  return (
    <View style={styles.safe}>
      <Text style={styles.eyebrow}>ПРОФИЛЬ ЗНАНИЙ</Text>
      <Text style={styles.title}>Мой прогресс</Text>
      {!topics.length ? <Text style={styles.empty}>Создайте экзамен, чтобы увидеть аналитику по темам.</Text> : (
        <>
          <Text style={styles.sectionTitle}>Отличные темы</Text>
          {strong.length ? strong.map((topic) => <TopicRow key={topic.id} topic={topic} color="#73C99A" />) : <Text style={styles.muted}>Пока нет тем с результатом 90% и выше.</Text>}
          <Text style={styles.sectionTitle}>Проблемные зоны</Text>
          {weak.length ? weak.map((topic) => <TopicRow key={topic.id} topic={topic} color="#F28A62" />) : <Text style={styles.muted}>Критичных пробелов не найдено.</Text>}
        </>
      )}
    </View>
  );
}

function TopicRow({ topic, color }: { topic: FeedTopic; color: string }) {
  const score = topic.mastery_score ?? 0;
  return <View style={styles.row}><View style={styles.rowHead}><Text style={styles.topicName} numberOfLines={1}>{topic.title}</Text><Text style={[styles.score, { color }]}>{Math.round(score)}%</Text></View><ProgressBar value={score} color={color} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050505', padding: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050505', padding: 28 },
  eyebrow: { color: '#F28A62', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: 12 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 7 },
  sectionTitle: { color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 34, marginBottom: 12 },
  row: { marginBottom: 18 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  topicName: { color: '#E8E8E8', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 12 },
  score: { fontWeight: '900', fontSize: 15 },
  bar: { height: 8, backgroundColor: '#242424', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  muted: { color: '#777', lineHeight: 21 },
  empty: { color: '#999', lineHeight: 23, marginTop: 24 },
  error: { color: '#D87868', textAlign: 'center' },
  retry: { marginTop: 18, borderWidth: 1, borderColor: '#F28A62', padding: 12, borderRadius: 6 },
  retryText: { color: '#F28A62', fontWeight: '800' },
});
