import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { apiGet } from './api';

const ACTIVE_EXAM_KEY = 'scrolled.active-exam-id';

type ActiveExamContextValue = {
  activeExamId: string | null;
  isLoadingActiveExam: boolean;
  setActiveExamId: (examId: string | null) => Promise<void>;
};

const ActiveExamContext = createContext<ActiveExamContextValue | undefined>(undefined);

export function ActiveExamProvider({ children }: { children: ReactNode }) {
  const [activeExamId, setActiveExamIdState] = useState<string | null>(null);
  const [isLoadingActiveExam, setIsLoadingActiveExam] = useState(true);

  useEffect(() => {
    void AsyncStorage.getItem(ACTIVE_EXAM_KEY)
      .then(async (storedId) => {
        if (storedId) return storedId;
        const exams = await apiGet<{ id: string }[]>('/api/exams/me');
        return exams[0]?.id ?? null;
      })
      .then(setActiveExamIdState)
      .catch(() => setActiveExamIdState(null))
      .finally(() => setIsLoadingActiveExam(false));
  }, []);

  const setActiveExamId = useCallback(async (examId: string | null) => {
    setActiveExamIdState(examId);
    if (examId) {
      await AsyncStorage.setItem(ACTIVE_EXAM_KEY, examId);
    } else {
      await AsyncStorage.removeItem(ACTIVE_EXAM_KEY);
    }
  }, []);

  return (
    <ActiveExamContext.Provider value={{ activeExamId, isLoadingActiveExam, setActiveExamId }}>
      {children}
    </ActiveExamContext.Provider>
  );
}

export function useActiveExam(): ActiveExamContextValue {
  const context = useContext(ActiveExamContext);
  if (!context) throw new Error('useActiveExam must be used inside ActiveExamProvider');
  return context;
}
