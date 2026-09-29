import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type Query,
} from 'firebase/firestore';
import { RETRY_MS } from './app';
import { errorText } from './errors';

export interface DocState<T> {
  loading: boolean;
  exists: boolean;
  data: T | null;
  /** Данные из локального кеша (нет связи с сервером). */
  fromCache: boolean;
  error: string | null;
}

/**
 * Подписка на документ с переподключением через 5 с после ошибки
 * (как App.watch в Клас-пульте). `ref === null` — не подписываться.
 */
export function useDoc<T = DocumentData>(ref: DocumentReference | null): DocState<T> {
  const path = ref?.path ?? null;
  const [s, setS] = useState<DocState<T>>({
    loading: true,
    exists: false,
    data: null,
    fromCache: false,
    error: null,
  });

  useEffect(() => {
    // A different document: don't show the previous one's data meanwhile.
    setS({ loading: true, exists: false, data: null, fromCache: false, error: null });
    if (!ref) return;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      timer = null;
      unsubscribe = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) =>
          setS({
            loading: false,
            exists: snap.exists(),
            data: snap.exists() ? (snap.data() as T) : null,
            fromCache: snap.metadata.fromCache,
            error: null,
          }),
        (err) => {
          unsubscribe = null;
          setS((cur) => ({ ...cur, loading: false, error: errorText(err) }));
          if (!stopped) timer = setTimeout(start, RETRY_MS);
        },
      );
    };
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
    // The path identifies the reference; ref objects are recreated on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return s;
}

export interface QueryState<T> {
  loading: boolean;
  docs: { id: string; data: T }[];
  error: string | null;
}

/**
 * Подписка на запрос с переподключением через 5 с после ошибки. Запросы Firestore
 * нельзя сравнить, поэтому подписка пересоздаётся при смене `key`.
 */
export function useQuery<T = DocumentData>(q: Query | null, key: string): QueryState<T> {
  const [s, setS] = useState<QueryState<T>>({ loading: true, docs: [], error: null });

  useEffect(() => {
    setS({ loading: true, docs: [], error: null });
    if (!q) return;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      timer = null;
      unsubscribe = onSnapshot(
        q,
        (snap) =>
          setS({
            loading: false,
            docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as T })),
            error: null,
          }),
        (err) => {
          unsubscribe = null;
          setS((cur) => ({ ...cur, loading: false, error: errorText(err) }));
          if (!stopped) timer = setTimeout(start, RETRY_MS);
        },
      );
    };
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
    // `key` identifies the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return s;
}
