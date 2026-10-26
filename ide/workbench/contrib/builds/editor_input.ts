import type { StudioBuildJob } from '../../../../hosts/common/studio_builds';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { WorkspaceBuilds } from '../../services/builds';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchTextViewModel } from '../../ui/text_view/model';

export type BuildLogChannel = 'output' | 'error';

/** A request-owned snapshot, never a cartridge resource or editable working copy. */
export class BuildLogInput extends ReadonlyEditorInput<`build-log:${string}`, 'build_log'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly output = new WorkbenchTextViewModel(new PieceTreeBuffer());
	public error: WorkbenchTextViewModel | undefined;
	public channel: BuildLogChannel;
	public readonly actions = createWorkbenchActionBar('buildLog.title', true);
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public loading = false;
	public readError: string | undefined;
	public revision = 0;
	public outputText: string | undefined;
	private errorText: string | undefined;
	private request: AbortController | undefined;

	public constructor(public job: StudioBuildJob, private readonly builds: WorkspaceBuilds) {
		super(`build-log:${job.request.requestId}`, 'build_log', `Build: ${job.request.target}`, true);
		this.setLabel(this.title, job.request.requestId);
		this.errorText = job.error;
		if (job.error !== undefined) this.error = new WorkbenchTextViewModel(new PieceTreeBuffer(job.error));
		this.channel = job.error === undefined ? 'output' : 'error';
		this.disposables.add({ dispose: () => this.request?.abort() });
	}

	public get document(): WorkbenchTextViewModel { return this.channel === 'error' ? this.error! : this.output; }

	/** Fetching never reopens a closed input or changes the selected request identity. */
	public async refresh(): Promise<void> {
		if (this.disposables.isDisposed) return;
		this.request?.abort();
		const request = new AbortController();
		this.request = request; this.loading = true; this.readError = undefined; this.revision++;
		try {
			const job = await this.builds.get(this.job.request.requestId, request.signal);
			if (request.signal.aborted) return;
			if (job === undefined) { this.readError = 'This build request is no longer available.'; return; }
			this.job = job;
			if (this.errorText !== job.error) {
				if (job.error === undefined) { this.error = undefined; this.channel = 'output'; }
				else if (this.error === undefined) this.error = new WorkbenchTextViewModel(new PieceTreeBuffer(job.error));
				else this.error.setBuffer(new PieceTreeBuffer(job.error));
				this.errorText = job.error;
			}
			this.revision++;
			const output = await this.builds.log(job.request.requestId, request.signal);
			if (request.signal.aborted) return;
			if (this.outputText !== output) {
				this.output.setBuffer(new PieceTreeBuffer(output)); this.outputText = output;
			}
		} catch (error) {
			if (!request.signal.aborted) this.readError = String(error);
		} finally {
			if (this.request === request) { this.request = undefined; this.loading = false; this.revision++; }
		}
	}
}

export function openBuildLog(group: EditorGroupView, builds: WorkspaceBuilds, job: StudioBuildJob): BuildLogInput {
	const id = `build-log:${job.request.requestId}` as const;
	const input = group.model.findById(id) ?? new BuildLogInput(job, builds);
	group.openEditor(input);
	void input.refresh();
	return input;
}
