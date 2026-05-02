import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns ok status with service metadata', () => {
    const ctrl = new HealthController();
    const res = ctrl.check();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('oci-api');
    expect(res.env).toBeDefined();
    expect(typeof res.timestamp).toBe('string');
    expect(() => new Date(res.timestamp).toISOString()).not.toThrow();
  });
});
