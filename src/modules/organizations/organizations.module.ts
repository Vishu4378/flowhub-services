import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../billing/billing.module.js';
import { UsersModule } from '../users/users.module.js';
import { Invitation, InvitationSchema } from './entities/invitation.schema.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

/** Organization and member management. Models and the guard come from TenancyModule. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    UsersModule,
    BillingModule,
  ],
  controllers: [OrganizationsController, InvitationsController],
  providers: [OrganizationsService, InvitationsService],
  exports: [OrganizationsService, InvitationsService],
})
export class OrganizationsModule {}
