import { useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';

export default function TranslatableText({
  textKey,
  children,
  as: Component = 'span',
  className = '',
  style = {}
}) {
  const { t, showTooltip, hideTooltip, activeTooltip } = useTranslation();
  const elementRef = useRef(null);

  const handleClick = useCallback((e) => {
    e.stopPropagation();

    if (activeTooltip?.key === textKey) {
      hideTooltip();
      return;
    }

    if (elementRef.current) {
      const rect = elementRef.current.getBoundingClientRect();
      showTooltip(textKey, rect);
    }
  }, [textKey, showTooltip, hideTooltip, activeTooltip]);

  const displayText = children || t(textKey);
  const isActive = activeTooltip?.key === textKey;

  return (
    <Component
      ref={elementRef}
      onClick={handleClick}
      className={`translatable-text ${isActive ? 'translatable-text--active' : ''} ${className}`}
      style={{
        cursor: 'pointer',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textDecorationColor: 'var(--color-accent)',
        textUnderlineOffset: '3px',
        ...style
      }}
    >
      {displayText}
    </Component>
  );
}
