import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle malformed JSON payloads
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      success: false,
      message: 'Malformed JSON request body'
    });
    return;
  }

  // Handle MongoDB duplicate key errors without exposing database internals
  if (err.code === 11000) {
    res.status(409).json({
      success: false,
      message: 'Resource with the specified unique identifier already exists'
    });
    return;
  }

  // Handle Mongoose validation and cast errors safely
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    res.status(400).json({
      success: false,
      message: err.name === 'CastError' ? 'Invalid resource identifier format' : err.message
    });
    return;
  }

  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const message =
    statusCode === 500
      ? 'Internal server error occurred'
      : err.message || 'Request failed';

  if (statusCode >= 500) {
    logger.error(`Server Error: ${err.message}`, {
      statusCode,
      name: err.name
    });
  } else {
    logger.info(`Client response (${statusCode}): ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(typeof err.code === 'string' ? { code: err.code } : {})
  });
}
