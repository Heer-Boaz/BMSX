import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { showEditorMessage } from '../../../ide/common/feedback_state';
import { COLOR_STATUS_TEXT } from '../../../ide/common/constants';
import { toggleBreakpoint } from '../../../ide/workbench/contrib/debugger/controller';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Real app-server dynamic tools drive the shared Terminal; no direct evaluation shortcut. */
export async function runAssistantTerminal(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, cycles, press } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'terminal tools: boot actual cart');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await frame();
	const source = test.harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- terminal must not install source\n' }]);
	const version = source.version, media = ide.sources.currentBlua32Media;
	await test.runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	const conversation = ide.editor.assistant, terminal = ide.terminal;
	await test.runMenuCommand('pause');
	const repl = { domain: -1 as const, path: 'shell/repl.lua' };
	const line = resolveRuntimeLuaSource(ide.sources, repl)!.record.src.split('\n').findIndex(text => text.includes('return pcall(chunk)')) + 1;
	toggleBreakpoint(ide.debugger, repl, line);
	await submitAssistantText(test, 'Execute Lua, continue after the breakpoint, inspect the result and test errors without changing cart source.');
	await until(() => ide.debugger.stopped && terminal.active !== undefined, 'terminal tools: actual BIOS breakpoint');
	check(terminal.active!.result === undefined, 'breakpoint retains the actual call');
	toggleBreakpoint(ide.debugger, repl, line);
	await until(() => conversation.state === 'ready', 'terminal tools: model receives pause, continues and finishes');
	check(source.version === version && ide.sources.currentBlua32Media === media && test.execution.userPaused,
		'Terminal neither saves nor installs source, and retains independent pause');
	const stopped = cycles();
	for (let i = 0; i < 6; i++) await frame();
	check(cycles() === stopped, 'Lua completion does not continue gameplay');
	const queued = terminal.evaluate('counter = 900'), lifetime = new AbortController();
	const waiting = terminal.waitForStop(queued, lifetime.signal);
	lifetime.abort();
	await waiting.then(() => { throw new Error('Queued evaluation must reject on abort'); }, error => {
		check(error.name === 'AbortError', 'queued cancellation reports request retirement');
	});
	await test.tasks.join();
	check(queued.result!.status === 'interrupted' && cycles() === stopped, 'cancellation revokes actual queued CPU admission');
	await test.runPaletteCommand('View: Lua Terminal');
	const input = getActiveTab(); if (input.kind !== 'terminal') throw new Error('Terminal pane required');
	await renderer.capture!('conversation-results');
	await test.click(input.composerBounds); test.clipboard.text = 'counter';
	await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => terminal.active === undefined && test.tasks.ready, 'terminal tools: ordinary manual evaluation');
	check(terminal.transcript.entry(terminal.transcript.next - 1).text === '43', 'manual Terminal sees the same namespace and retained pre-error mutation');
	await test.runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Run until I press Stop.');
	await until(() => terminal.active !== undefined && terminal.canToggleExecution && cycles() > stopped,
		'terminal tools: real infinite guest call is running');
	const operation = terminal.active!;
	const stop = view.turnActions.items.find(item => item.command === 'assistant.stop')!;
	// Deterministically expire a real status row during hover, before mouse-down.
	// The canvas itself stays the same size; actionability must track the target.
	showEditorMessage('Terminal running', COLOR_STATUS_TEXT, 1);
	await frame(); await frame();
	const topBeforeExpiry = stop.bounds.top;
	showEditorMessage('Terminal running', COLOR_STATUS_TEXT, runtime.timing.frameDurationMs * 0.5 / 1000);
	await test.click(stop.bounds);
	check(stop.bounds.top !== topBeforeExpiry, 'Stop remains reachable when the transient status row disappears');
	check(terminal.paused && (conversation.state === 'stopping' || conversation.state === 'ready'),
		`visible Stop synchronously suspends its owned call: ${JSON.stringify({ state: conversation.state, status: operation.status,
			view: getActiveTab().kind, revision: test.execution.revision, owned: operation.executionRevision, version: operation.controlVersion })}`);
	await until(() => conversation.state === 'ready' && terminal.paused, 'terminal tools: visible Stop suspends guest work');
	const pausedAt = cycles();
	for (let i = 0; i < 6; i++) await frame();
	check(cycles() === pausedAt && operation.result === undefined && terminal.active === operation && !terminal.canEvaluate,
		'Stop retains frames/mutations and never fabricates completion or admits a second call');
	await submitAssistantText(test, 'Read the suspended Terminal and try a stale evaluation handle.');
	await until(() => conversation.state === 'ready', 'terminal tools: new conversation turn observes retained execution');
	check(terminal.active === operation && terminal.paused, 'new prompt cannot implicitly discard the suspended call');
	await test.runPaletteCommand('View: Lua Terminal'); await frame();
	await renderer.capture!('stopped-stack');
	await test.runMenuCommand('reboot');
	await press('Enter'); // Explicitly accept the ordinary dirty-source Save and Reboot prompt.
	await until(() => operation.result !== undefined, 'terminal tools: explicit reboot ends pending observer');
	check(operation.result!.status === 'interrupted', 'reset is reported as interruption, not success');
	await renderer.finish(); await ide.editor.shutdown();
	return { terminal: 'pass', target: ide.inspection.target };
}
