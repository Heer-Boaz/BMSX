import type { StudioBuildJob } from '../../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../../../ide/workbench/services/builds';
import { BuildLogInput } from '../../../ide/workbench/contrib/builds/editor_input';
import type { EditorCommandId } from '../../../ide/common/commands';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

const OUTPUT = '\u001b[32mcompile\u001b[0m\r\n\tstdout + stderr: naïve Ω 😀\r\n'
	+ Array.from({ length: 96 }, (_, index) => `unit ${index}: output needle ${index} ${'long captured compiler detail '.repeat(4)}\r\n`).join('')
	+ 'unterminated final output';
const DIAGNOSTIC = 'Build failed: fixture compiler diagnostic\r\n'
	+ Array.from({ length: 32 }, (_, index) => `failure ${index}: diagnostic needle; exact supplied failure text\r\n`).join('');

/** Controlled build-service boundary, not a replacement editor or an ordinary-cart build. */
class BuildOutputFixture implements WorkspaceBuilds {
	public job: StudioBuildJob = {
		request: { requestId: 'build-output-ui-request', target: 'build_output_fixture', debug: true, optLevel: 3 },
		state: 'failed', phase: 'compile', acceptedAt: 1, updatedAt: 2,
		version: { generation: 1, sequence: 1 }, error: DIAGNOSTIC,
	};
	public output = OUTPUT;
	public readonly pending = [];
	public logReads = 0;
	public holdLog = false;
	public heldSignal: AbortSignal | undefined;
	public completeLog: (() => void) | undefined;
	public get jobs() { return [this.job]; }
	public async targets() { return ['build_output_fixture']; }
	public async submit(): Promise<StudioBuildJob> { throw new Error('Build Output UI must not submit a compiler job'); }
	public async cancel(): Promise<StudioBuildJob> { throw new Error('Reading captured Build Output must not cancel a compiler job'); }
	public forget(): void { throw new Error('Reading captured Build Output must not forget its request'); }
	public async get(requestId: string) {
		check(requestId === this.job.request.requestId, 'build output: reads retain the admitted request identity');
		return this.job;
	}
	public async log(requestId: string, signal?: AbortSignal) {
		check(requestId === this.job.request.requestId, 'build output: log reads address the same admitted request');
		this.logReads++;
		if (this.holdLog) {
			this.heldSignal = signal;
			await new Promise<void>(resolve => { this.completeLog = resolve; });
		}
		return this.output;
	}
}

