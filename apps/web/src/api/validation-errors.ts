import {
  validationFailureSchema,
  type ValidationFailure,
} from '../../../../packages/contracts/src/validation-errors';

export type ClientValidationIssueAllowlist = Readonly<Record<string, readonly string[]>>;

export async function parseValidationFailure(
  response: Response,
  allowlist: ClientValidationIssueAllowlist,
): Promise<ValidationFailure | null> {
  if (response.status !== 400) return null;

  try {
    const parsed = validationFailureSchema.safeParse(await response.clone().json());
    if (!parsed.success) return null;
    if (!parsed.data.issues.every((issue) => allowlist[issue.field]?.includes(issue.code))) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export class ValidationApiError extends Error {
  readonly failure: ValidationFailure;

  constructor(failure: ValidationFailure) {
    super('Validation failed');
    this.name = 'ValidationApiError';
    this.failure = failure;
  }
}
