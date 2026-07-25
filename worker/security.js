const warned = new Set();

export const isProductionEnv = (env = {}) => (
  env.ENVIRONMENT === 'production'
  || String(env.PUBLIC_BASE_URL || '').startsWith('https://')
);

// Dev secret fallback must be OPTED INTO explicitly. Workers don't set
// ENVIRONMENT/NODE_ENV by default, so inferring "not production" would silently
// ship dev secrets to prod. Fail closed unless ALLOW_DEV_SECRETS=1 is set.
const devSecretsAllowed = (env = {}) => (
  !isProductionEnv(env) && String(env.ALLOW_DEV_SECRETS || '') === '1'
);

export const readRequiredSecret = (env = {}, name, fallback) => {
  const value = String(env[name] || '');
  if (value.length >= 32) return value;
  if (!devSecretsAllowed(env)) {
    const error = new Error(`Server chưa cấu hình ${name} (cần secret >= 32 ký tự, hoặc đặt ALLOW_DEV_SECRETS=1 cho môi trường dev).`);
    error.status = 500;
    throw error;
  }
  if (!warned.has(name)) {
    console.warn(`${name} chưa được cấu hình đủ mạnh; đang dùng secret dev cục bộ.`);
    warned.add(name);
  }
  return value || fallback;
};

export const assertSecurityConfig = (env = {}) => {
  readRequiredSecret(env, 'TOKEN_ENCRYPTION_KEY', 'dev-only-marketing-hub-token-key');
  readRequiredSecret(env, 'SESSION_SECRET', env.TOKEN_ENCRYPTION_KEY || 'local-dev-session-secret');
};
