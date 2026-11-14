// Failures the session tells apart, whichever server they come from.

/** A server answered with an HTTP error status. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** None of a server's addresses answered. */
export class Unreachable extends Error {}
