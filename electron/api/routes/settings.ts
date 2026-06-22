import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import { join } from 'node:path';
import { applyProxySettings } from '../../main/proxy';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { syncWatchedDirs } from './memory-watcher';

function isProxyKey(key: keyof AppSettings): boolean {
  return (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  );
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => isProxyKey(key as keyof AppSettings));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function patchTouchesGatewayPort(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'gatewayPort');
}

export function patchTouchesMinimizeToTray(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'minimizeToTray');
}

export function patchTouchesNotifications(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'notificationsEnabled');
}

function patchTouchesWatchedMemoryDirs(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'watchedMemoryDirs');
}

async function applySettingsSideEffects(
  ctx: HostApiContext,
  entries: Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>,
): Promise<void> {
  const touchesProxy = entries.some(([key]) => isProxyKey(key));
  const gatewayPortEntry = entries.find(([key]) => key === 'gatewayPort');
  const gatewayPort = gatewayPortEntry?.[1];

  if (typeof gatewayPort === 'number') {
    ctx.gatewayManager.setConfiguredPort(gatewayPort);
  }

  if (touchesProxy) {
    await applyProxySettings(await getAllSettings());
  }
  if (entries.some(([key]) => key === 'launchAtStartup')) {
    await syncLaunchAtStartupSettingFromStore();
  }

  const state = ctx.gatewayManager.getStatus().state;
  if (typeof gatewayPort === 'number') {
    if (state === 'running') {
      await ctx.gatewayManager.stop();
      await ctx.gatewayManager.start();
    } else if (state === 'stopped' || state === 'error') {
      await ctx.gatewayManager.start();
    } else {
      await ctx.gatewayManager.restart();
    }
  } else if (touchesProxy && state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesProxy(patch) || patchTouchesLaunchAtStartup(patch) || patchTouchesGatewayPort(patch)) {
        await applySettingsSideEffects(ctx, entries);
      }
      if (patchTouchesMinimizeToTray(patch)) {
        ctx.eventBus.emit('settings:minimizeToTray-changed', { minimizeToTray: patch.minimizeToTray });
      }
      if (patchTouchesNotifications(patch)) {
        ctx.eventBus.emit('settings:notifications-changed', { notificationsEnabled: patch.notificationsEnabled });
      }
      if (patchTouchesWatchedMemoryDirs(patch) && Array.isArray(patch.watchedMemoryDirs)) {
        syncWatchedDirs(patch.watchedMemoryDirs);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (isProxyKey(key) || key === 'launchAtStartup' || key === 'gatewayPort') {
        await applySettingsSideEffects(ctx, [[key, body.value]]);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      const settings = await getAllSettings();
      await applySettingsSideEffects(ctx, Object.entries(settings) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>);
      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/audit-log' && req.method === 'GET') {
    try {
      const auditLogPath = join(app.getPath('userData'), 'permissions-audit.jsonl');
      const { readFile } = await import('node:fs/promises');
      let content = '';
      try {
        content = await readFile(auditLogPath, 'utf8');
      } catch {
        // File doesn't exist yet — return empty list
      }
      const lines = content.trim().split('\n').filter(Boolean);
      const last50 = lines.slice(-50);
      const entries = last50.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      sendJson(res, 200, { entries });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
