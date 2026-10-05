import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('verifies the original password only', async () => {
    const stored = await hashPassword('s3cret-pass');
    await expect(verifyPassword('s3cret-pass', stored)).resolves.toBe(true);
    await expect(verifyPassword('other', stored)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('rejects malformed stored values', async () => {
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false);
  });
});