/** Explicitly authorized offscreen Workbench UI, using a dedicated cartridge only as transport. */
export async function runStudioBuildOutput(test: StudioFixture) {
	const { ide, frame, press } = test, editor = ide.editor;
	await test.until(() => ide.sources.activeCartridgeSlot === 0, 'build output: dedicated cartridge starts');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	const before = test.cycles(), media = ide.sources.currentBlua32Media;
	const builds = new BuildOutputFixture();
	editor.builds = builds;
	test.presenter.setFixedRenderTargetSize(640, 360);
	ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize);
	await frame();
	await test.runPaletteCommand('Studio: Build Jobs');
	await chooseQuickPick(test, `${builds.job.request.target} - failed`);
	await chooseQuickPick(test, 'View build log');
	await test.until(() => editor.editorParts.activeGroup.model.activeTab instanceof BuildLogInput,
		'build output: Build Jobs opens the actual native document input');
	const first = editor.editorParts.activeGroup.model.activeTab;
	if (!(first instanceof BuildLogInput)) throw new Error('build output: actual Build Output input required');
	const originalGroup = editor.editorParts.findGroup(first)!;
	await test.until(() => !first.view.result.loading && first.view.result.outputText === OUTPUT,
		'build output: the admitted observation captures the exact provider output');
	check(first.view.channel === 'error', 'build output: a failed receipt initially presents its own diagnostic');
	await copyDocument(test, DIAGNOSTIC);
	await find(test, 'diagnostic needle');
	check(first.view.error!.matchCount === 32, 'build output: Find searches the failure document, not captured stdout/stderr');
	await titleAction(test, first, 'buildLog.output');
	await copyDocument(test, OUTPUT);
	await find(test, 'output needle');
	await press('Enter'); await press('Escape');
	await press('ControlLeft', 'Home');
	test.movePointer(first.view.output.viewport.bounds); await frame();
	test.remote.apply([{ type: 'wheel', deltaY: 9 }]); await frame();
	const firstDocument = first.view.output, firstQuery = firstDocument.query;
	const firstReading = firstDocument.viewport.scrollTop, firstCursor = firstDocument.cursorOffset;
	check(firstReading > 0, 'build output: ordinary wheel input establishes retained reading intent');

	await test.runPaletteCommand('Window: Open Editor in New Window');
	const peer = editor.editorParts.activeGroup.model.activeTab;
	if (!(peer instanceof BuildLogInput)) throw new Error('build output: native new-window command must create a Build Output reader');
	check(peer !== first && peer.view !== first.view && peer.view.result === first.view.result
		&& peer.view.output !== firstDocument && peer.view.output.buffer === firstDocument.buffer,
		'build output: new-window readers share the captured document but never its reading model');
	check(peer.view.channel === 'output' && peer.view.output.query === '' && peer.view.output.cursorOffset === 0,
		'build output: a second reader begins with an independent query and selection');
	await find(test, 'unit 7:'); await press('Escape');
	await titleAction(test, peer, 'buildLog.error');
	await find(test, 'failure 9:'); await press('Escape');
	check(first.view.channel === 'output' && firstDocument.query === firstQuery
		&& firstDocument.cursorOffset === firstCursor && firstDocument.viewport.scrollTop === firstReading
		&& peer.view.error!.query === 'failure 9:',
		'build output: channel, search, caret and reading belong independently to each reader');

	await focusReader(test, first);
	await test.runPaletteCommand('Window: Move Editor To…');
	await chooseQuickPick(test, 'New Editor Window');
	const movedGroup = editor.editorParts.findGroup(first)!;
	check(movedGroup !== originalGroup && editor.editorParts.partForGroup(movedGroup).kind === 'document'
		&& first.view.output === firstDocument && firstDocument.query === firstQuery && firstDocument.cursorOffset === firstCursor,
		'build output: moving the existing reader transfers its exact retained state rather than copying it');
	await test.runPaletteCommand('Window: Move Editor To…');
	await chooseQuickPick(test, 'Main Workspace');
	check(editor.editorParts.findGroup(first) === originalGroup && first.view.output === firstDocument
		&& firstDocument.query === firstQuery && firstDocument.cursorOffset === firstCursor,
		'build output: docking the same reader back into Main preserves its document and reading owner');

	await test.runPaletteCommand('Window: Show Open Windows');
	await chooseQuickPick(test, 'Editor');
	await test.runPaletteCommand('Window: Close Window');

	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await focusReader(test, peer);
			await titleAction(test, peer, 'buildLog.output');
			await frame(); await test.capture?.(`build-output-${editor.fontVariant}-theme-${theme}-two-readers`);
			test.presenter.setFixedRenderTargetSize(260, 180);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			await titleAction(test, peer, 'buildLog.error');
			await copyDocument(test, DIAGNOSTIC);
			await find(test, 'failure 9:'); await press('Escape');
			check(peer.view.error!.matchCount === 1 && first.view.channel === 'output' && firstDocument.query === firstQuery
				&& peer.view.output.query === 'unit 7:' && first.view.error!.query === 'diagnostic needle',
				'build output: constrained font/theme reflow and channel switching retain independent document queries');
			await frame(); await test.capture?.(`build-output-${editor.fontVariant}-theme-${theme}-constrained-diagnostic`);
			test.presenter.setFixedRenderTargetSize(80, 180);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			check(peer.view.actions.items.find(item => item.command === 'buildLog.copyAll')!.overflowed,
				'build output: responsive title actions retain Copy in the real More menu under constrained width');
			await test.click(peer.view.actions.overflow!.button.bounds);
			await frame(); await test.capture?.(`build-output-${editor.fontVariant}-theme-${theme}-overflow`);
			await test.clickContextCommand('buildLog.copyAll');
			check(await test.clipboard.readText() === DIAGNOSTIC,
				'build output: the native overflow action copies the exact active failure document');
			test.presenter.setFixedRenderTargetSize(640, 360);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}

	await focusReader(test, first);
	const originalBuffer = first.view.output.buffer;
	builds.output += '\r\nrefreshed shared observation';
	await titleAction(test, first, 'buildLog.refresh');
	await test.until(() => !first.view.result.loading && first.view.result.outputText === builds.output,
		'build output: public Refresh publishes one new shared captured document');
	check(first.view.output.buffer !== originalBuffer && peer.view.output.buffer === first.view.output.buffer
		&& firstDocument.query === firstQuery && peer.view.output.query === 'unit 7:' && peer.view.channel === 'error',
		'build output: publication updates both readers without sharing their channels or queries');

	await focusReader(test, peer);
	builds.holdLog = true;
	const reads = builds.logReads;
	await titleAction(test, peer, 'buildLog.refresh');
	await test.until(() => builds.completeLog !== undefined, 'build output: peer refresh reaches a controlled in-flight log read');
	await focusReader(test, first); await press('ControlLeft', 'KeyW');
	await test.until(() => editor.editorParts.findGroup(first) === undefined, 'build output: ordinary close retires one reader');
	check(!builds.heldSignal!.aborted && peer.view.result.loading && builds.logReads === reads + 1,
		'build output: closing a sibling reader cannot abort or duplicate the shared in-flight refresh');
	builds.output += '\r\npeer refresh completed after sibling close';
	builds.completeLog!();
	await test.until(() => !peer.view.result.loading && peer.view.result.outputText === builds.output,
		'build output: the surviving reader receives the refresh after its sibling closes');
	await focusReader(test, peer); await titleAction(test, peer, 'buildLog.output');
	await copyDocument(test, builds.output);
	check(peer.view.output.query === 'unit 7:' && peer.view.error!.query === 'failure 9:'
		&& ide.sources.currentBlua32Media === media && test.cycles() === before,
		'build output: reading, refreshing and closing observations never installs or executes cartridge content');
	await frame(); await test.capture?.('build-output-surviving-reader');
	await press('ControlLeft', 'KeyW');
	editor.builds = undefined;
	return { buildOutput: 'pass', hostFrames: test.observations.hostFrames, cycles: test.cycles(), logReads: builds.logReads };
}

