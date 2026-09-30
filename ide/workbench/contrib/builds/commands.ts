import type { CartEditor } from '../../../cart_editor';
import { COLOR_STATUS_ERROR, COLOR_STATUS_SUCCESS } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { isBuildTerminal, type StudioBuildJob } from '../../../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../../services/builds';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

type BuildAction = QuickPickItem & { run(): Promise<void> };

export async function chooseBuild(editor: CartEditor): Promise<void> {
	const builds = editor.builds!;
	try {
		const targets = await builds.targets();
		editor.quickInput.pick('Build cartridge', 'Saved files only; unsaved editor drafts are not included',
			() => new TextQuickPickProvider(targets.map(target => ({ label: target, description: 'Build with matching BIOS', detail: '', target }))),
			choice => {
				const recipes = [true, false].flatMap(debug => ([3, 2, 1, 0] as const).map(optLevel => ({
					label: `${debug ? 'Debug' : 'Release'} -O${optLevel}`, description: choice.target, detail: 'No runtime reload', debug, optLevel,
				})));
				editor.quickInput.pick('Build recipe', 'Choose effective compiler options', () => new TextQuickPickProvider(recipes), recipe => {
					void builds.submit(choice.target, recipe.debug, recipe.optLevel).then(job => {
						showEditorMessage(`Build accepted: ${job.request.target}. See Studio: Build Jobs.`, COLOR_STATUS_SUCCESS, 5);
					}).catch(reportBuildError);
				});
			});
	} catch (error) { reportBuildError(error); }
}

export function showBuildJobs(editor: CartEditor): void {
	const builds = editor.builds!;
	const jobs = [...builds.jobs].sort((a, b) => b.acceptedAt - a.acceptedAt);
	const choices = [
		...builds.pending.map(request => ({ label: request.target, description: 'Acknowledgement unknown; inspect this request', detail: request.requestId, id: request.requestId })),
		...jobs.map(job => ({ label: `${job.request.target} - ${job.state}`, description: job.phase, detail: job.request.requestId, id: job.request.requestId })),
	];
	editor.quickInput.pick('Workspace builds', 'Recent jobs; select a request to obtain its current state', () => new TextQuickPickProvider(choices),
		choice => { void inspectBuild(editor, builds, choice.id).catch(reportBuildError); });
}

async function inspectBuild(editor: CartEditor, builds: WorkspaceBuilds, id: string): Promise<void> {
	const job = await builds.get(id);
	if (job === undefined) {
		const choices: BuildAction[] = [
			{ label: 'Check request again', description: id, detail: 'Retains the original request identity',
				run: () => inspectBuild(editor, builds, id) },
			{ label: 'Copy request ID', description: id, detail: '', run: async () => { await editor.clipboard.writeText(id); } },
			{ label: 'Dismiss local receipt', description: 'Does not cancel or repeat a build', detail: id,
				run: async () => { builds.forget(id); } },
		];
		editor.quickInput.pick('Build not admitted', 'No durable receipt currently exists; no build was automatically repeated',
			() => new TextQuickPickProvider(choices), choice => { void choice.run().catch(reportBuildError); });
		return;
	}
	showBuildDetails(editor, builds, job);
}

function showBuildDetails(editor: CartEditor, builds: WorkspaceBuilds, job: StudioBuildJob): void {
	const id = job.request.requestId;
	const choices: BuildAction[] = [
		{ label: `${job.request.target}: ${job.state}`, description: job.phase, detail: `${job.request.debug ? 'Debug' : 'Release'} -O${job.request.optLevel}`,
			run: () => inspectBuild(editor, builds, id) },
		{ label: 'Refresh status', description: 'Read the original request', detail: '', run: () => inspectBuild(editor, builds, id) },
		{ label: 'View build log', description: 'Bounded output; fetched only when requested', detail: job.error ?? '', run: async () => {
			const text = [job.error, await builds.log(id)].filter(value => value !== undefined).join('\n');
			// disable-next-line newline_normalization_pattern -- Producer output is displayed as searchable log lines.
			const lines = text.split(/\r\n|\r|\n/).filter(line => line.length !== 0);
			editor.quickInput.pick('Build log', 'Search output; select a line to copy it', () => new TextQuickPickProvider(
				lines.map(line => ({ label: line, description: '', detail: '' }))), line => { void editor.clipboard.writeText(line.label).catch(reportBuildError); });
		} },
		{ label: 'Copy request ID', description: id, detail: '', run: async () => { await editor.clipboard.writeText(id); } },
	];
	if (job.artifact !== undefined && job.state === 'completed') {
		const artifact = job.artifact, openBuild = editor.openPublishedBuild;
		if (openBuild !== undefined) choices.unshift({ label: 'Open published build in new Studio window',
			description: 'Exact cartridge and matching BIOS', detail: 'Current runtime and unsaved files stay in this window. Reboot applies workspace edits.', run: async () => {
				const opened = openBuild(artifact);
				if (opened.status === 'blocked') {
					const recovery: BuildAction[] = [
						{ label: 'Retry opening published build', description: job.request.target, detail: opened.url, run: async () => {
							if (openBuild(artifact).status === 'blocked') reportBuildError('Browser still blocks the tab. Allow pop-ups or copy its URL.');
						} },
						{ label: 'Copy published build URL', description: 'Open in a normal browser tab', detail: opened.url,
							run: async () => { await editor.clipboard.writeText(opened.url); } },
					];
					editor.quickInput.pick('Browser blocked the new Studio tab', 'Allow pop-ups for this site, then retry',
						() => new TextQuickPickProvider(recovery), choice => { void choice.run().catch(reportBuildError); });
				}
			} });
		choices.push({ label: 'Copy published artifact ID', description: artifact,
			detail: 'Published; not installed', run: async () => { await editor.clipboard.writeText(artifact); } });
	}
	if (!isBuildTerminal(job.state)) choices.push({ label: 'Cancel build', description: 'Wait for the producer to stop',
		detail: 'Already published results are not rolled back.', run: async () => { showBuildDetails(editor, builds, await builds.cancel(id)); } });
	editor.quickInput.pick('Build details', 'Publication and runtime installation are separate',
		() => new TextQuickPickProvider(choices), choice => { void choice.run().catch(reportBuildError); });
}
function reportBuildError(error: unknown): void { showEditorMessage(String(error), COLOR_STATUS_ERROR, 8); }
