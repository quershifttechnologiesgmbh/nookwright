// The publishable key is public. Secret keys never belong in a browser configuration.
export function parsePublishableKey(value) {
  if (typeof value !== 'string' || !/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Invalid Clerk publishable key');
  const mode = value.startsWith('pk_live_') ? 'production' : 'development';
  const encoded = value.slice(8);
  let decoded;
  try { decoded = atob(encoded); } catch { throw new Error('Invalid Clerk publishable key'); }
  if (!decoded.endsWith('$')) throw new Error('Invalid Clerk frontend domain');
  const domain = decoded.slice(0, -1);
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Invalid Clerk frontend domain');
  if (mode === 'development' && !domain.endsWith('.clerk.accounts.dev')) throw new Error('Invalid Clerk development domain');
  return { enabled: true, publishableKey: value, domain, mode };
}

export function buildAuthConfig(env) {
  const value = env.CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY;
  const required = env.CLERK_REQUIRE_PRODUCTION === '1' || env.VERCEL_ENV === 'production';
  if (!value) {
    if (required) throw new Error('A production Clerk publishable key is required');
    return { enabled: false };
  }
  const config = parsePublishableKey(value);
  if (required && config.mode !== 'production') throw new Error('Development Clerk keys cannot be used for the production launch');
  return config;
}
