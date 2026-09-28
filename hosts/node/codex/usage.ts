import type { AssistantUsage } from '../../common/assistant_protocol';

/** Account quota observations from app-server. Rolling updates are sparse. */
type LimitWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type CodexRateLimits = { limitId: string | null; primary: LimitWindow | null; secondary: LimitWindow | null };
export type CodexRateLimitsRead = { rateLimits: CodexRateLimits; rateLimitsByLimitId: Record<string, CodexRateLimits> | null };

export class CodexUsage {
	private primary: LimitWindow | null = null;
	private secondary: LimitWindow | null = null;
	public clear(): void { this.primary = null; this.secondary = null; }
	/** Seed absent windows only: a notification received during the read is newer. */
	public initialize(read: CodexRateLimitsRead): void {
		const limits = read.rateLimitsByLimitId === null ? [read.rateLimits] : Object.values(read.rateLimitsByLimitId);
		for (const snapshot of limits) {
			if (snapshot.limitId !== null && snapshot.limitId !== 'codex') continue;
			this.primary ??= snapshot.primary;
			this.secondary ??= snapshot.secondary;
		}
	}
	public update(limits: CodexRateLimits): boolean {
		if (limits.limitId !== null && limits.limitId !== 'codex') return false;
		if (limits.primary !== null) this.primary = limits.primary;
		if (limits.secondary !== null) this.secondary = limits.secondary;
		return true;
	}
	public snapshot(): AssistantUsage {
		const week = this.primary?.windowDurationMins === 10080 ? this.primary
			: this.secondary?.windowDurationMins === 10080 ? this.secondary : null;
		return { weeklyRemaining: week === null ? null : 100 - week.usedPercent };
	}
}
