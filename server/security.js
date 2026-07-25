const warned = new Set();

const isProductionEnv = () => process.env.NODE_ENV === 'production';

// Dev secret fallback must be OPTED INTO explicitly. A host that forgets to set
// NODE_ENV=production would otherwise get forgeable sessions/weak token keys
// silently. Fail closed unless ALLOW_DEV_SECRETS=1 is set for local dev.
const devSecretsAllowed = () => !isProductionEnv() && String(process.env.ALLOW_DEV_SECRETS || '') === '1';

const readRequiredSecret = (name, fallback) => {
  const value = String(process.env[name] || '');
  if (value.length >= 32) return value;
  if (!devSecretsAllowed()) {
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

const assertSecurityConfig = () => {
  readRequiredSecret('TOKEN_ENCRYPTION_KEY', 'dev-only-marketing-hub-token-key');
  readRequiredSecret('SESSION_SECRET', process.env.TOKEN_ENCRYPTION_KEY || 'local-dev-session-secret');
};

module.exports = {
  assertSecurityConfig,
  isProductionEnv,
  readRequiredSecret
};
