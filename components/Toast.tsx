'use client';
import { useCallback, useRef, useState } from 'react';
import Portal from '@/components/Portal';

interface ToastItem {
  id: number;
  msg: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((msg: string) => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  }, []);

  const ToastHost = useCallback(
    () => (
      <Portal>
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </Portal>
    ),
    [toasts]
  );

  return { showToast, ToastHost };
}
