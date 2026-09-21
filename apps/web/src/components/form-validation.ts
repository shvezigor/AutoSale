import type { Translator } from '../i18n/translator';

export type FieldErrors<TField extends string> = Partial<Record<TField, string>>;

export function clearFieldError<TField extends string>(errors: FieldErrors<TField>, field: TField): FieldErrors<TField> {
  if (!(field in errors)) return errors;

  const next = { ...errors };
  delete next[field];
  return next;
}

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function nativeConstraintMessage(element: NativeControl, t: Translator): string | null {
  const { validity } = element;
  if (validity.valueMissing) return t('validation.required');
  if (validity.typeMismatch) {
    return element instanceof HTMLInputElement && element.type === 'email'
      ? t('validation.email')
      : t('validation.invalid');
  }
  if (!(element instanceof HTMLSelectElement) && element.value.length > 0 && element.minLength >= 0 && element.value.length < element.minLength) {
    return t('validation.tooShort', { count: element.minLength });
  }
  if (!(element instanceof HTMLSelectElement) && element.maxLength >= 0 && element.value.length > element.maxLength) {
    return t('validation.tooLong', { count: element.maxLength });
  }
  if (validity.tooShort && !(element instanceof HTMLSelectElement)) {
    return t('validation.tooShort', { count: element.minLength });
  }
  if (validity.tooLong && !(element instanceof HTMLSelectElement)) {
    return t('validation.tooLong', { count: element.maxLength });
  }
  if (validity.rangeUnderflow && element instanceof HTMLInputElement) return t('validation.minimum', { value: element.min });
  if (validity.rangeOverflow && element instanceof HTMLInputElement) return t('validation.maximum', { value: element.max });
  if (validity.stepMismatch) return t('validation.step');
  if (validity.patternMismatch) return t('validation.pattern');
  if (validity.valid) return null;
  return t('validation.invalid');
}

function isFormControl(element: Element | null): element is NativeControl {
  return element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
}

function findFieldControl(form: HTMLFormElement, field: string): NativeControl | null {
  const escape = globalThis.CSS?.escape;
  if (escape) {
    const escaped = escape(field);
    const queried = form.querySelector(`[data-field="${escaped}"], [name="${escaped}"]`);
    if (isFormControl(queried)) return queried;
  }

  for (const control of Array.from(form.elements)) {
    if (!isFormControl(control)) continue;
    if (control.name === field || control.dataset.field === field) return control;
  }
  return null;
}

export function focusFirstInvalid(form: HTMLFormElement, fields: readonly string[]): void {
  for (const field of fields) {
    const control = findFieldControl(form, field);
    if (!control || control.disabled || control.type === 'hidden') continue;
    control.focus();
    return;
  }
}
