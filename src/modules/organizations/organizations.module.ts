import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import { Membership, MembershipSchema } from './entities/membership.schema.js';
import {
  Organization,
  OrganizationSchema,
} from './entities/organization.schema.js';
import { OrgMemberGuard } from './org-member.guard.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
    ]),
    UsersModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrgMemberGuard],
  exports: [OrganizationsService, OrgMemberGuard],
})
export class OrganizationsModule {}
