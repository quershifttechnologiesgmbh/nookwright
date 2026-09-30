import { describe, expect, it } from 'vitest';
import { buildAuthConfig, parsePublishableKey } from '../js/auth-config.js';
const key = (mode, domain) => 'pk_' + mode + '_' + btoa(domain + '$');
describe('Clerk browser configuration boundary', () => {
  it('exports only the publishable key and its validated domain', () => {
    const config = buildAuthConfig({ CLERK_PUBLISHABLE_KEY: key('live', 'clerk.example.com'), CLERK_SECRET_KEY: 'server-only-value', STRIPE_SECRET_KEY: 'server-only-payment-value' });
    expect(config).toEqual({ enabled: true, publishableKey: key('live', 'clerk.example.com'), domain: 'clerk.example.com', mode: 'production' });
    expect(JSON.stringify(config)).not.toContain('server-only');
  });
  it('allows an entirely local free editor when accounts are not configured', () => expect(buildAuthConfig({})).toEqual({ enabled: false }));
  it('fails a production launch without a live key', () => {
    expect(() => buildAuthConfig({ CLERK_REQUIRE_PRODUCTION: '1' })).toThrow();
    expect(() => buildAuthConfig({ VERCEL_ENV: 'production' })).toThrow();
    expect(() => buildAuthConfig({ CLERK_REQUIRE_PRODUCTION: '1', CLERK_PUBLISHABLE_KEY: key('test', 'sample.clerk.accounts.dev') })).toThrow();
  });
  it.each(['evil.com/path', 'evil.com:443', 'evil.com@safe.com', 'localhost', 'evil.com?key=secret', '-invalid.example.com', 'clerk.example.com\\another', 'evil.com#fragment'])('rejects domains that could change script origin: %s', domain => {
    expect(() => parsePublishableKey(key('live', domain))).toThrow();
  });
  it('requires a Clerk development domain for test keys and rejects secret keys', () => {
    expect(() => parsePublishableKey(key('test', 'clerk.example.com'))).toThrow();
    expect(() => parsePublishableKey('server-secret')).toThrow();
    expect(() => parsePublishableKey('pk_live_%%%')).toThrow();
  });
});
