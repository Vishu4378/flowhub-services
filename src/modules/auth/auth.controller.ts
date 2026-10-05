import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthUser } from '../../common/types/auth.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';
import { EmailDto } from './dto/email.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { TokenDto } from './dto/token.dto.js';

/** Brute-force protection for credential and email-sending endpoints. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(@Body() dto: TokenDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('verify-email/resend')
  @HttpCode(204)
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.authService.resendVerification(user.userId);
  }

  @Public()
  @Throttle(STRICT)
  @Post('forgot-password')
  @HttpCode(204)
  forgotPassword(@Body() dto: EmailDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('change-password')
  @HttpCode(204)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @ApiBearerAuth()
  @Get('account/export')
  @Header('Content-Disposition', 'attachment; filename="flowhub-account.json"')
  exportData(@CurrentUser() user: AuthUser) {
    return this.authService.exportData(user.userId);
  }

  /** DELETE with a body: the password confirms the user really means it. */
  @ApiBearerAuth()
  @Throttle(STRICT)
  @Delete('account')
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.authService.deleteAccount(user.userId, dto.password);
  }
}