/** Labels identify an actual quick-pick action; assertions concern the resulting owner/state, not wording. */
async function chooseQuickPick(test: StudioFixture, label: string): Promise<void> {
	const picker = test.ide.editor.quickInput;
	await test.until(() => picker.visible && picker.model.list.rows.some(row => row.item.label === label),
		'build output: the requested native quick-pick action becomes available');
	await test.press('Home');
	const index = picker.model.list.rows.findIndex(row => row.item.label === label);
	for (let step = 0; step < index; step++) await test.press('ArrowDown');
	await test.press('Enter');
}

async function titleAction(test: StudioFixture, input: BuildLogInput, command: EditorCommandId): Promise<void> {
	await test.frame();
	const item = input.view.actions.items.find(item => item.command === command)!;
	check(item.visible && item.enabled, 'build output: the requested native title action is available');
	if (item.overflowed) {
		await test.click(input.view.actions.overflow!.button.bounds);
		await test.clickContextCommand(command);
	} else await test.click(item.bounds);
}

/** Exact clipboard bytes are a captured-build-data integrity contract, including CRLF, tabs, ANSI and Unicode. */
async function copyDocument(test: StudioFixture, expected: string): Promise<void> {
	const pane = test.ide.editor.editorParts.activeGroup.panes.activePane!;
	await test.press('Escape');
	// Title actions restore their document's native reading focus; the initial admitted pane does likewise.
	check(inputFocus.admittedTarget === pane.commandTarget, 'build output: document input owns native Select All and Copy');
	await test.press('ControlLeft', 'KeyA'); await test.press('ControlLeft', 'KeyC');
	check(await test.clipboard.readText() === expected, 'build output: native selected-text Copy preserves the exact captured document bytes');
}

async function find(test: StudioFixture, query: string): Promise<void> {
	await test.press('ControlLeft', 'KeyF');
	await test.clipboard.writeText(query); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
}

/** Window selection can reveal a fully occluded reader without fabricating an unobscured pointer target. */
async function focusReader(test: StudioFixture, input: BuildLogInput): Promise<void> {
	const parts = test.ide.editor.editorParts, group = parts.findGroup(input)!, part = parts.partForGroup(group);
	await test.runPaletteCommand('Window: Show Open Windows');
	await chooseQuickPick(test, part.kind === 'main' ? 'Main Workspace' : group.model.getLabel(input));
	check(parts.activeGroup === group && group.model.activeTab === input && inputFocus.admittedTarget !== null
		&& group.focusScope.contains(inputFocus.admittedTarget.scope),
		'build output: the native window picker reveals and focuses the actual retained reader');
}
