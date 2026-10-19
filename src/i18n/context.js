import { createContext, useContext } from 'react';

const TranslationContext = createContext(null);

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) throw new Error('useTranslation must be used within TranslationProvider');
  return context;
}

export default TranslationContext;
