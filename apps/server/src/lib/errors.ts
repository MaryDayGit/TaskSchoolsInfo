export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Не знайдено') => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'Немає доступу') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
