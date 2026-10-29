export function useTranslation() {
  return {
    t: (value, fallback) => (typeof value === 'string' ? value : fallback ?? ''),
  };
}

export function I18nextProvider({ children }) {
  return children;
}
