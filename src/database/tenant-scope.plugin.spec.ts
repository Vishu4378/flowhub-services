import mongoose, { Schema } from 'mongoose';
import { TenantScopeError, tenantScopePlugin } from './tenant-scope.plugin.js';

describe('tenantScopePlugin', () => {
  // A standalone instance with no connection: queries fail in middleware
  // before ever needing a server, which is exactly what we want to test.
  const m = new mongoose.Mongoose();
  m.set('bufferCommands', false);
  const schema = new Schema({
    organizationId: Schema.Types.ObjectId,
    name: String,
  });
  schema.plugin(tenantScopePlugin);
  const Thing = m.model('Thing', schema);

  it('rejects queries without organizationId', async () => {
    await expect(Thing.find({ name: 'x' }).exec()).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    await expect(
      Thing.updateMany({}, { name: 'y' }).exec(),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      Thing.deleteOne({ _id: new m.Types.ObjectId() }).exec(),
    ).rejects.toThrow(/organizationId/);
  });

  it('rejects aggregations that do not start by matching organizationId', async () => {
    await expect(
      Thing.aggregate([{ $match: { name: 'x' } }]).exec(),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('lets scoped and explicitly unscoped queries through to the driver', async () => {
    const orgId = new m.Types.ObjectId();
    // Without a connection these fail later, with a non-tenant error.
    await expect(
      Thing.find({ organizationId: orgId }).exec(),
    ).rejects.not.toBeInstanceOf(TenantScopeError);
    await expect(
      Thing.find({}, null, { skipTenantScope: true }).exec(),
    ).rejects.not.toBeInstanceOf(TenantScopeError);
  });

  it('requires the schema to have an organizationId path', () => {
    expect(() =>
      new Schema({ name: String }).plugin(tenantScopePlugin),
    ).toThrow(/organizationId/);
  });
});
