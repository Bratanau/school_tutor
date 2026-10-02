import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useActiveExam } from '../ActiveExamContext';
import { apiGet, apiPost, API_URL, FeedTopic, LearningCard } from '../api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000123';

type TopicCarouselProps = { topic: FeedTopic; active: boolean; pageHeight: number };

function QuizCard({ card, topicId, examId }: { card: LearningCard; topicId: string; examId: string }) {
  const payload = card.quiz_payload ?? {};
  const questions = [payload];
  const [questionIndex] = useState(0);
  const currentQuestion = questions[questionIndex] ?? payload;
  const options = currentQuestion.options?.length ? currentQuestion.options : [card.body];
  const correctAnswer = currentQuestion.correct_answer ?? currentQuestion.correctAnswer ?? 0;

  const [selected, setSelected] = useState<number | null>(null);

  const answer = async (index: number) => {
    if (selected !== null) return;
    setSelected(index);
    // Progress is intentionally fire-and-forget: the answer state is optimistic and
    // a temporary network failure must not interrupt the horizontal learning gesture.
    try {
      await apiPost('/api/progress/track-quiz', {
        exam_id: examId,
        topic_id: topicId,
        card_id: card.id,
        user_id: DEMO_USER_ID,
        is_correct: index === correctAnswer,
      });
    } catch {
      // Keep the selected answer visible if the network is temporarily unavailable.
    }
  };

  return (
    <View style={styles.quizWrap}>
      <Text style={styles.kicker}>ПРОВЕРКА ЗНАНИЙ</Text>
      <Text style={styles.quizQuestion}>{currentQuestion.question ?? card.title}</Text>
      {options.map((option, index) => {
        const chosen = selected === index;
        const correct = index === correctAnswer;
        return (
          <Pressable
            key={`${card.id}-${index}`}
            onPress={() => answer(index)}
            style={[styles.option, chosen && (correct ? styles.optionCorrect : styles.optionWrong)]}
          >
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>
        );
      })}
      {selected !== null && (
        <Text style={selected === correctAnswer ? styles.correctText : styles.wrongText}>
          {selected === correctAnswer ? 'Верно. Тема закреплена.' : 'Не страшно. Вернись к теории и попробуй снова.'}
        </Text>
      )}
    </View>
  );
}

function LearningCardView({ card, topic }: { card: LearningCard; topic: FeedTopic }) {
  if (card.card_type === 'quiz') {
    return <QuizCard card={card} topicId={topic.id} examId={topic.exam_id} />;
  }
  return (
    <View style={styles.cardContent}>
      {card.media_url && (
        <View style={styles.wikipediaMedia}>
          <Image source={{ uri: card.media_url?.startsWith('/') ? `${API_URL}${card.media_url}` : card.media_url }} resizeMode="contain" style={styles.cardMedia} />
          {card.media_caption && <Text style={styles.mediaCaption}>{card.media_caption}</Text>}
        </View>
      )}
      <ScrollView style={styles.cardTextScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <Text style={styles.depth}>УРОВЕНЬ {card.depth_level}</Text>
        <Text style={styles.cardTitle}>{card.title}</Text>
        <Text style={styles.cardBody}>{card.body}</Text>
        {card.formula && <Text style={styles.formulaBlock}>{card.formula}</Text>}
        {card.code_block && <Text style={styles.codeBlock}>{card.code_block}</Text>}
        <Text style={styles.generated}>Wikipedia · проверено YandexGPT</Text>
      </ScrollView>
    </View>
  );
}

function AskButton({ card }: { card: LearningCard }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const result = await apiPost<{ answer: string }>('/api/ai/chat', { question: question.trim(), card_title: card.title, card_body: card.body });
      setAnswer(result.answer);
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'Не удалось получить ответ');
    } finally { setLoading(false); }
  };
  return <>
    <Pressable style={styles.askButton} onPress={() => setOpen(true)} accessibilityLabel="Спросить ИИ"><Ionicons name="sparkles" size={21} color="#111" /></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.modalBackdrop}><View style={styles.chatPanel}><Text style={styles.chatTitle}>Спросить по карточке</Text>
        <TextInput value={question} onChangeText={setQuestion} placeholder="Что непонятно?" placeholderTextColor="#777" multiline style={styles.chatInput} />
        {answer ? <ScrollView style={styles.chatAnswer}><Text style={styles.chatAnswerText}>{answer}</Text></ScrollView> : null}
        <Pressable style={styles.chatSend} onPress={() => { void ask(); }}><Text style={styles.chatSendText}>{loading ? 'ОТВЕЧАЕМ...' : 'СПРОСИТЬ'}</Text></Pressable>
        <Pressable onPress={() => setOpen(false)}><Text style={styles.chatClose}>Закрыть</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
