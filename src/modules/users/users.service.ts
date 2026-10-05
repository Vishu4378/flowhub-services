import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './entities/user.schema.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  create(data: Pick<User, 'email' | 'name' | 'passwordHash'>) {
    return this.users.create(data);
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.users.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  /** Includes passwordHash, which is excluded from every other read. */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.users
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec();
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.users.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  findByIds(ids: string[]): Promise<UserDocument[]> {
    return this.users.find({ _id: { $in: ids } }).exec();
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.users
      .updateOne(
        { _id: id, emailVerifiedAt: null },
        { emailVerifiedAt: new Date() },
      )
      .exec();
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.users.updateOne({ _id: id }, { passwordHash }).exec();
  }

  async remove(id: string): Promise<void> {
    await this.users.deleteOne({ _id: id }).exec();
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.users
      .findByIdAndUpdate(id, dto, {
        returnDocument: 'after',
        runValidators: true,
      })
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
