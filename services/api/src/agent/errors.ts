import {
  ApiErrorSchema,
  type ApiError,
  type ErrorCode,
} from "../contracts.js";

export class ApiErrorException extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error.message);
  }
}

export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  currentRevision: number | null = null,
): ApiErrorException {
  return new ApiErrorException(
    status,
    ApiErrorSchema.parse({
      error: { code, message, currentRevision },
    }),
  );
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiErrorException) {
    return Response.json(error.body, { status: error.status });
  }
  return Response.json(
    ApiErrorSchema.parse({
      error: {
        code: "upstreamError",
        message: "The request could not be completed.",
        currentRevision: null,
      },
    }),
    { status: 500 },
  );
}
