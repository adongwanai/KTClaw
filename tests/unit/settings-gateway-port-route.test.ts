import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSendJson,
  mockParseJsonBody,
  mockSetSetting,
} = vi.hoisted(() => ({
  mockSendJson: vi.fn(),
  mockParseJsonBody: vi.fn(),
  mockSetSetting: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => mockSendJson(...args),
  parseJsonBody: (...args: unknown[]) => mockParseJsonBody(...args),
}));

vi.mock('@electron/main/proxy', () => ({
  applyProxySettings: vi.fn(),
}));

vi.mock('@electron/main/launch-at-startup', () => ({
  syncLaunchAtStartupSettingFromStore: vi.fn(),
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn(),
  getSetting: vi.fn(),
  resetSettings: vi.fn(),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

describe('settings route gateway port wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates the configured gateway port and restarts the gateway when it is running', async () => {
    mockParseJsonBody.mockResolvedValue({ value: 24567 });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const ctx = {
      gatewayManager: {
        getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
        setConfiguredPort: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
    } as never;

    const handled = await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/settings/gatewayPort'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith('gatewayPort', 24567);
    expect(ctx.gatewayManager.setConfiguredPort).toHaveBeenCalledWith(24567);
    expect(ctx.gatewayManager.stop).toHaveBeenCalledTimes(1);
    expect(ctx.gatewayManager.start).toHaveBeenCalledTimes(1);
    expect(ctx.gatewayManager.restart).not.toHaveBeenCalled();
    expect(mockSendJson).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('updates the configured gateway port and starts the gateway when it is stopped', async () => {
    mockParseJsonBody.mockResolvedValue({ value: 24567 });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const ctx = {
      gatewayManager: {
        getStatus: vi.fn(() => ({ state: 'stopped', port: 18789 })),
        setConfiguredPort: vi.fn(),
        start: vi.fn(),
        restart: vi.fn(),
      },
    } as never;

    const handled = await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/settings/gatewayPort'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith('gatewayPort', 24567);
    expect(ctx.gatewayManager.setConfiguredPort).toHaveBeenCalledWith(24567);
    expect(ctx.gatewayManager.start).toHaveBeenCalledTimes(1);
    expect(ctx.gatewayManager.restart).not.toHaveBeenCalled();
  });
});
