import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  Dimensions,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type ContentCard = {
  type: 'text' | 'audio';
  title?: string;
  text: string;
  audioUrl?: string;
};

export type Quiz = {
  question: string;
  options: string[];
  correctAnswer: number;
};

export type Topic = {
  title: string;
  cards: ContentCard[];
  quiz: Quiz;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MOCK_TOPICS: Topic[] = [
  {
    title: 'The attention economy',
    cards: [
      { type: 'text', title: 'Key idea', text: 'Short, focused learning units make the main idea easier to retrieve later.' },
      { type: 'text', title: 'Go deeper', text: 'Swipe horizontally to move through evidence, examples, and explanations for this topic.' },
      { type: 'audio', title: 'Audio recap', text: 'This is where an ElevenLabs-generated audio player will appear.' },
    ],
    quiz: {
      question: 'Which swipe changes the current topic?',
      options: ['Vertical swipe', 'Horizontal swipe', 'Tap the logo'],
      correctAnswer: 0,
    },
  },
  {
    title: 'Retrieval practice',
    cards: [
      { type: 'text', title: 'Core idea', text: 'Testing yourself is a learning action, not only an assessment.' },
      { type: 'text', title: 'Feedback loop', text: 'Each answer can explain the mistake and send the learner back to the relevant card.' },
    ],
    quiz: {
      question: 'Where does the quiz appear?',
      options: ['At the beginning', 'As the final horizontal page', 'Only on the home screen'],
      correctAnswer: 1,
    },
  },
];

function AudioCard({ card, active }: { card: ContentCard; active: boolean }) {
  const player = useAudioPlayer(card.audioUrl ?? null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!active && status.playing) player.pause();
  }, [active, player, status.playing]);

  function togglePlayback() {
    if (!active || !card.audioUrl) return;
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }
  return (
    <View style={styles.contentCard}>
      <Text style={styles.cardType}>AUDIO</Text>
      <Text style={styles.cardTitle}>{card.title ?? 'Audio recap'}</Text>
      <Text style={styles.cardText}>{card.text}</Text>
      <Pressable disabled={!card.audioUrl} onPress={togglePlayback} style={styles.audioButton}>
        <Text style={styles.audioButtonText}>{status.playing ? 'Pause' : card.audioUrl ? 'Play' : 'Audio unavailable'}</Text>
      </Pressable>
    </View>
  );
}

function ContentCardView({ card }: { card: ContentCard }) {
  return (
    <View style={styles.contentCard}>
      <Text style={styles.cardType}>{card.type === 'audio' ? 'AUDIO' : 'READ'}</Text>
      <Text style={styles.cardTitle}>{card.title ?? 'Learning card'}</Text>
      <Text style={styles.cardText}>{card.text}</Text>
      {card.type === 'audio' && <Text style={styles.audioButtonText}>Audio ready soon</Text>}
    </View>
  );
}

function QuizCard({ quiz }: { quiz: Quiz }) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <View style={styles.contentCard}>
      <Text style={styles.cardType}>QUIZ</Text>
      <Text style={styles.cardTitle}>{quiz.question}</Text>
      {quiz.options.map((option, index) => {
        const isSelected = selected === index;
        const isCorrect = index === quiz.correctAnswer;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            onPress={() => setSelected(index)}
            style={[styles.option, isSelected && (isCorrect ? styles.correct : styles.incorrect)]}
          >
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>
        );
      })}
      {selected !== null && (
        <Text style={selected === quiz.correctAnswer ? styles.correctFeedback : styles.feedback}>
          {selected === quiz.correctAnswer ? 'Correct answer' : 'Not quite. Review the cards and try again.'}
        </Text>
      )}
    </View>
  );
}

