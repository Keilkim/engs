import { useState, useCallback } from 'react';
import uiTranslations from './translations/ui.json';
import onboardingTranslations from './translations/onboarding.json';

import TranslationContext from './context';

const allTranslations = {
  ...uiTranslations,
  onboarding: onboardingTranslations
};

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

export function TranslationProvider({ children }) {
  const [activeTooltip, setActiveTooltip] = useState(null);

  const getTranslation = useCallback((key) => {
    const translation = getNestedValue(allTranslations, key);
    if (translation && translation.en && translation.ko) {
      return translation;
    }
    return null;
  }, []);

  const t = useCallback((key, fallback = '') => {
    const translation = getTranslation(key);
    return translation ? translation.en : fallback;
  }, [getTranslation]);

  const ko = useCallback((key, fallback = '') => {
    const translation = getTranslation(key);
    return translation ? translation.ko : fallback;
  }, [getTranslation]);

  const showTooltip = useCallback((key, rect) => {
    const translation = getTranslation(key);
    if (translation) {
      setActiveTooltip({
        key,
        korean: translation.ko,
        rect
      });
    }
  }, [getTranslation]);

  const hideTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  const value = {
    t,
    ko,
    getTranslation,
    activeTooltip,
    showTooltip,
    hideTooltip
  };

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}
