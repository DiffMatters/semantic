/**
 * Options persisted in localStorage, exposed through useSyncExternalStore so the server render
 * (and hydration) use the defaults and the stored value applies right after, without effects.
 * Only options are stored; pane contents never are.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_OPTIONS, sanitizeOptions, type UiOptions } from "./options";

const STORAGE_KEY = "config-diff:options:v1";

let current: UiOptions | null = null;
const listeners = new Set<() => void>();

function read(): UiOptions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeOptions(JSON.parse(raw)) : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function getSnapshot(): UiOptions {
  if (current === null) current = read();
  return current;
}

function getServerSnapshot(): UiOptions {
  return DEFAULT_OPTIONS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = read();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setOptions(update: UiOptions | ((prev: UiOptions) => UiOptions)): void {
  current = typeof update === "function" ? update(getSnapshot()) : update;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage may be unavailable (private mode, quota); options still apply for this session.
  }
  emit();
}

export function useOptions(): [UiOptions, typeof setOptions] {
  const options = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [options, setOptions];
}
