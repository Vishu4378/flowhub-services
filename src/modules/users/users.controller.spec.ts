import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = { findById: vi.fn(), update: vi.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('reads the current user', async () => {
    usersService.findById.mockResolvedValue({ id: 'u1' });
    await expect(
      controller.me({ userId: 'u1', email: 'a@b.c' }),
    ).resolves.toEqual({ id: 'u1' });
    expect(usersService.findById).toHaveBeenCalledWith('u1');
  });
});
