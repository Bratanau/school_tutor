import { Platform } from 'react-native';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (
  Platform.OS === 'web' || Platform.OS === 'ios' ? 'http://127.0.0.1:8000' : 'http://10.0.2.2:8000'
);

export type StoryCard = {
  id: string;
  position: number;
  title: string | null;
  text: string;
  image_prompt: string;
  image_url: string | null;
  audio_url: string | null;
};

export type Story = {
  id: string;
  user_id: string;
  category_id: number | null;
  category_title: string | null;
  category_emoji: string | null;
  title: string;
  image_url: string | null;
  audio_url: string | null;
  text_script: string;
  created_at: string;
  status: 'DRAFT' | 'PUBLISHED';
  likes_count: number;
  comments_count: number;
  is_liked: boolean;
  cards?: StoryCard[];
};

export type Category = { id: number; title: string; emoji: string; slug: string };

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? payload?.detail ?? `Ошибка сервера (${response.status})`);
  return payload as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? payload?.detail ?? `Ошибка сервера (${response.status})`);
  return payload as T;
}
