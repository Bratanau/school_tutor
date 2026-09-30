import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const API_URL = env?.EXPO_PUBLIC_API_URL ?? (
  Platform.OS === 'web' || Platform.OS === 'ios'
    ? 'http://192.168.0.106:8000'
    : 'http://10.0.2.2:8000'
);

const CURRENT_EXAM_KEY = 'scrolled.current-exam-id';

export type Exam = {
  id: string;
  name: string;
  topics_count: number;
  created_at: string;
  updated_at: string;
};

export type ExamTopic = {
  id: string;
  exam_id: string;
  title: string;
  description: string;
  mastery_score: number;
  assessment_completed: boolean;
};

export type FeedTopic = {
  id: string;
  exam_id: string;
  title: string;
  summary: string;
  mastery_score: number | null;
  exposure_seconds: number;
  feed_type: 'topic' | 'global_quiz';
};

export type QuizPayload = {
  question?: string;
  options?: string[];
  correct_answer?: number;
  correctAnswer?: number;
  questions?: QuizPayload[];
};

export type LearningCard = {
  id: string;
  topic_id: string;
  depth_level: number;
  position: number;
  card_type: 'content' | 'quiz' | 'assessment';
  title: string;
  body: string;
  quiz_payload: QuizPayload | null;
  media_url: string | null;
  media_caption: string | null;
  code_block: string | null;
  generated_by: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.detail ?? `Server error (${response.status})`);
  }
  return payload as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(`${API_URL}${path}`));
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Server error (${response.status})`);
}
export async function getCurrentExamId(): Promise<string | null> {
  return AsyncStorage.getItem(CURRENT_EXAM_KEY);
}

export async function setCurrentExamId(examId: string): Promise<void> {
  await AsyncStorage.setItem(CURRENT_EXAM_KEY, examId);
}
