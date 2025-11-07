import { $ } from '../../core/game';
import type { TimerHandle } from '../../platform/platform';

export type BackgroundTask = () => boolean;

const backgroundTasks: BackgroundTask[] = [];
let backgroundTaskHandle: TimerHandle | null = null;
const backgroundTaskBudgetMs = 2.0;

export function enqueueBackgroundTask(task: BackgroundTask): void {
	backgroundTasks.push(task);
	if (backgroundTaskHandle === null) {
		backgroundTaskHandle = $.platform.clock.scheduleOnce!(0, runBackgroundTasks);
	}
}

export function runBackgroundTasks(): void {
	backgroundTaskHandle = null;
	if (backgroundTasks.length === 0) {
		return;
	}
	const clock = $.platform.clock;
	const deadline = clock.now() + backgroundTaskBudgetMs;
	const iterationsLimit = backgroundTasks.length * 2;
	let iterations = 0;
	while (backgroundTasks.length > 0) {
		const task = backgroundTasks.shift()!;
		const keep = task();
		if (keep) {
			backgroundTasks.push(task);
		}
		iterations += 1;
		if (clock.now() >= deadline || iterations >= iterationsLimit) {
			break;
		}
	}
	if (backgroundTasks.length > 0 && backgroundTaskHandle === null) {
		backgroundTaskHandle = $.platform.clock.scheduleOnce!(0, runBackgroundTasks);
	}
}

export function clearBackgroundTasks(): void {
	backgroundTasks.length = 0;
	if (backgroundTaskHandle) {
		backgroundTaskHandle.cancel();
		backgroundTaskHandle = null;
	}
}
