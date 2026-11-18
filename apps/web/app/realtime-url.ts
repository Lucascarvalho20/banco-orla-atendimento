'use client';

import { useEffect, useState } from 'react';

const FALLBACK = 'http://127.0.0.1:4000';

/** Mesmo host da página + porta do realtime — evita localhost vs 127.0.0.1. */
export function resolveRealtimeUrl(): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL ?? FALLBACK;
  if (typeof window === 'undefined') return configured;
  try {
    const port = new URL(configured).port || '4000';
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  } catch {
    return configured;
  }
}

export function useRealtimeUrl(): string {
  const [url, setUrl] = useState(resolveRealtimeUrl);
  useEffect(() => {
    setUrl(resolveRealtimeUrl());
  }, []);
  return url;
}
