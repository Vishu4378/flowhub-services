import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DomainEvent,
  type MemberEvent,
  type MemberInvitedEvent,
} from '../../common/events/domain-events.js';
import type { OrgContext } from '../../common/types/auth.js';
import { appUrl } from '../../common/utils/app-url.js';
import { createToken, hashToken } from '../../common/utils/tokens.js';
import { MailService } from '../../mail/mail.service.js';
import { BillingService } from '../billing/billing.service.js';
import { UsersService } from '../users/users.service.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import {
  Invitation,
  InvitationDocument,
} from './entities/invitation.schema.js';
import { Membership } from './entities/membership.schema.js';
import { Organization } from './entities/organization.schema.js';
import { assertCanAssign } from './roles.js';

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name)
    private readonly invitations: Model<Invitation>,
    @InjectModel(Membership.name)
    private readonly memberships: Model<Membership>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    private readonly usersService: UsersService,
    private readonly billingService: BillingService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  list(orgId: string) {
    return this.invitations
      .find({ organizationId: new Types.ObjectId(orgId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Emails an invite link. Re-inviting the same email sends a fresh link. */
  async create(
    orgId: string,
    dto: CreateInvitationDto,
    ctx: OrgContext & { userId: string },
  ) {
    assertCanAssign(ctx.role, dto.role);
    const email = dto.email.toLowerCase().trim();
    const organizationId = new Types.ObjectId(orgId);

    const existingUser = await this.usersService.findByEmail(email);
    if (
      existingUser &&
      (await this.memberships.exists({
        organizationId,
        userId: existingUser._id,
      }))
    ) {
      throw new ConflictException(`${email} is already a member`);
    }
    const existingInvite = await this.invitations
      .findOne({ organizationId, email })
      .exec();
    if (!existingInvite) {
      await this.billingService.assertWithinLimit(orgId, 'members');
    }

    const { token, hash } = createToken();
    const invitation = await this.invitations
      .findOneAndUpdate(
        { organizationId, email },
        {
          role: dto.role,
          tokenHash: hash,
          invitedBy: new Types.ObjectId(ctx.userId),
          expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();

    const [org, inviter] = await Promise.all([
      this.organizations.findById(orgId).exec(),
      this.usersService.findById(ctx.userId),
    ]);
    const inviteUrl = appUrl(this.config, `/invite/${token}`);
    await this.mail.send(email, 'invitation', {
      url: inviteUrl,
      organizationName: org?.name,
      inviterName: inviter.name,
      role: dto.role,
    });
    this.events.emit(DomainEvent.MemberInvited, {
      organizationId: orgId,
      actorId: ctx.userId,
      email,
      role: dto.role,
      organizationName: org?.name ?? '',
      inviteUrl,
    } satisfies MemberInvitedEvent);
    return invitation;
  }

  async revoke(orgId: string, invitationId: string): Promise<void> {
    const { deletedCount } = await this.invitations
      .deleteOne({
        _id: invitationId,
        organizationId: new Types.ObjectId(orgId),
      })
      .exec();
    if (!deletedCount) throw new NotFoundException('Invitation not found');
  }

  /** Public preview for the invite landing page. */
  async preview(token: string) {
    const invitation = await this.findByToken(token);
    const [org, inviter] = await Promise.all([
      this.organizations.findById(invitation.organizationId).exec(),
      this.usersService
        .findById(invitation.invitedBy.toString())
        .catch(() => null),
    ]);
    return {
      organizationName: org?.name ?? 'an organization',
      email: invitation.email,
      role: invitation.role,
      inviterName: inviter?.name ?? null,
      expiresAt: invitation.expiresAt,
      accountExists: !!(await this.usersService.findByEmail(invitation.email)),
    };
  }

  /** Joins the invited organization. The signed-in email must match. */
  async accept(token: string, userId: string) {
    const invitation = await this.findByToken(token);
    const user = await this.usersService.findById(userId);
    if (user.email !== invitation.email) {
      throw new ForbiddenException(
        `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`,
      );
    }

    const organizationId = invitation.organizationId;
    const alreadyMember = await this.memberships.exists({
      organizationId,
      userId: user._id,
    });
    if (!alreadyMember) {
      await this.memberships.create({
        organizationId,
        userId: user._id,
        role: invitation.role,
      });
    }
    await this.invitations
      .deleteOne({ _id: invitation._id, organizationId })
      .exec();
    // Clicking an emailed link proves the address.
    await this.usersService.markEmailVerified(userId);

    if (!alreadyMember) {
      this.events.emit(DomainEvent.MemberJoined, {
        organizationId: organizationId.toString(),
        actorId: userId,
        userId,
        role: invitation.role,
      } satisfies MemberEvent);
    }
    return { organizationId: organizationId.toString() };
  }

  private async findByToken(token: string): Promise<InvitationDocument> {
    // Looked up by token across all orgs, so tenant scope is skipped on purpose.
    const invitation = await this.invitations
      .findOne(
        { tokenHash: hashToken(token), expiresAt: { $gt: new Date() } },
        null,
        { skipTenantScope: true },
      )
      .exec();
    if (!invitation) {
      throw new NotFoundException('This invitation is invalid or has expired');
    }
    return invitation;
  }
}
