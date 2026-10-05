import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createToken, hashToken } from '../../common/utils/tokens.js';
import { AuthToken, type AuthTokenType } from './entities/auth-token.schema.js';

const LIFETIME_MS: Record<AuthTokenType, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

@Injectable()
export class AuthTokensService {
  constructor(
    @InjectModel(AuthToken.name) private readonly tokens: Model<AuthToken>,
  ) {}

  /** Issues a new token, invalidating any earlier one of the same type. */
  async issue(userId: string, type: AuthTokenType): Promise<string> {
    const userObjectId = new Types.ObjectId(userId);
    await this.tokens.deleteMany({ userId: userObjectId, type }).exec();
    const { token, hash } = createToken();
    await this.tokens.create({
      type,
      userId: userObjectId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + LIFETIME_MS[type]),
    });
    return token;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.tokens.deleteMany({ userId: new Types.ObjectId(userId) }).exec();
  }

  /** Validates and burns a token, returning the user it belongs to. */
  async consume(token: string, type: AuthTokenType): Promise<string> {
    const record = await this.tokens
      .findOneAndDelete({
        tokenHash: hashToken(token),
        type,
        expiresAt: { $gt: new Date() },
      })
      .exec();
    if (!record) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    return record.userId.toString();
  }
}
