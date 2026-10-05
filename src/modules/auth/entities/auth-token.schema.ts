import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const AUTH_TOKEN_TYPES = ['verify_email', 'reset_password'] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

/**
 * Single-use tokens emailed to users. Only the SHA-256 hash is stored, so a
 * database leak does not expose working links. Mongo's TTL index removes
 * expired tokens automatically.
 */
@Schema({ timestamps: true })
export class AuthToken {
  @Prop({ type: String, enum: AUTH_TOKEN_TYPES, required: true })
  type: AuthTokenType;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export type AuthTokenDocument = HydratedDocument<AuthToken>;
export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);
