export type LeadErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "DATA_ACCESS_ERROR";

export class LeadDomainError extends Error {
  constructor(
    readonly code: LeadErrorCode,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "LeadDomainError";
  }
}

export function validationError(
  message: string,
  details?: Record<string, string>,
) {
  return new LeadDomainError("VALIDATION_ERROR", message, details);
}
