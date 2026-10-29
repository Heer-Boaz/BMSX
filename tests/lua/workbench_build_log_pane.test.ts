import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { TEXT_VIEW_PADDING } from '../../ide/workbench/ui/text_view/layout';

import { inputFocus } from '../../ide/input/focus';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { BuildLogInput, openBuildLog } from '../../ide/workbench/contrib/builds/editor_input';
import { BuildOutputs } from '../../ide/workbench/contrib/builds/output';
import { BuildLogPane } from '../../ide/workbench/contrib/builds/editor_pane';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createActualSourcePanes } from '../helpers/source_panes';

const ERROR = 'compiler: first\r\n\t' + 'a_real_long_authored_path/'.repeat(15) + ':1:48: unexpected )\n';

async function fixture(t: TestContext, failed = true, output = '') {
	configureFontVariant('tiny');
	const job: StudioBuildJob = { request: { requestId: 'actual-request-identity', target: 'cpu_soak', debug: true, optLevel: 0 },
		state: failed ? 'failed' : 'completed', phase: 'Done', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1,
		error: failed ? ERROR : undefined };
	let receipt = job;
	let reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['cpu_soak'], submit: async () => job,
		get: async () => { reads++; return receipt; }, cancel: async () => job, forget() {}, log: async () => output };
	const outputs = new BuildOutputs(builds), result = outputs.get(job), input = new BuildLogInput(result), clipboard = new HeadlessClipboard();
	const bounds = { left: 13, top: 21, right: 333, bottom: 241 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const surfaces = new WorkbenchSurfaceService();
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('build log pane'), getBounds: () => bounds,
		getClip: () => bounds, isVisible: () => true, draw() {} });
	const pane = new BuildLogPane(clipboard, menu, surfaces, owner, bounds, inputFocus.workbenchScope);
	await result.refresh(); pane.setInput(input, bounds); pane.focus();
	t.after(() => {
		pane.clearInput(); inputFocus.setTarget(null); pane.dispose(); menu.dispose(); input.dispose(); outputs.dispose();
		pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose();
	});
	return { input, pane, clipboard, bounds, menu, reads: () => reads, publish: (job: StudioBuildJob) => { receipt = job; } };
}

test('channel commands retain independent documents and selection through pane changes', async t => {
	const f = await fixture(t), error = f.input.view.error!;
	assert.equal(f.input.view.channel, 'error'); assert.equal(f.input.resource, undefined); assert.equal(f.input.isDirty(), false);
	assert.equal(inputFocus.target!.clipboard!.readOnly, true);
	assert.equal(f.pane.isActive('buildLog.error'), true);
	error.select(0, 8); error.setQuery('path'); error.nextMatch(1);
	const selection = [error.selectionAnchor, error.cursorOffset], query = error.query;
	// Exact content is the Copy All contract: preserve producer data and line endings, not UI labels.
	f.pane.execute('buildLog.copyAll'); await Promise.resolve(); assert.equal(f.clipboard.text, ERROR);
	f.pane.execute('buildLog.output'); assert.equal(f.input.view.document, f.input.view.output);
	assert.equal(f.pane.isActive('buildLog.output'), true); assert.equal(f.pane.isActive('buildLog.error'), false);
	assert.equal(inputFocus.target!.clipboard!.copy!(), null);
	assert.equal(f.pane.isEnabled('buildLog.copyAll'), false);
	f.pane.execute('buildLog.copyAll'); await Promise.resolve(); assert.equal(f.clipboard.text, ERROR, 'an empty document cannot wipe the clipboard');
	f.pane.execute('buildLog.error');
	assert.equal(f.pane.isActive('buildLog.error'), true); assert.equal(f.pane.isActive('buildLog.output'), false);
	assert.deepEqual([error.selectionAnchor, error.cursorOffset], selection); assert.equal(error.query, query);
	assert.equal(inputFocus.target!.clipboard!.copy!(), ERROR.slice(error.selectionStart, error.selectionEnd));
	const reads = f.reads(); f.pane.clearInput(); f.pane.setInput(f.input, f.bounds); f.pane.focus();
	assert.equal(f.reads(), reads, 'view attachment never requests or reconstructs source');
	assert.equal(f.input.view.document, error); assert.deepEqual([error.selectionAnchor, error.cursorOffset], selection);
	assert.equal(inputFocus.target!.clipboard!.copy!(), ERROR.slice(error.selectionStart, error.selectionEnd));
});

