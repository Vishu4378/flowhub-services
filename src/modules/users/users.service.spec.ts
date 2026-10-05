import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from './entities/user.schema.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const exec = vi.fn();
  const model = {
    findOne: vi.fn(() => ({ exec, select: () => ({ exec }) })),
    findById: vi.fn(() => ({ exec })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: model },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('normalizes email before lookup', async () => {
    exec.mockResolvedValue(null);
    await service.findByEmail('  Jane@Example.COM ');
    expect(model.findOne).toHaveBeenCalledWith({ email: 'jane@example.com' });
  });

  it('throws NotFound for an unknown id', async () => {
    exec.mockResolvedValue(null);
    await expect(service.findById('abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
