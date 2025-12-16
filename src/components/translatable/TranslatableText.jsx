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

  return (
    <Component className={className} style={style}>
      {displayText}
    </Component>
  );
}