test('an observed empty document disables copying and has no diagnostic channel', async t => {
	const f = await fixture(t, false);
	assert.equal(f.input.view.channel, 'output'); assert.equal(f.input.view.error, undefined);
	assert.equal(f.input.view.result.outputText, ''); assert.equal(f.input.view.document.buffer.length, 0);
	assert.equal(inputFocus.target!.clipboard!.copy!(), null);
	assert.equal(f.input.view.actions.items.filter(item => item.visible && (item.command === 'buildLog.error' || item.command === 'buildLog.output')).length, 0);
	assert.equal(f.pane.isEnabled('buildLog.error'), false); f.pane.execute('buildLog.error');
	assert.equal(f.input.view.channel, 'output'); assert.equal(f.pane.isEnabled('buildLog.copyAll'), false);
});

for (const restore of [false, true]) test(`diagnostic publication retires an armed channel overflow before the next pane update${restore ? ' even when the diagnostic reappears' : ''}`, async t => {
	const f = await fixture(t), { input, pane, menu } = f;
	const projection = input.view.actions.menu!, entries = projection.entries, visible = projection.visibleItems;
	const error = input.view.actions.items.find(item => item.command === 'buildLog.error')!;
	const output = input.view.actions.items.find(item => item.command === 'buildLog.output')!;
	const copy = input.view.actions.items.find(item => item.command === 'buildLog.copyAll')!;
	const errorDocument = input.view.error, outputDocument = input.view.output;
	assert.equal(error.visible, true); assert.equal(output.visible, true);
	f.bounds.right = f.bounds.left + 18; pane.layout(f.bounds); pane.update();
	const button = input.view.actions.overflow!.button;
	assert.equal(button.visible, true);
	const snapshot: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		viewportX: (button.bounds.left + button.bounds.right) / 2, viewportY: (button.bounds.top + button.bounds.bottom) / 2,
		pressedButtons: 0, justPressedButtons: PointerButton.Primary, justReleasedButtons: PointerButton.Primary };
	pane.handlePointer(snapshot, true, false, 1, false);
	assert.equal(menu.visible, true);
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none, false, down));
	assert.equal(menu.model.rows[menu.model.selectedIndex].command, 'buildLog.output');
	const execute = t.mock.method(pane, 'execute');
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, true));
	f.publish({ ...input.view.result.job, state: 'completed', error: undefined });
	await input.view.result.refresh();
	assert.equal(input.view.channel, 'output'); assert.equal(pane.isEnabled('buildLog.output'), true);
	if (restore) { f.publish({ ...input.view.result.job, state: 'failed', error: ERROR }); await input.view.result.refresh(); }
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(execute.mock.callCount(), 0, 'enabled capability cannot admit a channel placement from a retired diagnostic');
	assert.equal(menu.visible, false);
	pane.update();
	assert.equal(error.visible, restore); assert.equal(output.visible, restore);
	assert.equal(copy.visible, true); assert.equal(copy.enabled, false, 'an empty output disables Copy All rather than hiding its placement');
	assert.equal(input.view.output, outputDocument);
	f.publish({ ...input.view.result.job, state: 'failed', error: ERROR }); await input.view.result.refresh(); pane.update();
	assert.equal(error.visible, true); assert.equal(output.visible, true);
	assert.equal(input.view.actions.menu, projection); assert.equal(projection.entries, entries); assert.equal(projection.visibleItems, visible);
	assert.equal(input.view.actions.items.find(item => item.command === 'buildLog.error'), error);
	assert.equal(input.view.actions.items.find(item => item.command === 'buildLog.output'), output);
	assert.notEqual(input.view.error, errorDocument, 'a removed diagnostic document is not a hidden fallback snapshot');
	assert.equal(input.view.output, outputDocument);
});

