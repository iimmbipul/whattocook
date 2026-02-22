export type SupportedLocale = 'en' | 'hi' | 'or';

export const localeLabels: Record<SupportedLocale, string> = {
    en: '🌐 English',
    hi: '🌐 हिन्दी',
    or: '🌐 ଓଡ଼ିଆ',
};

export const supportedLocales: SupportedLocale[] = ['en', 'hi', 'or'];

export const DEFAULT_LOCALE: SupportedLocale = 'en';
