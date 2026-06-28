export interface MicrotaskQueue {
	queueMicrotask(task: () => void): void;
	flush(): void;
}
