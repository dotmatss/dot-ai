import { create } from "zustand";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. `null` keeps the toast until dismissed. */
  duration: number | null;
}

interface ToastState {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id" | "duration"> & { duration?: number | null }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION = 5000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const item: ToastItem = {
      id,
      tone: toast.tone,
      title: toast.title,
      description: toast.description,
      duration: toast.duration === undefined ? DEFAULT_DURATION : toast.duration,
    };
    set((state) => ({ toasts: [...state.toasts.slice(-4), item] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

type ToastInput = { title: string; description?: string; duration?: number | null };

function push(tone: ToastTone, input: string | ToastInput) {
  const value = typeof input === "string" ? { title: input } : input;
  return useToastStore.getState().add({ tone, ...value });
}

/** Imperative toast API usable from mutations, event handlers and stores. */
export const toast = {
  success: (input: string | ToastInput) => push("success", input),
  info: (input: string | ToastInput) => push("info", input),
  warning: (input: string | ToastInput) => push("warning", input),
  error: (input: string | ToastInput) => push("danger", input),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