function TopicCarousel({ topic, active, pageHeight }: TopicCarouselProps) {
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [depth, setDepth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedDepth = useRef(new Set<number>());

  const loadNextDepth = useCallback(async () => {
    const nextDepth = depth + 1;
    if (loading || requestedDepth.current.has(nextDepth) || topic.feed_type !== 'topic') return;
    requestedDepth.current.add(nextDepth);
    setLoading(true);
    setError(null);
    try {
      const next = await apiGet<LearningCard[]>(
        `/api/feed/horizontal?topic_id=${encodeURIComponent(topic.id)}&current_depth_level=${depth}&limit=2`,
      );
      setCards((current) => {
        const existing = new Set(current.map((card) => card.id));
        return [...current, ...next.filter((card) => !existing.has(card.id))];
      });
      setDepth((current) => Math.max(current, nextDepth));
    } catch (requestError) {
      requestedDepth.current.delete(nextDepth);
      setError(requestError instanceof Error ? requestError.message : 'Не удалось догрузить уровень');
    } finally {
      setLoading(false);
    }
  }, [depth, loading, topic.feed_type, topic.id]);

  useEffect(() => {
    setCards([]);
    setDepth(0);
    requestedDepth.current.clear();
    setError(null);
  }, [topic.id]);

  useEffect(() => {
    if (active && cards.length === 0) void loadNextDepth();
  }, [active, cards.length, loadNextDepth]);

  const renderCard = ({ item }: { item: LearningCard }) => (
    <View style={[styles.horizontalPage, { height: pageHeight }]}>
      <LearningCardView card={item} topic={topic} />
      <AskButton card={item} />
    </View>
  );

  if (topic.feed_type === 'global_quiz') {
    return (
      <View style={styles.topicPage}>
        <Text style={styles.globalIcon}>✦</Text>
        <Text style={styles.globalTitle}>Global Exam Quiz</Text>
        <Text style={styles.topicSummary}>Скоро здесь появится случайный вопрос по всему экзамену.</Text>
      </View>
    );
  }

  return (
    <View style={styles.topicPage}>
      <FlatList
        data={cards}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(card) => card.id}
        renderItem={renderCard}
        onEndReached={() => { void loadNextDepth(); }}
        onEndReachedThreshold={0.7}
        ListEmptyComponent={loading ? <View style={[styles.loadingPage, { height: pageHeight }]}><ActivityIndicator color="#F28A62" size="large" /><Text style={styles.loadingText}>Готовим карточки...</Text></View> : <Text style={styles.topicSummary}>{error ?? 'Карточки пока недоступны'}</Text>}
      />
      {error && cards.length > 0 && <Pressable onPress={() => { requestedDepth.current.clear(); void loadNextDepth(); }} style={styles.retry}><Text style={styles.retryText}>Повторить загрузку</Text></Pressable>}
    </View>
  );
}

