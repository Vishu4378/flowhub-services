import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { toJsonPlugin } from './to-json.plugin.js';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        connectionFactory: (connection: Connection) => {
          connection.plugin(toJsonPlugin);
          return connection;
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
