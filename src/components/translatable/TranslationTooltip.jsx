import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';

export default function TranslationTooltip() {
  const { activeTooltip, hideTooltip } = useTranslation();
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (activeTooltip) {
      const { rect } = activeTooltip;
      const tooltipWidth = 200;
      const tooltipHeight = 60;
      const padding = 8;

      let top = rect.bottom + padding;
      let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);

      if (left < padding) {
        left = padding;
      }
      if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding;
      }

      if (top + tooltipHeight > window.innerHeight - padding) {
        top = rect.top - tooltipHeight - padding;
      }

      setPosition({ top, left });
      setVisible(true);

      const timer = setTimeout(() => {
        hideTooltip();
      }, 3000);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [activeTooltip, hideTooltip]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        hideTooltip();
      }
    }

    if (activeTooltip) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [activeTooltip, hideTooltip]);

  if (!activeTooltip || !visible) {
    return null;
  }

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 'var(--z-tooltip, 500)',
        backgroundColor: 'var(--color-signature, #1B365D)',
        color: 'var(--color-text-inverse, #FFFFFF)',
        padding: '12px 16px',
        borderRadius: 'var(--radius-lg, 8px)',
        boxShadow: 'var(--shadow-lg)',
        minWidth: '120px',
        maxWidth: '200px',
        textAlign: 'center',
        animation: 'tooltipFadeIn 0.2s ease',
        fontFamily: 'var(--font-family-sans)'
      }}
    >
      <div
        style={{
          fontSize: 'var(--font-base, 16px)',
          fontWeight: 'var(--font-weight-medium, 500)',
          lineHeight: 'var(--line-height-normal, 1.5)'
        }}
      >
        {activeTooltip.korean}
      </div>

      <div
        style={{
          position: 'absolute',
          top: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderBottom: '6px solid var(--color-signature, #1B365D)'
        }}
      />

      <style>
        {`
          @keyframes tooltipFadeIn {
            from {
              opacity: 0;
              transform: translateY(4px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
}
