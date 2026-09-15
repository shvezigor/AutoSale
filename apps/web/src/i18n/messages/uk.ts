export const ukMessages = {
  common: {
    greeting: 'Вітаємо, {name}',
    save: 'Зберегти',
  },
  navigation: {
    conversations: 'Діалоги',
    orders: 'Замовлення',
    catalogue: 'Каталог',
    team: 'Команда',
    settings: 'Налаштування',
    profile: 'Мій профіль',
  },
} as const;

export type DeepStringShape<T> = {
  [Key in keyof T]: T[Key] extends string ? string : DeepStringShape<T[Key]>;
};

export type Messages = DeepStringShape<typeof ukMessages>;
