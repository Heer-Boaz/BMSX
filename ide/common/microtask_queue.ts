export interface MicrotaskQueue {
	queueMicrotask(task: () => void): void;
	flush(): void;
}

export class IdeMicrotaskQueue implements MicrotaskQueue {
	private tasks: Array<() => void> = [];
	private drainTasks: Array<() => void> = [];

	public queueMicrotask(task: () => void): void {
		this.tasks.push(task);
	}

	public flush(): void {
		while (this.tasks.length > 0) {
			const tasks = this.tasks;
			this.tasks = this.drainTasks;
			this.drainTasks = tasks;
			try {
				for (let index = 0; index < this.drainTasks.length; index += 1) {
					this.drainTasks[index]();
				}
			} finally {
				this.drainTasks.length = 0;
			}
		}
	}
}
