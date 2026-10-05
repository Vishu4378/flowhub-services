import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import {
  DomainEvent,
  type UserRegisteredEvent,
} from '../../common/events/domain-events.js';
import { superAdminEmails } from '../../common/guards/super-admin.guard.js';
import type { JwtPayload } from '../../common/types/auth.js';
import { appUrl } from '../../common/utils/app-url.js';
import { hashPassword, verifyPassword } from '../../common/utils/password.js';
import { MailService } from '../../mail/mail.service.js';
import { InvitationsService } from '../organizations/invitations.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { UserDocument } from '../users/entities/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly invitationsService: InvitationsService,
    private readonly tokens: AuthTokensService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Creates the account. With an invite token the user joins that
   * organization; otherwise they get a new organization they own.
   */
  async register(dto: RegisterDto) {
    if (!dto.inviteToken && !dto.organizationName) {
      throw new BadRequestException('organizationName is required');
    }
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }
    // Validate the invite before creating anything.
    const invite = dto.inviteToken
      ? await this.invitationsService.preview(dto.inviteToken)
      : null;
    if (invite && invite.email !== dto.email.toLowerCase().trim()) {
      throw new BadRequestException(
        `This invitation was sent to ${invite.email}. Sign up with that email to accept it.`,
      );
    }

    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash: await hashPassword(dto.password),
    });
    const userId = user.id as string;

    if (dto.inviteToken) {
      // Accepting marks the email verified: the user clicked the emailed link.
      await this.invitationsService.accept(dto.inviteToken, userId);
    } else {
      await this.organizationsService.createWithOwner(
        userId,
        dto.organizationName!,
      );
      await this.sendVerification(user);
    }

    this.events.emit(DomainEvent.UserRegistered, {
      userId,
      email: user.email,
      name: user.name,
    } satisfies UserRegisteredEvent);
    return this.session(await this.usersService.findById(userId));
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    return this.session(await this.usersService.findById(user.id as string));
  }

  async me(userId: string) {
    const [user, organizations] = await Promise.all([
      this.usersService.findById(userId),
      this.organizationsService.listForUser(userId),
    ]);
    return {
      user,
      organizations,
      isSuperAdmin: superAdminEmails(this.config).has(user.email),
    };
  }

  /** Everything we hold about the user, as one JSON document. */
  async exportData(userId: string) {
    const [user, organizations] = await Promise.all([
      this.usersService.findById(userId),
      this.organizationsService.listForUser(userId),
    ]);
    const notifications = await this.connection
      .model('Notification')
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
    return {
      exportedAt: new Date().toISOString(),
      user,
      organizations: organizations.map((o) => ({
        id: String(o._id),
        name: o.name,
        slug: o.slug,
        role: o.role,
      })),
      notifications,
    };
  }

  /**
   * Permanently deletes the account after checking the password. Orgs where
   * the user is the only member go with it; blockers are reported all at once.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const withPassword = await this.usersService.findByEmailWithPassword(
      user.email,
    );
    if (
      !withPassword ||
      !(await verifyPassword(password, withPassword.passwordHash))
    ) {
      throw new BadRequestException('Your password is incorrect');
    }
    const plan = await this.organizationsService.accountDeletionPlan(userId);
    if (plan.blockers.length) {
      throw new BadRequestException(plan.blockers.join('. '));
    }
    for (const orgId of plan.deleteOrgs) {
      await this.organizationsService.remove(orgId);
    }
    await this.organizationsService.removeAllMemberships(userId);
    await this.tokens.deleteAllForUser(userId);
    await this.connection
      .model('Notification')
      .deleteMany({ userId: new Types.ObjectId(userId) })
      .exec();
    await this.usersService.remove(userId);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Your email is already verified');
    }
    await this.sendVerification(user);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.tokens.consume(token, 'verify_email');
    await this.usersService.markEmailVerified(userId);
  }

  /**
   * Always succeeds, whether or not the email has an account, so the
   * endpoint cannot be used to discover registered emails.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      this.logger.log(`Password reset requested for unknown email`);
      return;
    }
    const token = await this.tokens.issue(user.id as string, 'reset_password');
    await this.mail.send(user.email, 'resetPassword', {
      name: user.name,
      url: appUrl(this.config, `/reset-password?token=${token}`),
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.tokens.consume(dto.token, 'reset_password');
    await this.usersService.setPassword(
      userId,
      await hashPassword(dto.password),
    );
    // Receiving the reset email proves the address too.
    await this.usersService.markEmailVerified(userId);
    return this.session(await this.usersService.findById(userId));
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findById(userId);
    const withPassword = await this.usersService.findByEmailWithPassword(
      user.email,
    );
    if (
      !withPassword ||
      !(await verifyPassword(dto.currentPassword, withPassword.passwordHash))
    ) {
      throw new BadRequestException('Your current password is incorrect');
    }
    await this.usersService.setPassword(
      userId,
      await hashPassword(dto.newPassword),
    );
  }

  private async sendVerification(user: UserDocument) {
    const token = await this.tokens.issue(user.id as string, 'verify_email');
    await this.mail.send(user.email, 'verifyEmail', {
      name: user.name,
      url: appUrl(this.config, `/verify-email?token=${token}`),
    });
  }

  private async session(user: UserDocument) {
    const payload: JwtPayload = { sub: user.id as string, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload), user };
  }
}