test('document Find belongs to the document/query leaf and cannot mutate a resource working copy', async t => {
	const f = await fixture(t);
	const source = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'owned.lua', location: { kind: 'workspace' as const, path: 'owned.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'owned.lua', source: { type: 'lua', resid: 'owned' } }, 'lua', 'return 1');
	t.after(() => source.dispose());
	source.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	const text = source.buffer.getText(), version = source.version, dirty = source.dirty;
	const leaf = inputFocus.target!;
	const command = resolveEditorCommandKeybinding('KeyF', KeyModifier.ctrl, undefined, leaf);
	assert.equal(command?.command, 'text.find');
	assert.equal(inputFocus.moveFocus(false), true);
	const actions = inputFocus.target!;
	assert.equal(actions.parent === leaf.parent, true, 'Tab reaches the actual sibling title actions, not the pane itself');
	assert.equal(resolveEditorCommandKeybinding('KeyF', KeyModifier.ctrl, undefined)?.command, 'text.find', 'the title actions expose the same document command');
	leaf.focus();
	assert.equal(leaf.getCommand('undo'), undefined); assert.equal(leaf.getCommand('redo'), undefined);
	leaf.getCommand('text.find')!.run(); f.pane.update();
	const query = inputFocus.target!;
	assert.notEqual(query, leaf); assert.equal(query.getCommand('text.find')!.isEnabled(), true);
	assert.equal(query.next === actions, true, 'Find participates in the pane navigation, not a two-control Tab trap');
	assert.equal(query.getCommand('buildLog.error')!.isEnabled(), true);
	f.bounds.right = f.bounds.left + 18; f.pane.layout(f.bounds); f.pane.update();
	assert.equal(query.canFocus!(), false); assert.equal(leaf.next === actions, true, 'an unarranged query cannot block Tab');
	f.bounds.right = f.bounds.left + 320; f.pane.layout(f.bounds); f.pane.update();
	assert.equal(leaf.next === query, true); assert.equal(query.next === actions, true);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, true));
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, false));
	f.pane.update(); assert.equal(inputFocus.target, leaf); assert.equal(leaf.next === actions, true);
	// Canonical source content is the isolation contract, independent of displayed UI wording.
	assert.equal(source.buffer.getText(), text); assert.equal(source.version, version); assert.equal(source.dirty, dirty);
	assert.equal(f.input.isDirty(), false);
});