function TopicPage({ topic, topicActive }: { topic: Topic; topicActive: boolean }) {
  const horizontalPages = useMemo(() => [...topic.cards, topic.quiz], [topic]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const index = viewableItems[0]?.index;
    if (index !== null && index !== undefined) setActiveItemIndex(index);
  }).current;
  const renderCard = useCallback(({ item, index }: ListRenderItemInfo<ContentCard | Quiz>) => (
    <View style={styles.horizontalPage}>
      {'question' in item ? <QuizCard quiz={item} /> : item.type === 'audio' ? <AudioCard card={item} active={topicActive && activeItemIndex === index} /> : <ContentCardView card={item} />}
    </View>
  ), [activeItemIndex, topicActive]);

  return (
    <FlatList
      data={horizontalPages}
      horizontal
      pagingEnabled
      bounces={false}
      showsHorizontalScrollIndicator={false}
      keyExtractor={(_, index) => `${topic.title}-${index}`}
      renderItem={renderCard}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
    />
  );
}

export default function FeedScreen({ topics: incomingTopics }: { topics?: Topic[] }) {
  const [topics] = useState<Topic[]>(incomingTopics ?? MOCK_TOPICS);
  const [activeTopicIndex, setActiveTopicIndex] = useState(0);
  const verticalListRef = useRef<FlatList<Topic>>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableTopicsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const index = viewableItems[0]?.index;
    if (index !== null && index !== undefined) setActiveTopicIndex(index);
  }).current;

  const renderTopic = useCallback(({ item, index }: ListRenderItemInfo<Topic>) => (
    <View style={styles.topicPage}>
      <View style={styles.topicHeader}>
        <Text style={styles.topicTitle}>{item.title}</Text>
        <Text style={styles.topicMeta}>Swipe sideways to explore</Text>
      </View>
      <TopicPage topic={item} topicActive={activeTopicIndex === index} />
    </View>
  ), [activeTopicIndex]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.logo}>ScrollEd</Text>
        <Text style={styles.headerMeta}>LEARN IN MOTION</Text>
      </View>
      <FlatList
        ref={verticalListRef}
        data={topics}
        pagingEnabled
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyExtractor={(item) => item.title}
        renderItem={renderTopic}
        onViewableItemsChanged={onViewableTopicsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: Dimensions.get('window').height - 124, offset: (Dimensions.get('window').height - 124) * index, index })}
        nestedScrollEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101418' },
  header: { height: 76, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#283139' },
  logo: { color: '#F6F3EA', fontSize: 24, fontWeight: '800' },
  headerMeta: { color: '#A7B3B0', fontSize: 11, letterSpacing: 1.1 },
  topicPage: { width: SCREEN_WIDTH, height: Dimensions.get('window').height - 124, paddingTop: 24 },
  topicHeader: { paddingHorizontal: 24, height: 112 },
  topicTitle: { color: '#F6F3EA', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  topicMeta: { color: '#A7B3B0', marginTop: 10, fontSize: 13 },
  horizontalPage: { width: SCREEN_WIDTH, paddingHorizontal: 20, justifyContent: 'center' },
  contentCard: { minHeight: 370, borderRadius: 8, backgroundColor: '#F6F3EA', padding: 26, justifyContent: 'center' },
  cardType: { color: '#C45135', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginBottom: 18 },
  cardTitle: { color: '#172027', fontSize: 28, lineHeight: 34, fontWeight: '800', marginBottom: 18 },
  cardText: { color: '#45545A', fontSize: 18, lineHeight: 28 },
  audioButton: { marginTop: 24, minHeight: 48, borderWidth: 1, borderColor: '#C45135', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  audioButtonText: { color: '#C45135', fontSize: 15, fontWeight: '800' },
  option: { minHeight: 50, justifyContent: 'center', borderWidth: 1, borderColor: '#C5CBC4', borderRadius: 6, paddingHorizontal: 14, marginTop: 10 },
  optionText: { color: '#172027', fontSize: 16 },
  correct: { backgroundColor: '#B8D9C6', borderColor: '#397354' },
  incorrect: { backgroundColor: '#F0C9BC', borderColor: '#A84732' },
  feedback: { color: '#A84732', fontSize: 14, marginTop: 16 },
  correctFeedback: { color: '#397354', fontSize: 14, marginTop: 16 },
});
