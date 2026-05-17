import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../src/services/auth');

describe('auth service', () => {
  it('hashes and verifies password', () => {
    const password = 'MiClaveSecreta123!';
    const hash = hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(20);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same password', () => {
    const hash1 = hashPassword('test123');
    const hash2 = hashPassword('test123');
    expect(hash1).not.toBe(hash2);
  });

  it('signs and verifies JWT tokens', () => {
    const user = { id: 1, email: 'test@test.com', username: 'test' };
    const token = signToken(user);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.id).toBe(1);
    expect(decoded.email).toBe('test@test.com');
    expect(decoded.username).toBe('test');
  });

  it('rejects invalid token', () => {
    const decoded = verifyToken('invalid.token.here');
    expect(decoded).toBeNull();
  });
});
