"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface PromptOptions {
  title: string;
  label: string;
  placeholder?: string;
  confirm?: string;
}

interface FeedbackValue {
  toast: (message: string, error?: boolean) => void;
  /** Ask for a short text (reason, payment reference...). Resolves to null if cancelled. */
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; error: boolean }[]>([]);
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [text, setText] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((message: string, error = false) => {
    const id = ++nextId.current;
    setToasts((t) => [...t, { id, message, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500);
  }, []);

  const prompt = useCallback((o: PromptOptions) => {
    setOpts(o);
    setText("");
    requestAnimationFrame(() => dialogRef.current?.showModal());
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: string | null) => {
    dialogRef.current?.close();
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <FeedbackContext.Provider value={{ toast, prompt }}>
      {children}

      <dialog
        ref={dialogRef}
        onCancel={() => close(null)}
        className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
      >
        {opts && (
          <form
            className="flex flex-col gap-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) close(text.trim());
            }}
          >
            <h3 className="text-base font-semibold">{opts.title}</h3>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
              {opts.label}
              <input autoFocus className="input" value={text} placeholder={opts.placeholder} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => close(null)} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium">
                Cancel
              </button>
              <button type="submit" disabled={!text.trim()} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
                {opts.confirm ?? "Confirm"}
              </button>
            </div>
          </form>
        )}
      </dialog>

      <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-32px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-md rounded-lg px-4 py-2.5 text-sm whitespace-pre-line shadow-lg ${t.error ? "bg-critical text-white" : "bg-ink text-bg"}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside FeedbackProvider");
  return ctx;
}
