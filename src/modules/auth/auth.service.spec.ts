import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { hashPassword } from '../../common/utils/password.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { UsersService } from '../users/users.service.js';
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
  const jwt = { signAsync: vi.fn().mockResolvedValue('token') };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: OrganizationsService, useValue: organizationsService },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('rejects registration with an existing email', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'u1' });
    await expect(
      service.register({
        name: 'A',
        email: 'a@b.co',
        password: 'password1',
        organizationName: 'Acme',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registers a user with an owned organization', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    const result = await service.register({
      name: 'A',
      email: 'a@b.co',
      password: 'password1',
      organizationName: 'Acme',
    });
    expect(organizationsService.createWithOwner).toHaveBeenCalledWith(
      'u1',
      'Acme',
    );
    expect(usersService.create.mock.calls[0][0].passwordHash).not.toBe(
      'password1',
    );
    expect(result.accessToken).toBe('token');
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
});
