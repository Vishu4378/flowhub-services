import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthToken, AuthTokenSchema } from './entities/auth-token.schema.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: AuthToken.name, schema: AuthTokenSchema },
    ]),
    UsersModule,
    OrganizationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokensService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
