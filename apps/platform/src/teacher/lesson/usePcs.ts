import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentData, type Timestamp } from 'firebase/firestore';
import type { PcCard } from '@infoklas/shared/lesson';
import { RETRY_MS } from '../../firebase/app';
import { errorText } from '../../firebase/errors';
import { pcsCol } from '../../data/room';

const SKEW_SAMPLES = 20;

const ms = (t: unknown) =>
  t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0;

function toCard(id: string, d: DocumentData): PcCard {
  return {
    id,
    num: typeof d.num === 'number' ? d.num : Number(id.slice(2)) || 0,
    name: typeof d.name === 'string' ? d.name : '',
    studentId: typeof d.studentId === 'string' ? d.studentId : null,
    lastSeen: ms(d.lastSeen),
    openedAt: d.openedAt ?? null,
    submittedAt: d.submittedAt ?? null,
    doneAt: d.doneAt ?? null,
    handAt: ms(d.handAt) || null,
    handId: d.handId ?? null,
  };
}

/**
 * PC cards of the lab + the laptop's clock skew against the server. The skew is
 * the minimum of `Date.now() − lastSeen` over fresh card changes (not the first
 * snapshot with old lastSeen values), as in Клас-пульт.
 */
export function usePcs() {
  const [state, setState] = useState<{
    pcs: PcCard[];
    skew: number;
    error: string | null;
    loading: boolean;
  }>({
    pcs: [],
    skew: 0,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let stopped = false;
    let unsub: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const samples: number[] = [];
    let loaded = false;

    const start = () => {
      timer = null;
      unsub = onSnapshot(
        pcsCol(),
        (snap) => {
          if (loaded) {
            for (const change of snap.docChanges()) {
              if (change.type === 'removed' || change.doc.metadata.hasPendingWrites) continue;
              const seen = ms(change.doc.get('lastSeen'));
              if (seen) {
                samples.push(Date.now() - seen);
                if (samples.length > SKEW_SAMPLES) samples.shift();
              }
            }
          }
          loaded = true;
          const pcs = snap.docs
            .map((d) => toCard(d.id, d.data({ serverTimestamps: 'estimate' })))
            .sort((a, b) => a.num - b.num);
          setState({
            pcs,
            skew: samples.length ? Math.min(...samples) : 0,
            error: null,
            loading: false,
          });
        },
        (err) => {
          unsub = null;
          setState((s) => ({ ...s, error: errorText(err), loading: false }));
          if (!stopped) timer = setTimeout(start, RETRY_MS);
        },
      );
    };
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (unsub) unsub();
    };
  }, []);

  return state;
}
