/** Thrown when a pipeline does not own the parameter it was asked to update. */
export class UnsupportedParamError extends Error {
  readonly code = 'UNSUPPORTED_PARAM';

  constructor(pipeline: string, param: string) {
    super(`${pipeline} has no param "${param}"`);
    this.name = 'UnsupportedParamError';
  }
}
