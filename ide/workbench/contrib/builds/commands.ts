import type { CartEditor } from '../../../cart_editor';
import type { DisposableStore } from '../../../common/lifecycle';
import { showEditorMessage } from '../../../common/feedback_state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { isBuildTerminal, type StudioBuildJob } from '../../../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../../services/builds';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { openBuildLog } from './editor_input';
import type { BuildOutputs } from './output';
import type { EditorGroupView } from '../../services/editor/editor_group';

type BuildAction = QuickPickItem & { run(preserveFocus: boolean): Promise<void> };

/** One request reader retains its actual receiving group independently of later activation. */
type BuildRequestContext = {
	readonly builds: WorkspaceBuilds;
	readonly outputs: BuildOutputs;
	readonly id: string;
	readonly reference: EditorGroupView;
};

export function chooseBuild(editor: CartEditor): void {
	const builds = editor.builds!, outputs = editor.buildOutputs!;
	editor.quickInput.pick('Build cartridge', 'Saved files only; unsaved editor drafts are not included',
		async (_origin, lifetime) => {
			const read = new AbortController();
			lifetime.add({ dispose: () => read.abort() });
			return new TextQuickPickProvider((await builds.targets(read.signal)).map(target => ({
				label: target, description: 'Build with matching BIOS', detail: '', target,
			})));
		},
		(choice, _modifiers, preserveFocus) => {
			if (preserveFocus) return;
			const recipes = [true, false].flatMap(debug => ([3, 2, 1, 0] as const).map(optLevel => ({
				label: `${debug ? 'Debug' : 'Release'} -O${optLevel}`, description: choice.target, detail: 'No runtime reload', debug, optLevel,
			})));
			editor.quickInput.pick('Build recipe', 'Choose effective compiler options', () => new TextQuickPickProvider(recipes), recipe => {
				void builds.submit(choice.target, recipe.debug, recipe.optLevel).then(job => {
					showEditorMessage(`Build accepted: ${job.request.target}. See Studio: Build Jobs.`, 'success', 5);
				}).catch(reportBuildError);
			}, undefined, { owner: outputs });
		}, undefined, { owner: outputs });
}

export function showBuildJobs(editor: CartEditor, reference: EditorGroupView): void {
	const builds = editor.builds!, outputs = editor.buildOutputs!;
	const jobs = [...builds.jobs].sort((a, b) => b.acceptedAt - a.acceptedAt);
	const choices = [
		...builds.pending.map(request => ({ label: request.target, description: 'Acknowledgement unknown; inspect this request', detail: request.requestId, id: request.requestId })),
		...jobs.map(job => ({ label: `${job.request.target} - ${job.state}`, description: job.phase, detail: job.request.requestId, id: job.request.requestId })),
	];
	editor.quickInput.pick('Workspace builds', 'Recent jobs; select a request to obtain its current state', () => new TextQuickPickProvider(choices),
		(choice, _modifiers, preserveFocus) => {
			if (!preserveFocus) showBuildRequest(editor, { builds, outputs, id: choice.id, reference }, signal => builds.get(choice.id, signal));
		}, undefined, { owner: outputs });
}

export function chooseBuildOutput(editor: CartEditor): void {
	const builds = editor.builds!, outputs = editor.buildOutputs!;
	const choices = [...builds.jobs].sort((left, right) => right.acceptedAt - left.acceptedAt).map(job => ({
		label: job.request.target, description: `${job.state} | ${job.request.debug ? 'Debug' : 'Release'} -O${job.request.optLevel}`,
		detail: job.request.requestId, job,
	}));
	const selected = editor.buildOutput.selectedResult;
	const selectedIndex = selected !== undefined && !selected.isDisposed
		? choices.findIndex(choice => choice.job.request.requestId === selected.requestId) : 0;
	editor.quickInput.pick('Select Build', 'Choose an admitted request to inspect in Main', () => new TextQuickPickProvider(choices, selectedIndex),
		(choice, _modifiers, preserveFocus) => {
			if (preserveFocus) return;
			const result = outputs.get(choice.job);
			if (editor.mainWorkspace.openActivity('builds.output', { focus: false }) && editor.buildOutput.select(result, { focus: true })
				&& !result.isDisposed)
				void result.refresh();
		}, undefined, { owner: outputs });
}

