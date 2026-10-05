import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../common/types/auth.js';
import { hashPassword, verifyPassword } from '../../common/utils/password.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { UserDocument } from '../users/entities/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly jwt: JwtService,
  ) {}

  /** Creates the account and its first organization, owned by the new user. */
  async register(dto: RegisterDto) {
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash: await hashPassword(dto.password),
    });
    await this.organizationsService.createWithOwner(
      user.id as string,
      dto.organizationName,
    );
    return this.session(user);
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
    return { user, organizations };
  }

  private async session(user: UserDocument) {
    const payload: JwtPayload = { sub: user.id as string, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload), user };
  }
}
