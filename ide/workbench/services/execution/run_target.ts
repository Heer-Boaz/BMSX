import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import type { RuntimeDebuggerExecution } from '../../../runtime/debugger_execution';
import type { SourceExecutionState } from '../../../runtime/debugger_state';
import type { RuntimeTransport } from '../../../runtime/transport';

/** The existing physical owner supplies global run controls and audio monitoring. */
export interface WorkbenchRunTarget {
	readonly transport: RuntimeTransport;
	readonly audio: HostAudioOutput;
	readonly debuggerExecution: RuntimeDebuggerExecution<SourceExecutionState>;
}

/** Explicit execution selection, independent of editor focus and target readiness. */
export class RunTargetSelection {
	private revisionValue = 0;
	private selectedValue: WorkbenchRunTarget | undefined;
	private readonly listeners = new Set<(target: WorkbenchRunTarget | undefined) => void>();

	public constructor(public readonly primary?: WorkbenchRunTarget) { this.selectedValue = primary; }
	public get selected(): WorkbenchRunTarget | undefined { return this.selectedValue; }
	public get revision(): number { return this.revisionValue; }
	public onDidChange(listener: (target: WorkbenchRunTarget | undefined) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Admission may finish later without taking selection from a newer explicit action. */
	public request(): number { return ++this.revisionValue; }
	public complete(request: number, target: WorkbenchRunTarget): boolean {
		if (request !== this.revisionValue) return false;
		this.select(target);
		return true;
	}
	public select(target: WorkbenchRunTarget | undefined): void {
		this.revisionValue++;
		if (target === this.selectedValue) return;
		this.selectedValue = target;
		for (const listener of this.listeners) listener(target);
	}
	public retire(target: WorkbenchRunTarget): void {
		if (target === this.selectedValue) this.select(undefined);
	}
}
