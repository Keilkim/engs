import { useEffect, useRef } from 'react';

export default function useLongPress({ onLongPress, onClick, disabled = false }) {
  const press = useRef({ timer: null, start: null, fired: false, cancelled: false });
  const cancel = () => {
    clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  useEffect(() => () => clearTimeout(press.current.timer), []);
  return {
    onPointerDown(event) {
      if (disabled || (event.button !== 0 && event.pointerType !== 'touch')) return;
      cancel();
      if (event.isPrimary === false) {
        press.current.cancelled = true;
        return;
      }
      press.current.start = { x: event.clientX, y: event.clientY };
      press.current.fired = false;
      press.current.cancelled = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      press.current.timer = setTimeout(() => {
        press.current.fired = true;
        onLongPress();
      }, 500);
    },
    onPointerMove(event) {
      const start = press.current.start;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        press.current.cancelled = true;
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel() { press.current.cancelled = true; cancel(); },
    onLostPointerCapture: cancel,
    onContextMenu: event => event.preventDefault(),
    onClick(event) {
      if (press.current.fired || (event.detail !== 0 && press.current.cancelled)) {
        event.preventDefault();
        event.stopPropagation();
        press.current.fired = false;
        press.current.cancelled = false;
      } else if (!disabled) {
        // Keyboard activation provides an alternative to holding a pointer.
        if (event.detail === 0 && !onClick) onLongPress();
        else onClick?.(event);
      }
    },
  };
}
