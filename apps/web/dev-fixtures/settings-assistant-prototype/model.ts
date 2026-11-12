export type Variant = 'react' | 'a2ui';
export type Scenario = 'review' | 'suggestion';
export type Settings = { approvalMode: 'ALWAYS' | 'NEVER'; intentDetectionMode: 'AI_SUGGESTION'; revision: number };
export type View = { title: string; before: string; after: string; note: string; pending: boolean; disabled: boolean };
export const prompts = {
  review: 'Хочу перевіряти кожне замовлення перед обробкою',
  suggestion: 'Нехай AI лише пропонує замовлення',
};
export function proposal(scenario: Scenario, settings: Settings): Omit<View, 'pending' | 'disabled'> {
  return scenario === 'review'
    ? { title: 'Перевірка кожного замовлення', before: settings.approvalMode === 'ALWAYS' ? 'Підтвердження менеджером' : 'Без підтвердження', after: 'Підтвердження менеджером', note: 'Нові замовлення потребуватимуть перевірки менеджера. Режим розпізнавання залишається без змін.' }
    : { title: 'AI пропонує, менеджер вирішує', before: 'AI пропонує замовлення', after: 'AI пропонує замовлення', note: 'Цей режим уже встановлено. Зберігати нічого не потрібно.' };
}
export function isUnchanged(scenario: Scenario, settings: Settings) { return scenario === 'suggestion' || settings.approvalMode === 'ALWAYS'; }
export const errors: Record<number, string> = {
  403: 'Змінювати ці налаштування може лише власник компанії.',
  409: 'Налаштування змінилися. Оновіть дані та перегляньте пропозицію ще раз.',
  503: 'Сервіс тимчасово недоступний. Спробуйте підтвердити пізніше.',
};
