export function isOrderTrigger(
  message: { direction: string; text: string | null },
  phrases: string[],
): boolean {
  if (message.direction !== 'OUTBOUND' || !message.text) return false;

  const normalizedText = normalize(message.text);
  return phrases.some((phrase) => {
    const normalizedPhrase = normalize(phrase);
    return normalizedPhrase.length > 0 && normalizedText.includes(normalizedPhrase);
  });
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ').trim();
}
