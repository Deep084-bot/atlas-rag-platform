import { ValidationError } from '../errors.js';

export class UploadValidationError extends ValidationError {
  constructor(message) {
    super(message);
    this.name = 'UploadValidationError';
  }
}
