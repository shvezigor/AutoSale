import type { ValidationFailure, ValidationIssue } from '@autosale/contracts/validation-errors';
import { BadRequestException } from '@nestjs/common';
import type { ZodError } from 'zod';

export type ValidationIssueAllowlist = Readonly<Record<string, string>>;

export function validationBadRequest(
  error: ZodError,
  allowlist: ValidationIssueAllowlist,
): BadRequestException {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const zodIssue of error.issues) {
    const path = zodIssue.path.map(String).join('.');
    const code = allowlist[path];
    const issue = code
      ? { field: path, code }
      : { field: '_form', code: 'INVALID_INPUT' };
    const key = `${issue.field}:${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length === 32) break;
  }

  const response: ValidationFailure = {
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    issues: issues.length > 0 ? issues : [{ field: '_form', code: 'INVALID_INPUT' }],
  };
  return new BadRequestException(response);
}
