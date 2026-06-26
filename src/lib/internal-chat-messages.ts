export function normalizeInfrastructureText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

export function isHeartbeatPromptText(text: string): boolean {
  const normalized = normalizeInfrastructureText(text);
  return /Read HEARTBEAT\.md if it exists \(workspace context\)/i.test(normalized)
    && /reply HEARTBEAT_OK/i.test(normalized);
}

export function isHeartbeatAckText(text: string): boolean {
  return /^HEARTBEAT_OK[\s.!?。！]*$/i.test(text.trim());
}

export function isGatewaySystemEventText(text: string): boolean {
  return /(?:^|\n)\s*System(?:\s*\([^)]*\))?:\s*\[[^\]]+\]/i.test(text);
}

export function isReminderTriggerText(text: string): boolean {
  return /A scheduled reminder has been triggered/i.test(text)
    || /\[cron:[^\]]+\]/i.test(text)
    || /scheduled reminder|定时提醒|cron.*triggered/i.test(text);
}

export function isInfrastructureChatText(text: string): boolean {
  const normalized = normalizeInfrastructureText(text).toLowerCase();
  if (!normalized) return true;
  return normalized === 'heartbeat'
    || normalized === 'heartbeat_ok'
    || normalized.startsWith('conversation info')
    || isHeartbeatPromptText(text)
    || isHeartbeatAckText(text)
    || isGatewaySystemEventText(text)
    || isReminderTriggerText(text);
}
