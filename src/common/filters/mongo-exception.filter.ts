import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { mongo } from 'mongoose';

const DUPLICATE_KEY = 11000;

/** Maps unique-index violations to 409 instead of a generic 500. */
@Catch(mongo.MongoServerError)
export class MongoExceptionFilter extends BaseExceptionFilter {
  catch(exception: mongo.MongoServerError, host: ArgumentsHost) {
    if (exception.code === DUPLICATE_KEY) {
      const field = Object.keys(exception.keyPattern ?? {})[0] ?? 'value';
      return super.catch(
        new ConflictException(`A record with this ${field} already exists`),
        host,
      );
    }
    return super.catch(exception, host);
  }
}
