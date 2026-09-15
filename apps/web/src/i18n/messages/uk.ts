export const ukMessages = {
  common: {
    greeting: 'Вітаємо, {name}',
    save: 'Зберегти',
  },
  language: {
    label: 'Мова інтерфейсу',
    ukrainian: 'Українська',
    english: 'English',
    updating: 'Змінюємо мову…',
    updateSuccess: 'Мову інтерфейсу змінено',
    updateError: 'Не вдалося змінити мову',
    updateErrorHint: 'Спробуйте ще раз.',
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
