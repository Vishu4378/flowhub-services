import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/** Super admin dashboard API: every organization, user and event on the platform. */
@Module({
  imports: [OrganizationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
