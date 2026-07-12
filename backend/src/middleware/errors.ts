import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Wrap async route handlers so rejections reach the error handler. */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/** Body validation with sanitized output. */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed" });
    return;
  }
  const status =
    typeof err === "object" && err && "statusCode" in err
      ? Number((err as { statusCode: number }).statusCode)
      : 500;
  const message =
    err instanceof Error && status < 500 ? err.message : "Internal server error";
  if (status >= 500) logger.error({ err }, "unhandled error");
  res.status(Number.isFinite(status) && status >= 400 && status < 600 ? status : 500).json({
    error: message,
  });
}
