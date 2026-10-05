import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('  Acme Corp, Inc. ')).toBe('acme-corp-inc');
  });

  it('strips accents', () => {
    expect(slugify('Café Déjà')).toBe('cafe-deja');
  });
});
