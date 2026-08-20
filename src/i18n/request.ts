import { getRequestConfig } from 'next-intl/server';

type Messages = Record<string, unknown>;

function mergeMessages(base: Messages, translated: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(translated)) {
    const current = merged[key];
    merged[key] = value && typeof value === 'object' && !Array.isArray(value)
      && current && typeof current === 'object' && !Array.isArray(current)
      ? mergeMessages(current as Messages, value as Messages)
      : value;
  }
  return merged;
}

export default getRequestConfig(async () => {
  // Spanish is the product default. Partial catalogues inherit English so
  // newly-added upstream/admin keys never render as raw key paths.
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'es';
  const english = (await import('../../messages/en.json')).default as Messages;

  let messages: Messages = english;
  try {
    if (locale !== 'en') {
      const translated = (await import(`../../messages/${locale}.json`)).default as Messages;
      messages = mergeMessages(english, translated);
    }
  } catch {
    // Unknown/missing locales safely use the complete English source catalogue.
  }

  return {
    locale,
    messages
  };
});
