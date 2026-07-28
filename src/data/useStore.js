import { useSyncExternalStore } from "react";
import { subscribe, getState } from "./store.js";

// The whole state, or nothing. `state` is replaced immutably on every commit,
// so the identity check useSyncExternalStore performs is exact and cheap, and
// components can destructure whatever they need without a selector API. At
// this data size (one person's workday) a selector layer would buy nothing but
// a class of stale-render bugs.
export function useStore() {
  return useSyncExternalStore(subscribe, getState, getState);
}
