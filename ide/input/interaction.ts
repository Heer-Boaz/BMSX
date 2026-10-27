import type { RuntimeTransport } from '../runtime/transport';

/** One control attachment's physical target and live-follow intent. Null names no admitted target. */
export class InputInteraction {
	private transportValue: RuntimeTransport | null;
	private runningValue: boolean;
	private listeners: Set<() => void> | undefined;

	public constructor(transport: RuntimeTransport | null = null, running = false) {
		this.transportValue = transport; this.runningValue = running;
	}
	public get transport(): RuntimeTransport | null { return this.transportValue; }
	public get running(): boolean { return this.runningValue; }
	public set running(value: boolean) {
		if (value === this.runningValue) return;
		this.runningValue = value;
		this.publish();
	}
	/** Attaching a target does not restore live-input or capture authority. */
	public setRuntime(transport: RuntimeTransport | null, running = false): void {
		if (transport === this.transportValue && running === this.runningValue) return;
		this.transportValue = transport; this.runningValue = running;
		this.publish();
	}
	public onDidChange(listener: () => void): () => void {
		const listeners = this.listeners ??= new Set();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}
	private publish(): void { if (this.listeners !== undefined) for (const listener of this.listeners) listener(); }
}
