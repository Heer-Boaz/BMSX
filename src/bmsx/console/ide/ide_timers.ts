import { $ } from '../../core/game';
import type { TimerHandle } from '../../platform/platform';

export function scheduleIdeOnce(delayMs: number, cb: () => void): TimerHandle {
	const clock = $.platform.clock;
	return clock.scheduleOnce(delayMs, () => cb());
}
