import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Express 4 n'attrape pas les rejets de promesses : on enveloppe les
// handlers asynchrones pour router les erreurs vers le middleware global.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
