import { describe, expect, it } from 'vitest';
import { base64, contentHashes, utf8 } from '../hashes';

// Values measured with OpenTofu 1.12.4 + hashicorp/local 2.9.1 (local_file content_* attributes).
describe('hashes', () => {
  it('matches hashicorp/local for "Nasi lemak\\n"', () => {
    const h = contentHashes('Nasi lemak\n');
    expect(h.id).toBe('87947d76cb25a1dcf98f1f4ff3fbb6dcf07ed8f7');
    expect(h.content_md5).toBe('ca0bb142aca1de4d9309ba7365450518');
    expect(h.content_sha256).toBe('11f4085b334b65cbf9b0e81945ac42e5bdef2514dfe382f387e88cbede50cdf1');
    expect(h.content_base64sha256).toBe('EfQIWzNLZcv5sOgZRaxC5b3vJRTf44Lzh+iMvt5QzfE=');
    expect(h.content_sha512).toBe('6c999a83d096cbea68ac8dd6a2f2d8f180b3fd96fbf4a3bbc09fe5ef6bbfe4373d70e03d122bda547f6c43652e57495d67282c39f0624c0b8d349bb532833f27');
    expect(h.content_base64sha512).toBe('bJmag9CWy+porI3WovLY8YCz/Zb79KO7wJ/l72u/5Dc9cOA9EivaVH9sQ2UuV0ldZygsOfBiTAuNNJu1MoM/Jw==');
  });

  it('matches for a one-byte file ("x")', () => {
    const h = contentHashes('x');
    expect(h.id).toBe('11f6ad8ec52a2984abaafd7c3b516503785c2072');
    expect(h.content_md5).toBe('9dd4e461268c8034f5c8564e155c67a6');
    expect(h.content_base64sha512).toBe('pKvURIxJVi2CgRXROh/M6pJ/UrTVRZKX+LQ+QtqJI4vBNibkPcs43bCCSIkn7JBPtCBXRDmD6IWFF51QVRr+Yg==');
  });

  it('base64 with and without padding, standard and URL alphabets', () => {
    expect(base64(utf8('x'))).toBe('eA==');
    expect(base64(new Uint8Array([0xcd, 0x8a, 0x36, 0xdd]))).toBe('zYo23Q==');
    expect(base64(new Uint8Array([0xcd, 0x8a, 0x36, 0xdd]), true, false)).toBe('zYo23Q');
    expect(base64(new Uint8Array([0xfb, 0xff]), true, false)).toBe('-_8');
  });
});
