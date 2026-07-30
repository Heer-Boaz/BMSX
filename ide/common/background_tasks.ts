import { type HostClock } from '../../hosts/common/clock';

export type BackgroundTask = () => boolean;

const backgroundTasks: BackgroundTask[] = [];
const backgroundTaskBudgetMs = 2.0;

export function enqueueBackgroundTask(task: BackgroundTask): void {
	backgroundTasks.push(task);
}

export function runBackgroundTasks(clock: HostClock): void {
	if (backgroundTasks.length === 0) {
		return;
	}
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
}

export function clearBackgroundTasks(): void {
	backgroundTasks.length = 0;
}