/** Reads belong to this admitted catalog; an already accepted mutation keeps its own operation lifetime. */
function showBuildRequest(editor: CartEditor, context: BuildRequestContext,
	request: ((signal: AbortSignal) => Promise<StudioBuildJob | undefined>) | Promise<StudioBuildJob>): void {
	const { outputs } = context;
	const provide = request instanceof Promise
		? request.then(job => new TextQuickPickProvider(buildRequestActions(editor, context, job)))
		: async (_origin: InputFocusTarget | null, lifetime: DisposableStore) => {
			const read = new AbortController();
			lifetime.add({ dispose: () => read.abort() });
			return new TextQuickPickProvider(buildRequestActions(editor, context, await request(read.signal)));
		};
	editor.quickInput.pick('Build request', 'Inspect the original request; publication does not install it', provide,
		(choice, _modifiers, preserveFocus) => {
			void choice.run(preserveFocus).catch(reportBuildError);
		}, undefined, { owner: outputs });
}

function buildRequestActions(editor: CartEditor, context: BuildRequestContext, job: StudioBuildJob | undefined): BuildAction[] {
	const { builds, outputs, id, reference } = context;
	if (job === undefined) return [
		{ label: 'Check request again', description: id, detail: 'No durable receipt; no build was automatically repeated',
			run: async preserveFocus => { if (!preserveFocus) showBuildRequest(editor, context, signal => builds.get(id, signal)); } },
		{ label: 'Copy request ID', description: id, detail: '', run: async () => { await editor.clipboard.writeText(id); } },
		{ label: 'Dismiss local receipt', description: 'Does not cancel or repeat a build', detail: id,
			run: async () => { builds.forget(id); } },
	];
	const choices: BuildAction[] = [
		{ label: `${job.request.target}: ${job.state}`, description: job.phase, detail: `${job.request.debug ? 'Debug' : 'Release'} -O${job.request.optLevel}`,
			run: async preserveFocus => { if (!preserveFocus) showBuildRequest(editor, context, signal => builds.get(id, signal)); } },
		{ label: 'Refresh status', description: 'Read the original request', detail: '',
			run: async preserveFocus => { if (!preserveFocus) showBuildRequest(editor, context, signal => builds.get(id, signal)); } },
		{ label: 'View build log', description: 'Read the captured output and failure diagnostic', detail: job.error ?? '', run: async preserveFocus => {
			if (!preserveFocus) openBuildLog(reference, outputs.get(job));
		} },
		{ label: 'Show in Main Output', description: 'Keep the request independent of document readers', detail: job.request.target,
			run: async preserveFocus => {
				if (preserveFocus) return;
				const result = outputs.get(job);
				if (editor.mainWorkspace.openActivity('builds.output', { focus: false }) && editor.buildOutput.select(result, { focus: true })
					&& !result.isDisposed)
					void result.refresh();
			} },
		{ label: 'Copy request ID', description: id, detail: '', run: async () => { await editor.clipboard.writeText(id); } },
	];
	if (job.artifact !== undefined && job.state === 'completed') {
		const artifact = job.artifact, openBuild = editor.openPublishedBuild;
		if (openBuild !== undefined && job.project !== undefined) choices.unshift({ label: 'Open published build in new Studio window',
			description: 'Exact cartridge and matching BIOS', detail: 'Current runtime and unsaved files stay in this window. Reboot applies workspace edits.', run: async preserveFocus => {
				if (preserveFocus) return;
				const focusRevision = inputFocus.revision, opened = openBuild(id);
				if (opened.status === 'blocked' && inputFocus.revision === focusRevision && !outputs.isDisposed) {
					const recovery: BuildAction[] = [
						{ label: 'Retry opening published build', description: job.request.target, detail: opened.url, run: async preserveFocus => {
							if (preserveFocus) return;
							const revision = inputFocus.revision, retried = openBuild(id);
							if (retried.status === 'blocked' && inputFocus.revision === revision && !outputs.isDisposed)
								reportBuildError('Browser still blocks the tab. Allow pop-ups or copy its URL.');
						} },
						{ label: 'Copy published build URL', description: 'Open in a normal browser tab', detail: opened.url,
							run: async () => { await editor.clipboard.writeText(opened.url); } },
					];
					editor.quickInput.pick('Browser blocked the new Studio tab', 'Allow pop-ups for this site, then retry',
						() => new TextQuickPickProvider(recovery), (choice, _modifiers, preserveFocus) => {
							void choice.run(preserveFocus).catch(reportBuildError);
						}, undefined, { owner: outputs });
				}
			} });
		choices.push({ label: 'Copy published artifact ID', description: artifact,
			detail: 'Published; not installed', run: async () => { await editor.clipboard.writeText(artifact); } });
	}
	if (!isBuildTerminal(job.state)) choices.push({ label: 'Cancel build', description: 'Wait for the producer to stop',
		detail: 'Already published results are not rolled back.', run: async preserveFocus => {
			const cancellation = builds.cancel(id);
			if (preserveFocus) { void cancellation.catch(reportBuildError); return; }
			showBuildRequest(editor, context, cancellation);
		} });
	return choices;
}

function reportBuildError(error: unknown): void { showEditorMessage(String(error), 'error', 8); }
