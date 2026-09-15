import type { Messages } from './uk';

export const enMessages = {
  common: {
    greeting: 'Hello, {name}',
    save: 'Save',
  },
  language: {
    label: 'Interface language',
    ukrainian: 'Українська',
    english: 'English',
    updating: 'Changing language…',
    updateSuccess: 'Interface language changed',
    updateError: 'Could not change language',
    updateErrorHint: 'Please try again.',
  },
  navigation: {
    conversations: 'Conversations',
    orders: 'Orders',
    catalogue: 'Catalogue',
    team: 'Team',
    settings: 'Settings',
    profile: 'My profile',
  },
} satisfies Messages;
