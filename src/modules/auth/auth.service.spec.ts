import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { hashPassword } from '../../common/utils/password.js';
import { MailService } from '../../mail/mail.service.js';
import { InvitationsService } from '../organizations/invitations.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByEmail: vi.fn(),
    findByEmailWithPassword: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  };
  const organizationsService = { createWithOwner: vi.fn() };
  const invitationsService = { preview: vi.fn(), accept: vi.fn() };
  const tokens = { issue: vi.fn().mockResolvedValue('tok'), consume: vi.fn() };
  const mail = { send: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: OrganizationsService, useValue: organizationsService },
        { provide: InvitationsService, useValue: invitationsService },
        { provide: AuthTokensService, useValue: tokens },
        { provide: MailService, useValue: mail },
        {
          provide: JwtService,
          useValue: { signAsync: vi.fn().mockResolvedValue('jwt') },
        },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d },
        },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
        { provide: getConnectionToken(), useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  const dto = {
    name: 'A',
    email: 'a@b.co',
    password: 'password1',
    organizationName: 'Acme',
  };

  it('rejects registration with an existing email', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'u1' });
    await expect(service.register(dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('registers with a new owned organization and sends verification', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
    });
    usersService.findById.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    const result = await service.register(dto);
    expect(organizationsService.createWithOwner).toHaveBeenCalledWith(
      'u1',
      'Acme',
    );
    expect(usersService.create.mock.calls[0][0].passwordHash).not.toBe(
      'password1',
    );
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.co',
      'verifyEmail',
      expect.objectContaining({
        url: expect.stringContaining('/verify-email?token=tok'),
      }),
    );
    expect(result.accessToken).toBe('jwt');
  });

  it('joins the invited org instead of creating one', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    invitationsService.preview.mockResolvedValue({ email: 'a@b.co' });
    usersService.create.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    usersService.findById.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    await service.register({
      ...dto,
      organizationName: undefined,
      inviteToken: 'invite',
    });
    expect(invitationsService.accept).toHaveBeenCalledWith('invite', 'u1');
    expect(organizationsService.createWithOwner).not.toHaveBeenCalled();
  });

  it('refuses an invite addressed to another email', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    invitationsService.preview.mockResolvedValue({ email: 'other@b.co' });
    await expect(
      service.register({ ...dto, inviteToken: 'invite' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      id: 'u1',
      passwordHash: await hashPassword('correct-horse'),
    });
    await expect(
      service.login({ email: 'a@b.co', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stays silent for unknown emails on forgot-password', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(service.forgotPassword('x@y.z')).resolves.toBeUndefined();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
