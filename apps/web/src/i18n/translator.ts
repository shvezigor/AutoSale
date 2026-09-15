import type { AppLocale } from './locales';
import { enMessages } from './messages/en';
import { ukMessages, type Messages } from './messages/uk';

type NestedKey<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : T[Key] extends Record<string, unknown>
      ? `${Key}.${NestedKey<T[Key]>}`
      : never;
}[keyof T & string];

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends string ? string : DeepPartial<T[Key]>;
};

export type MessageKey = NestedKey<Messages>;
export type MessageValues = Record<string, string | number>;
export type Translator = (key: MessageKey, values?: MessageValues) => string;

const dictionaries: Record<AppLocale, Messages> = { uk: ukMessages, en: enMessages };

function readMessage(dictionary: DeepPartial<Messages>, key: MessageKey): string | undefined {
  let current: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function interpolate(template: string, values: MessageValues = {}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}

export function createTranslator(locale: AppLocale, overrides?: DeepPartial<Messages>): Translator {
  return (key, values) => {
    const message = readMessage(overrides ?? dictionaries[locale], key)
      ?? readMessage(ukMessages, key)
      ?? '';
    return interpolate(message, values);
  };
}

export function messageLeafPaths(dictionary: DeepPartial<Messages>): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, prefix: string) => {
    if (typeof value === 'string') {
      paths.push(prefix);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value).sort()) {
      visit((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key);
    }
  };
  visit(dictionary, '');
  return paths.sort();
}