test('a Build Output reader moves through real editor groups while a sibling reader retains independent state over the same result', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const job: StudioBuildJob = { request: { requestId: 'portable-build-reader', target: 'fixture-product', debug: true, optLevel: 0 },
		state: 'failed', phase: 'compile', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1, error: ERROR };
	let output = 'first output alpha\r\n', reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => [],
		get: async () => { reads++; return job; }, log: async () => output,
		submit: async () => assert.fail('moving readers cannot submit a build'), cancel: async () => assert.fail('moving readers cannot cancel a build'),
		forget: () => assert.fail('moving readers cannot discard an observation') };
	f.editor.builds = builds;
	const outputs = f.editor.buildOutputs; assert.ok(outputs !== undefined);
	const first = openBuildLog(f.firstGroup, outputs.get(job)); await first.view.result.refresh();
	const result = first.view.result, sibling = first.createView();
	f.secondGroup.openEditor(sibling); f.update();
	first.view.channel = 'output'; first.view.output.select(0, 5); first.view.output.setQuery('alpha');
	sibling.view.error!.selectAll(); sibling.view.error!.setQuery('compiler');
	const firstView = first.view, firstDocument = firstView.output, siblingView = sibling.view, documentParts = parts.documents.length;
	const readsBeforeMove = reads, destination = parts.main.activeGroup;
	assert.equal(parts.moveEditor(f.firstGroup, first, { kind: 'group', group: destination }), true); f.update();
	assert.ok(destination.model.activeTab === first && destination.panes.activePane!.input === first);
	assert.ok(first.view === firstView && firstView.output === firstDocument && firstView.result === result);
	assert.equal(f.firstGroup.model.tabs.includes(first), false); assert.ok(f.secondGroup.model.activeTab === sibling);
	assert.ok(sibling.view === siblingView && siblingView.result === result && siblingView.output !== firstDocument);
	assert.equal(firstDocument.copy(), 'first'); assert.equal(firstDocument.query, 'alpha');
	assert.equal(siblingView.channel, 'error'); assert.equal(siblingView.error!.copy(), ERROR); assert.equal(siblingView.error!.query, 'compiler');
	assert.equal(parts.documents.length, documentParts); assert.equal(reads, readsBeforeMove);
	destination.close(first.id); const retiredRevision = firstView.revision;
	assert.equal(result.isDisposed, false); assert.ok(f.secondGroup.model.activeTab === sibling);
	output = 'next captured output\n'; await result.refresh(); f.update();
	assert.equal(siblingView.output.buffer.getText(), output); assert.ok(siblingView.output.buffer === result.output);
	assert.equal(firstView.revision, retiredRevision); assert.equal(firstDocument.buffer.getText(), 'first output alpha\r\n');
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source); assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('the actual workspace provider owns build observations even when a replacement reuses the same request ID', async t => {
	const f = createActualSourcePanes(t), editor = f.editor;
	const job: StudioBuildJob = { request: { requestId: 'provider-local-request', target: 'fixture-product', debug: true, optLevel: 0 },
		state: 'completed', phase: 'published', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1 };
	let output = Promise.resolve('captured in the first workspace\r\n');
	const logSignals: AbortSignal[] = [];
	const firstProvider: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => [], get: async () => job,
		log: (_id, signal) => { logSignals.push(signal!); return output; },
		submit: async () => assert.fail('reading cannot submit'), cancel: async () => assert.fail('reading cannot cancel'), forget: () => assert.fail('reading cannot discard') };
	editor.builds = firstProvider; const firstStore = editor.buildOutputs; assert.ok(firstStore !== undefined);
	editor.builds = firstProvider; assert.ok(editor.buildOutputs === firstStore, 'assigning the same actual provider does not retire its observations');
	const first = openBuildLog(f.firstGroup, firstStore.get(job)); await first.view.result.refresh(); f.update();
	first.view.output.selectAll(); const buffer = first.view.output.buffer, result = first.view.result;
	const pending = Promise.withResolvers<string>(); output = pending.promise;
	const reading = result.refresh(); await Promise.resolve(); assert.equal(logSignals.length, 2);
	const secondProvider: WorkspaceBuilds = { ...firstProvider, log: async () => 'captured in the replacement workspace\n' };
	editor.builds = secondProvider;
	const secondStore = editor.buildOutputs; assert.ok(secondStore !== undefined && secondStore !== firstStore);
	assert.equal(logSignals[1].aborted, true); assert.equal(result.isDisposed, true); assert.equal(result.loading, false);
	assert.ok(f.firstGroup.model.activeTab === first);
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof BuildLogPane);
	assert.equal(pane.isEnabled('buildLog.refresh'), false);
	pending.resolve('late output from the closed provider'); await reading;
	assert.ok(first.view.output.buffer === buffer); assert.equal(first.view.output.copy(), 'captured in the first workspace\r\n');
	const replacement = openBuildLog(f.firstGroup, secondStore.get(job)); await replacement.view.result.refresh(); f.update();
	assert.ok(replacement !== first && replacement.view.result !== result); assert.equal(replacement.matches(first), false);
	assert.equal(replacement.view.output.buffer.getText(), 'captured in the replacement workspace\n');
	assert.ok(f.firstGroup.model.tabs.includes(first) && f.firstGroup.model.tabs.includes(replacement));
	editor.builds = undefined;
	assert.equal(editor.buildOutputs, undefined); assert.equal(replacement.view.result.isDisposed, true);
	assert.equal(replacement.view.output.buffer.getText(), 'captured in the replacement workspace\n');
});

test('a newer actual provider admitted by output retirement cannot be overwritten by the older replacement', t => {
	const f = createActualSourcePanes(t), editor = f.editor;
	const job: StudioBuildJob = { request: { requestId: 'retirement-provider-request', target: 'fixture-product', debug: true, optLevel: 0 },
		state: 'completed', phase: 'published', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1 };
	const firstProvider: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => [], get: async () => job, log: async () => '',
		submit: async () => assert.fail('retirement cannot submit'), cancel: async () => assert.fail('retirement cannot cancel'), forget: () => assert.fail('retirement cannot discard') };
	const requestedProvider = { ...firstProvider }, newerProvider = { ...firstProvider };
	editor.builds = firstProvider;
	const firstStore = editor.buildOutputs!;
	let admittedStore: BuildOutputs | undefined, retired = 0;
	t.after(firstStore.get(job).onDidChange(() => { retired++; editor.builds = newerProvider; admittedStore = editor.buildOutputs; }));
	editor.builds = requestedProvider;
	assert.equal(retired, 1); assert.ok(editor.builds === newerProvider && editor.buildOutputs === admittedStore);
	assert.ok(editor.buildOutputs !== firstStore && editor.buildOutputs!.get(job).isDisposed === false);
});

