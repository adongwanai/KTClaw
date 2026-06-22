// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGatewayStartupSequence } from '@electron/gateway/startup-orchestrator';

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type HookOverrides = Partial<Parameters<typeof runGatewayStartupSequence>[0]>;

function createHooks(overrides: HookOverrides = {}) {
  const startupStderrLines: string[] = [];

  return {
    port: 18789,
    ownedPid: 1234,
    shouldWaitForPortFree: true,
    maxStartAttempts: 3,
    resetStartupStderrLines: vi.fn(() => {
      startupStderrLines.length = 0;
    }),
    getStartupStderrLines: vi.fn(() => startupStderrLines),
    assertLifecycle: vi.fn(),
    findExistingGateway: vi.fn(async () => null),
    connect: vi.fn(async () => {}),
    onConnectedToExistingGateway: vi.fn(),
    waitForPortFree: vi.fn(async () => {}),
    startProcess: vi.fn(async () => {}),
    waitForReady: vi.fn(async () => {}),
    onConnectedToManagedGateway: vi.fn(),
    runDoctorRepair: vi.fn(async () => false),
    onDoctorRepairSuccess: vi.fn(),
    delay: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('gateway startup hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects to an existing gateway before attempting to spawn a managed process', async () => {
    const hooks = createHooks({
      shouldWaitForPortFree: false,
      findExistingGateway: vi.fn(async () => ({ port: 22334, externalToken: 'external-token' })),
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.findExistingGateway).toHaveBeenCalledWith(18789, 1234);
    expect(hooks.connect).toHaveBeenCalledWith(22334, 'external-token');
    expect(hooks.onConnectedToExistingGateway).toHaveBeenCalledTimes(1);
    expect(hooks.waitForPortFree).not.toHaveBeenCalled();
    expect(hooks.startProcess).not.toHaveBeenCalled();
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();
  });

  it('runs doctor repair once and retries startup when invalid config is detected', async () => {
    const waitForReady = vi
      .fn()
      .mockRejectedValueOnce(new Error('invalid config: missing required field'))
      .mockResolvedValueOnce(undefined);
    const runDoctorRepair = vi.fn(async () => true);

    const hooks = createHooks({
      waitForReady,
      runDoctorRepair,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.startProcess).toHaveBeenCalledTimes(2);
    expect(waitForReady).toHaveBeenCalledTimes(2);
    expect(runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.onDoctorRepairSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.delay).not.toHaveBeenCalled();
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('retries transient gateway start failures before succeeding', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    const hooks = createHooks({
      connect,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.startProcess).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(hooks.delay).toHaveBeenCalledWith(1000);
    expect(hooks.runDoctorRepair).not.toHaveBeenCalled();
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });
});
