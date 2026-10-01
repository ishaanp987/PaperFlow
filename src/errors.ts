export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Never expose raw provider responses; they can contain prompts or credentials.
export function safeError(error: unknown): { message: string; status: number; code: string } {
  if (error instanceof AppError) return { message: error.message, status: error.status, code: error.code };
  return { message: "Something went wrong. Your saved work is safe. Try again.", status: 500, code: "internal_error" };
}
