import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

type FieldControlProps = {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
};

export type FieldErrorProps = {
  id: string;
  message: string | null | undefined;
};

export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;

  return <small className="form-field__error" id={id} role="alert">{message}</small>;
}

export type FormFieldProps = {
  id: string;
  label: ReactNode;
  children: ReactElement<FieldControlProps>;
  error?: string | null | undefined;
  hint?: ReactNode | undefined;
  required?: boolean;
  className?: string | undefined;
};

function mergeDescriptionIds(...values: Array<string | undefined | false>): string | undefined {
  const ids = values
    .flatMap((value) => typeof value === 'string' ? value.split(/\s+/) : [])
    .filter(Boolean);

  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined;
}

export function FormField({ id, label, children, error, hint, required, className }: FormFieldProps) {
  if (!isValidElement<FieldControlProps>(children)) {
    throw new TypeError('FormField requires one form control child.');
  }

  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = mergeDescriptionIds(children.props['aria-describedby'], hintId, errorId);
  const controlProps: FieldControlProps = { id };
  const controlRequired = required ?? children.props.required;
  if (controlRequired !== undefined) controlProps.required = controlRequired;
  if (error) controlProps['aria-invalid'] = 'true';
  if (describedBy) controlProps['aria-describedby'] = describedBy;
  const control = cloneElement(children, controlProps);

  return (
    <div className={['form-field', className].filter(Boolean).join(' ')}>
      <label className={`form-field__label${required ? ' form-field__label--required' : ''}`} htmlFor={id}>{label}</label>
      {control}
      {hint ? <small className="form-field__hint" id={hintId}>{hint}</small> : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
