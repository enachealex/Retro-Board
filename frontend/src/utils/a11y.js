import { useEffect, useRef } from 'react';

/** Trap focus inside an open modal/dialog element. */
export function useFocusTrap(active, containerRef) {
  useEffect(() => {
    if (!active || !containerRef?.current) return undefined;
    const root = containerRef.current;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => [...root.querySelectorAll(selector)].filter((el) => !el.disabled && el.offsetParent !== null);

    const previous = document.activeElement;
    const focusables = getFocusable();
    if (focusables[0]) focusables[0].focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') return;
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [active, containerRef]);
}

export function useEscapeClose(active, onClose) {
  useEffect(() => {
    if (!active || !onClose) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onClose]);
}

export function modalDialogProps(titleId) {
  return {
    role: 'dialog',
    'aria-modal': 'true',
    ...(titleId ? { 'aria-labelledby': titleId } : {}),
  };
}
