import { create } from "zustand";

import type { BookContent, ChapterEntry } from "../lib/types";

interface ReaderSettings {
  wpm: number;
  contextRange: number;
  flankOpacity: number;
  contextOpacity: number;
}

interface ReaderState {
  bookId: string | null;
  filename: string | null;
  words: string[];
  chapters: ChapterEntry[];
  pageMap: Record<string, number>;
  footnotes: Record<string, string>;
  index: number;
  isRunning: boolean;
  settings: ReaderSettings;

  setBook: (payload: { bookId: string; filename: string; content: BookContent }) => void;
  setIndex: (index: number) => void;
  jumpBy: (delta: number) => void;
  jumpToChapter: (startIndex: number) => void;
  nextWord: () => void;
  toggleRunning: () => void;
  setWpm: (wpm: number) => void;
  setContextRange: (value: number) => void;
  setContextOpacity: (value: number) => void;
  setFlankOpacity: (value: number) => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  bookId: null,
  filename: null,
  words: [],
  chapters: [],
  pageMap: {},
  footnotes: {},
  index: 0,
  isRunning: false,
  settings: {
    wpm: 300,
    contextRange: 20,
    flankOpacity: 60,
    contextOpacity: 50,
  },

  setBook: ({ bookId, filename, content }) =>
    set({
      bookId,
      filename,
      words: content.words,
      chapters: content.chapters,
      pageMap: content.page_map,
      footnotes: content.footnotes,
      index: 0,
      isRunning: false,
    }),

  setIndex: (index) =>
    set((state) => {
      if (state.words.length === 0) {
        return { index: 0 };
      }
      const clamped = Math.max(0, Math.min(state.words.length - 1, index));
      return { index: clamped };
    }),

  jumpBy: (delta) =>
    set((state) => {
      if (state.words.length === 0) {
        return { index: 0 };
      }
      const next = Math.max(0, Math.min(state.words.length - 1, state.index + delta));
      return { index: next };
    }),

  jumpToChapter: (startIndex) =>
    set((state) => {
      if (state.words.length === 0) {
        return { index: 0 };
      }
      const clamped = Math.max(0, Math.min(state.words.length - 1, startIndex));
      return { index: clamped };
    }),

  nextWord: () => {
    const state = get();
    if (!state.isRunning || state.words.length === 0) {
      return;
    }

    const next = state.index + 1;
    if (next >= state.words.length) {
      set({ isRunning: false });
      return;
    }
    set({ index: next });
  },

  toggleRunning: () => set((state) => ({ isRunning: !state.isRunning })),

  setWpm: (wpm) =>
    set((state) => ({
      settings: {
        ...state.settings,
        wpm,
      },
    })),

  setContextRange: (value) =>
    set((state) => ({
      settings: {
        ...state.settings,
        contextRange: value,
      },
    })),

  setContextOpacity: (value) =>
    set((state) => ({
      settings: {
        ...state.settings,
        contextOpacity: value,
      },
    })),

  setFlankOpacity: (value) =>
    set((state) => ({
      settings: {
        ...state.settings,
        flankOpacity: value,
      },
    })),
}));
