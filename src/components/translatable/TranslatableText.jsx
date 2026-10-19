import { createElement } from 'react';
import { useTranslation } from '../../i18n';

export default function TranslatableText({
  textKey,
  children,
  as: Component = 'span',
  className = '',
  style = {}
}) {
  const { t } = useTranslation();
  const displayText = children || t(textKey);

  return createElement(Component, { className, style }, displayText);
}
