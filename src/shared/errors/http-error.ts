export type ValidationIssue = {
  path: string;
  message: string;
};

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: readonly ValidationIssue[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}
