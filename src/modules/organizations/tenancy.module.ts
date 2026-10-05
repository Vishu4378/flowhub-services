import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Membership, MembershipSchema } from './entities/membership.schema.js';
import {
  Organization,
  OrganizationSchema,
} from './entities/organization.schema.js';
import { OrgMemberGuard } from './org-member.guard.js';

/**
 * The tenancy core: organization and membership models plus OrgMemberGuard.
 * Global so any feature module (projects, billing, analytics…) can guard
 * org-scoped routes without importing OrganizationsModule, which would
 * create import cycles once organizations depends on billing limits.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
    ]),
  ],
  providers: [OrgMemberGuard],
  exports: [MongooseModule, OrgMemberGuard],
})
export class TenancyModule {}