export default function FeedScreen() {
  const { activeExamId, isLoadingActiveExam } = useActiveExam();
  const [topics, setTopics] = useState<FeedTopic[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => Math.max(Dimensions.get('window').height - 64, 1));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeExamId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setTopics(await apiGet<FeedTopic[]>(`/api/feed/vertical?exam_id=${encodeURIComponent(activeExamId)}&user_id=${DEMO_USER_ID}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить ленту');
    } finally {
      setLoading(false);
    }
  }, [activeExamId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const fetchMoreTopics = useCallback(async () => {
    if (!activeExamId || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await apiGet<FeedTopic[]>(`/api/feed/vertical?exam_id=${encodeURIComponent(activeExamId)}&user_id=${DEMO_USER_ID}&limit=15`);
      setTopics((current) => {
        const existing = new Set(current.map((topic) => topic.id));
        return [...current, ...next.filter((topic) => !existing.has(topic.id))];
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось догрузить темы');
    } finally {
      setLoadingMore(false);
    }
  }, [activeExamId, loadingMore]);

  const onFeedLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0 && nextHeight !== viewportHeight) setViewportHeight(nextHeight);
  }, [viewportHeight]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  if (isLoadingActiveExam || loading) return <View style={styles.center}><ActivityIndicator color="#F28A62" size="large" /><Text style={styles.loadingText}>Загружаем подготовку...</Text></View>;
  if (!activeExamId) return <View style={styles.center}><Ionicons name="school-outline" size={54} color="#F28A62" /><Text style={styles.emptyTitle}>Выберите экзамен</Text><Text style={styles.topicSummary}>Перейдите в каталог и выберите экзамен.</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;

  return (
    <FlatList
      onLayout={onFeedLayout}
      style={styles.feed}
      data={topics}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      keyExtractor={(topic) => topic.id}
      renderItem={({ item, index }) => <TopicCarousel topic={item} active={index === activeIndex} pageHeight={viewportHeight} />}
      snapToInterval={viewportHeight}
      decelerationRate="fast"
      disableIntervalMomentum
      onEndReached={fetchMoreTopics}
      onEndReachedThreshold={0.5}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({ length: viewportHeight, offset: viewportHeight * index, index })}
    />
  );
}

const styles = StyleSheet.create({
  feed: { flex: 1, backgroundColor: '#050505' },
  center: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center', padding: 28 },
  topicPage: { width: SCREEN_WIDTH, backgroundColor: '#050505' },
  horizontalPage: { width: SCREEN_WIDTH, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 18 },
  topicHeader: { position: 'absolute', top: 28, left: 24, right: 24 },
  topicIndex: { color: '#F28A62', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  topicTitle: { color: '#fff', fontSize: 25, fontWeight: '900', marginTop: 8 },
  topicSummary: { color: '#AAA', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 13 },
  cardContent: { width: '100%', height: '92%', alignSelf: 'center', justifyContent: 'center' },
  wikipediaMedia: { maxHeight: '36%', alignItems: 'center', marginBottom: 10, padding: 6, backgroundColor: '#111', borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  cardMedia: { width: '100%', height: 190, maxHeight: 230, borderRadius: 8 },
  mediaCaption: { color: '#8E8E8E', fontSize: 11, fontStyle: 'italic', lineHeight: 16, textAlign: 'center', marginTop: 6 },
  cardTextScroll: { flex: 1 },
  mediaCard: { flex: 1, alignSelf: 'stretch' },
  theoryWrap: { width: '80%', alignSelf: 'center' },
  depth: { color: '#F28A62', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 8 },
  cardTitle: { color: '#fff', fontSize: 18, lineHeight: 23, fontWeight: '900', marginBottom: 8 },
  cardBody: { color: '#E2E2E2', fontSize: 16, lineHeight: 23 },
  formulaBlock: { color: '#F7D794', backgroundColor: '#211D12', borderWidth: 1, borderColor: '#6B5524', borderRadius: 6, padding: 12, marginTop: 14, fontSize: 17, lineHeight: 25, textAlign: 'center' },
  codeBlock: { color: '#D8F3DC', backgroundColor: '#101B14', borderWidth: 1, borderColor: '#244C31', borderRadius: 6, padding: 10, marginTop: 14, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  generated: { color: '#666', fontSize: 10, marginTop: 14 },
  askButton: { position: 'absolute', right: 18, bottom: 28, width: 46, height: 46, borderRadius: 23, backgroundColor: '#F28A62', alignItems: 'center', justifyContent: 'center', elevation: 5 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  chatPanel: { backgroundColor: '#151515', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, minHeight: 300 },
  chatTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 14 },
  chatInput: { color: '#fff', minHeight: 80, borderWidth: 1, borderColor: '#444', borderRadius: 6, padding: 12, textAlignVertical: 'top' },
  chatAnswer: { maxHeight: 180, marginTop: 14 },
  chatAnswerText: { color: '#ddd', fontSize: 15, lineHeight: 22 },
  chatSend: { backgroundColor: '#F28A62', padding: 14, alignItems: 'center', marginTop: 14, borderRadius: 6 },
  chatSendText: { color: '#111', fontWeight: '900' },
  chatClose: { color: '#aaa', textAlign: 'center', marginTop: 16 },
  avatar: { display: 'none' },
  avatarText: { display: 'none' },
  actionButton: { display: 'none' },
  actionLabel: { display: 'none' },
  masteryBadge: { display: 'none' },
  masteryValue: { display: 'none' },
  loadingPage: { width: SCREEN_WIDTH, height: 120, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#999', marginTop: 12, fontSize: 14 },
  quizWrap: { width: '88%', alignSelf: 'center' },
  kicker: { color: '#F28A62', fontWeight: '900', letterSpacing: 1.5, marginBottom: 16 },
  quizQuestion: { color: '#fff', fontSize: 20, lineHeight: 26, fontWeight: '900', marginBottom: 16 },
  option: { minHeight: 52, borderWidth: 1, borderColor: '#3A3A3A', padding: 15, justifyContent: 'center', marginTop: 10, borderRadius: 6 },
  optionCorrect: { borderColor: '#73C99A', backgroundColor: '#173A2A' },
  optionWrong: { borderColor: '#D87868', backgroundColor: '#421F1F' },
  optionText: { color: '#fff', fontSize: 16 },
  correctText: { color: '#73C99A', marginTop: 18, fontWeight: '700' },
  wrongText: { color: '#D87868', marginTop: 18, fontWeight: '700' },
  globalIcon: { color: '#F28A62', fontSize: 48, textAlign: 'center' },
  globalTitle: { color: '#fff', fontSize: 29, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  emptyTitle: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 14 },
  error: { color: '#D87868', textAlign: 'center', lineHeight: 21 },
  retry: { marginTop: 18, borderWidth: 1, borderColor: '#F28A62', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 6 },
  retryText: { color: '#F28A62', fontWeight: '800' },
});
