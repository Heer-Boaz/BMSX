import type { StudioBuildJob } from '../../../../hosts/common/studio_builds';
import type { IDisposable } from '../../../common/lifecycle';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { WorkspaceBuilds } from '../../services/builds';

/** Workspace-owned observations. Closing one reader does not retire a request's captured documents. */
export class BuildOutputs implements IDisposable {
	private readonly outputs = new Map<string, BuildOutput>();
	private disposed = false;

	public constructor(private readonly builds: WorkspaceBuilds) {}

	public get(job: StudioBuildJob): BuildOutput {
		if (this.disposed) throw new Error('Cannot obtain build output from a disposed workspace');
		const id = job.request.requestId;
		let output = this.outputs.get(id);
		if (output === undefined) {
			output = new BuildOutput(this.builds, job);
			this.outputs.set(id, output);
		}
		return output;
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const output of this.outputs.values()) output.dispose();
		this.outputs.clear();
	}
}

/** The receipt, captured stdout/stderr and diagnostic of one admitted request, independent of its readers. */
export class BuildOutput implements IDisposable {
	public readonly requestId: string;
	private jobValue: StudioBuildJob;
	private outputValue: TextBuffer = new PieceTreeBuffer();
	private errorValue: TextBuffer | undefined;
	private outputTextValue: string | undefined;
	private errorText: string | undefined;
	private loadingValue = false;
	private readErrorValue: string | undefined;
	private readonly listeners = new Set<() => void>();
	private request: AbortController | undefined;
	private refreshing: Promise<void> | undefined;
	private disposed = false;

	public constructor(private readonly builds: WorkspaceBuilds, job: StudioBuildJob) {
		this.requestId = job.request.requestId;
		this.jobValue = job;
		this.errorText = job.error;
		if (job.error !== undefined) this.errorValue = new PieceTreeBuffer(job.error);
	}

	public get job(): StudioBuildJob { return this.jobValue; }
	public get output(): TextBuffer { return this.outputValue; }
	public get error(): TextBuffer | undefined { return this.errorValue; }
	public get outputText(): string | undefined { return this.outputTextValue; }
	public get loading(): boolean { return this.loadingValue; }
	public get readError(): string | undefined { return this.readErrorValue; }
	public get isDisposed(): boolean { return this.disposed; }

	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** All readers join the same receipt/output read; none can cancel another reader's refresh. */
	public refresh(): Promise<void> {
		if (this.disposed) throw new Error('Cannot refresh build output from a disposed workspace');
		if (this.refreshing !== undefined) return this.refreshing;
		const request = new AbortController();
		this.request = request;
		this.loadingValue = true;
		this.readErrorValue = undefined;
		const refreshing = this.read(request).finally(() => {
			if (this.disposed) return;
			this.request = undefined;
			this.refreshing = undefined;
			this.loadingValue = false;
			this.changed();
		});
		this.refreshing = refreshing;
		this.changed();
		return refreshing;
	}

	private async read(request: AbortController): Promise<void> {
		try {
			const job = await this.builds.get(this.requestId, request.signal);
			if (request.signal.aborted) return;
			if (job === undefined) { this.readErrorValue = 'This build request is no longer available.'; return; }
			this.jobValue = job;
			if (this.errorText !== job.error) {
				this.errorValue = job.error === undefined ? undefined : new PieceTreeBuffer(job.error);
				this.errorText = job.error;
			}
			this.changed();
			if (request.signal.aborted) return;
			const output = await this.builds.log(this.requestId, request.signal);
			if (request.signal.aborted) return;
			if (this.outputTextValue !== output) {
				this.outputValue = new PieceTreeBuffer(output);
				this.outputTextValue = output;
				this.changed();
			}
		} catch (error) {
			if (!request.signal.aborted) this.readErrorValue = String(error);
		}
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.request?.abort();
		this.loadingValue = false;
		this.readErrorValue = 'This build observation belongs to a closed workspace.';
		this.changed();
		this.listeners.clear();
	}
}
