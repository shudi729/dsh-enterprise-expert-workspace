/** Stable error codes. UI and diagnostics render these verbatim; never convert a failure into success. */
export const CODES = Object.freeze({
  CONFLICT: 'conflict',
  LOCKED: 'locked',
  NOT_FOUND: 'not_found',
  INVALID_INPUT: 'invalid_input',
  MISSING_INPUT: 'missing_input',
  PERMISSION_DENIED: 'permission_denied',
  UNSUPPORTED_FORMAT: 'unsupported_format',
  VERIFICATION_FAILED: 'verification_failed',
  DEPENDENCY_UNAVAILABLE: 'dependency_unavailable',
  CONNECTOR_UNAVAILABLE: 'connector_unavailable',
  EXTERNAL_SIDE_EFFECT_UNCONFIRMED: 'external_side_effect_unconfirmed',
  DUPLICATE: 'duplicate',
  STORAGE_FAILURE: 'storage_failure',
});

export class WorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = details;
    this.retryable = Boolean(details.retryable);
  }
}

export function fail(code, message, details) {
  throw new WorkspaceError(code, message, details);
}

export function describeError(error) {
  if (error instanceof WorkspaceError) {
    return { code: error.code, message: error.message, details: error.details, retryable: error.retryable };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    details: {},
    retryable: false,
  };
}

export function requireInput(value, label, hint) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    fail(CODES.MISSING_INPUT, `缺少必要输入：${label}`, { field: label, hint: hint ?? '请提供该输入后重试' });
  }
  return value;
}
