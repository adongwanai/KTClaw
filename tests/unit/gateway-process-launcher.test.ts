import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, forkMock, writeFileSyncMock, existsSyncMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/KTClaw'),
  },
  forkMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: appMock,
  utilityProcess: {
    fork: (...args: unknown[]) => forkMock(...args),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
  };
});

describe('launchGatewayProcess', () => {
  function createMockChild() {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = (event: string, handler: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(handler);
      listeners.set(event, current);
    };
    const emit = (event: string, ...args: unknown[]) => {
      for (const handler of listeners.get(event) ?? []) {
        handler(...args);
      }
    };
    const child = {
      pid: 12345,
      stderr: { on },
      stdout: { on },
      on,
    };
    setImmediate(() => emit('spawn'));
    return child;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    appMock.isPackaged = false;
    existsSyncMock.mockReturnValue(true);
    forkMock.mockImplementation(() => createMockChild());
  });

  it('marks OpenClaw node options as ready to avoid entry respawn inside Electron utility process', async () => {
    const { launchGatewayProcess } = await import('@electron/gateway/process-launcher');

    await launchGatewayProcess({
      port: 24567,
      launchContext: {
        openclawDir: 'C:/repo/node_modules/openclaw',
        entryScript: 'C:/repo/node_modules/openclaw/openclaw.mjs',
        gatewayArgs: ['gateway', '--port', '24567', '--token', 'token', '--allow-unconfigured'],
        forkEnv: {},
        mode: 'dev',
        binPathExists: true,
        loadedProviderKeyCount: 0,
        proxySummary: 'disabled',
        channelStartupSummary: 'enabled(feishu)',
        appSettings: {} as never,
      },
      sanitizeSpawnArgs: (args) => args,
      getCurrentState: () => 'starting',
      getShouldReconnect: () => true,
      onStderrLine: () => {},
      onSpawn: () => {},
      onExit: () => {},
      onError: () => {},
    });

    const options = forkMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.OPENCLAW_NODE_OPTIONS_READY).toBe('1');
    expect(options?.env?.OPENCLAW_GATEWAY_PORT).toBe('24567');
    expect(options?.env?.NODE_OPTIONS).toContain('--disable-warning=ExperimentalWarning');
    expect(options?.env?.NODE_OPTIONS).toContain('gateway-fetch-preload.cjs');
  });

  it('strips supervisor marker env vars before forking the embedded gateway', async () => {
    const { launchGatewayProcess } = await import('@electron/gateway/process-launcher');

    await launchGatewayProcess({
      port: 18789,
      launchContext: {
        openclawDir: 'C:/repo/node_modules/openclaw',
        entryScript: 'C:/repo/node_modules/openclaw/openclaw.mjs',
        gatewayArgs: ['gateway', '--port', '18789', '--token', 'token', '--allow-unconfigured'],
        forkEnv: {
          OPENCLAW_WINDOWS_TASK_NAME: 'OpenClaw Gateway',
          OPENCLAW_SERVICE_MARKER: '1',
          OPENCLAW_SERVICE_KIND: 'gateway',
        },
        mode: 'dev',
        binPathExists: true,
        loadedProviderKeyCount: 0,
        proxySummary: 'disabled',
        channelStartupSummary: 'enabled(feishu)',
        appSettings: {} as never,
      },
      sanitizeSpawnArgs: (args) => args,
      getCurrentState: () => 'starting',
      getShouldReconnect: () => true,
      onStderrLine: () => {},
      onSpawn: () => {},
      onExit: () => {},
      onError: () => {},
    });

    const options = forkMock.mock.calls.at(-1)?.[2] as { env?: Record<string, string | undefined> } | undefined;
    expect(options?.env?.OPENCLAW_WINDOWS_TASK_NAME).toBeUndefined();
    expect(options?.env?.OPENCLAW_SERVICE_MARKER).toBeUndefined();
    expect(options?.env?.OPENCLAW_SERVICE_KIND).toBeUndefined();
  });

  it('uses Electron utilityProcess launcher in packaged builds', async () => {
    appMock.isPackaged = true;
    const { launchGatewayProcess } = await import('@electron/gateway/process-launcher');

    await launchGatewayProcess({
      port: 18790,
      launchContext: {
        openclawDir: '/opt/KTClaw/resources/openclaw',
        entryScript: '/opt/KTClaw/resources/openclaw/openclaw.mjs',
        gatewayArgs: ['gateway', '--port', '18790', '--token', 'token', '--allow-unconfigured'],
        forkEnv: {},
        mode: 'packaged',
        binPathExists: true,
        loadedProviderKeyCount: 0,
        proxySummary: 'disabled',
        channelStartupSummary: 'skipped(no configured channels)',
        appSettings: {} as never,
      },
      sanitizeSpawnArgs: (args) => args,
      getCurrentState: () => 'starting',
      getShouldReconnect: () => true,
      onStderrLine: () => {},
      onSpawn: () => {},
      onExit: () => {},
      onError: () => {},
    });

    expect(forkMock).toHaveBeenCalledWith(
      '/opt/KTClaw/resources/openclaw/openclaw.mjs',
      [
        'gateway',
        '--port',
        '18790',
        '--token',
        'token',
        '--allow-unconfigured',
      ],
      expect.objectContaining({
        cwd: '/opt/KTClaw/resources/openclaw',
        serviceName: 'OpenClaw Gateway',
        env: expect.objectContaining({
          OPENCLAW_GATEWAY_PORT: '18790',
          OPENCLAW_NODE_OPTIONS_READY: '1',
        }),
      }),
    );
  });
});
