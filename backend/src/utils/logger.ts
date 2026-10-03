function sanitize(data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitize);

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('hash') ||
      lower.includes('credential') ||
      lower.includes('auth')
    ) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object') {
      clean[key] = sanitize(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta ? sanitize(meta) : '');
  },
  warn: (msg: string, meta?: any) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta ? sanitize(meta) : '');
  },
  error: (msg: string, meta?: any) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta ? sanitize(meta) : '');
  },
  debug: (msg: string, meta?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, meta ? sanitize(meta) : '');
    }
  }
};