test('receipt publication immediately retires a removed diagnostic reader and its held gesture before a pane update', async t => {
	const output = 'first output line\nsecond output line\nthird output line\n';
	const f = await fixture(t, true, output), view = f.input.view, retired = view.error!, leaf = inputFocus.target!;
	retired.setQuery('retired query');
	const body = retired.viewport.bounds;
	const held: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		viewportX: body.left + TEXT_VIEW_PADDING + 1, viewportY: body.top + TEXT_VIEW_PADDING + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	f.pane.handlePointer(held, true, false, 1, false); assert.equal(pointerCapture.active, true);
	const selection = [retired.selectionAnchor, retired.cursorOffset];
	f.publish({ ...view.result.job, state: 'completed', error: undefined }); await view.result.refresh();
	assert.equal(view.error, undefined); assert.equal(view.channel, 'output'); assert.equal(pointerCapture.active, false);
	assert.ok(inputFocus.admittedTarget === leaf, 'the same native reader remains usable after its document changes');
	assert.equal(inputFocus.admittedTarget!.clipboard!.copy!(), null, 'the native reader is bound to the unselected output, not the removed diagnostic');
	pointerCapture.dispatch({ ...held, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 2);
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.ctrl, false, down));
	assert.equal(view.output.cursorOffset, 0);
	const secondLine = output.indexOf('second');
	for (const [code, offset] of [['ArrowDown', secondLine], ['ArrowRight', secondLine + 1], ['Home', secondLine]] as const) {
		for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
		assert.equal(view.output.cursorOffset, offset, 'native movement consumes the replacement document projection before pane.update');
		assert.ok(inputFocus.admittedTarget === leaf);
	}
	leaf.getCommand('text.find')!.run();
	const query = inputFocus.target!.textInput!;
	assert.equal(query.replaceText(0, query.readText().text.length, 'current output query'), true);
	assert.equal(view.output.query, 'current output query'); assert.equal(retired.query, 'retired query');
	f.publish({ ...view.result.job, state: 'failed', error: ERROR }); await view.result.refresh();
	assert.ok(view.error !== undefined && view.error !== retired); assert.equal(view.channel, 'output');
	assert.ok(inputFocus.target!.textInput === query); assert.equal(view.output.query, 'current output query');
	assert.deepEqual([retired.selectionAnchor, retired.cursorOffset], selection);
	assert.equal(leaf.clipboard!.copy!(), null);
});

test('a focused Find return callback can retire the Build pane and keep a newer foreign native owner', async t => {
	const f = await fixture(t, true, 'replacement output\n'), view = f.input.view, leaf = inputFocus.admittedTarget!;
	leaf.getCommand('text.find')!.run(); assert.ok(inputFocus.admittedTarget !== leaf);
	const foreign = inputFocus.createTarget(); let escaped = 0;
	foreign.bindKeyboard(event => { if (event.code === 'Escape' && event.down) escaped++; });
	foreign.clipboard = { readOnly: true, copy: () => 'the newer native owner' };
	let returned = false;
	const unbind = leaf.onDidFocus(() => {
		unbind(); returned = true; f.pane.clearInput(); foreign.focus();
	});
	t.after(unbind);
	f.publish({ ...view.result.job, state: 'completed', error: undefined }); await view.result.refresh();
	assert.equal(returned, true); assert.equal(f.pane.isEnabled('buildLog.refresh'), false);
	assert.ok(inputFocus.admittedTarget === foreign); assert.equal(leaf.canFocus!(), false);
	assert.equal(leaf.getCommand('text.find')!.isEnabled(), false);
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, down));
	assert.equal(escaped, 1); assert.ok(inputFocus.admittedTarget === foreign);
	f.clipboard.execute('copy', inputFocus.admittedTarget!.clipboard!);
	assert.equal(f.clipboard.text, 'the newer native owner');
});

test('disposing a build pane severs its document binding before later result publication', async t => {
	const f = await fixture(t), reader = f.pane.commandTarget;
	f.pane.dispose();
	assert.equal(reader.canFocus!(), false);
	f.publish({ ...f.input.view.result.job, state: 'completed', error: undefined });
	await f.input.view.result.refresh();
	assert.equal(reader.canFocus!(), false);
	assert.equal(reader.getCommand('text.find')!.isEnabled(), false);
});
