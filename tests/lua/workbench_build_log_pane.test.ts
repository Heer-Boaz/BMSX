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

import { inputFocus } from '../../ide/input/focus';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { BuildLogInput } from '../../ide/workbench/contrib/builds/editor_input';
import { BuildLogPane } from '../../ide/workbench/contrib/builds/editor_pane';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';

const ERROR = 'compiler: first\r\n\t' + 'a_real_long_authored_path/'.repeat(15) + ':1:48: unexpected )\n';

async function fixture(t: TestContext, failed = true) {
	configureFontVariant('tiny');
	const job: StudioBuildJob = { request: { requestId: 'actual-request-identity', target: 'cpu_soak', debug: true, optLevel: 0 },
		state: failed ? 'failed' : 'completed', phase: 'Done', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1,
		error: failed ? ERROR : undefined };
	let receipt = job;
	let reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['cpu_soak'], submit: async () => job,
		get: async () => { reads++; return receipt; }, cancel: async () => job, forget() {}, log: async () => '' };
	const input = new BuildLogInput(job, builds), clipboard = new HeadlessClipboard();
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const bounds = { left: 13, top: 21, right: 333, bottom: 241 };
	const surfaces = new WorkbenchSurfaceService();
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('build log pane'), getBounds: () => bounds,
		getClip: () => bounds, isVisible: () => true, draw() {} });
	const pane = new BuildLogPane(clipboard, menu, surfaces, owner, bounds, inputFocus.workbenchScope);
	await input.refresh(); pane.setInput(input, bounds); pane.focus();
	t.after(() => {
		pane.clearInput(); inputFocus.setTarget(null); pane.dispose(); menu.dispose(); input.dispose();
		pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose();
	});
	return { input, pane, clipboard, bounds, menu, reads: () => reads, publish: (job: StudioBuildJob) => { receipt = job; } };
}

test('channel commands retain independent documents and selection through pane changes', async t => {
	const f = await fixture(t), error = f.input.error!;
	assert.equal(f.input.channel, 'error'); assert.equal(f.input.resource, undefined); assert.equal(f.input.isDirty(), false);
	assert.equal(inputFocus.target!.clipboard!.readOnly, true);
	assert.equal(f.pane.isActive('buildLog.error'), true);
	error.select(0, 8); error.setQuery('path'); error.nextMatch(1);
	const selection = [error.selectionAnchor, error.cursorOffset], query = error.query;
	// Exact content is the Copy All contract: preserve producer data and line endings, not UI labels.
	f.pane.execute('buildLog.copyAll'); await Promise.resolve(); assert.equal(f.clipboard.text, ERROR);
	f.pane.execute('buildLog.output'); assert.equal(f.input.document, f.input.output);
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
	assert.equal(f.input.document, error); assert.deepEqual([error.selectionAnchor, error.cursorOffset], selection);
	assert.equal(inputFocus.target!.clipboard!.copy!(), ERROR.slice(error.selectionStart, error.selectionEnd));
});

test('an observed empty document disables copying and has no diagnostic channel', async t => {
	const f = await fixture(t, false);
	assert.equal(f.input.channel, 'output'); assert.equal(f.input.error, undefined);
	assert.equal(f.input.outputText, ''); assert.equal(f.input.document.buffer.length, 0);
	assert.equal(inputFocus.target!.clipboard!.copy!(), null);
	assert.equal(f.input.actions.items.filter(item => item.visible && (item.command === 'buildLog.error' || item.command === 'buildLog.output')).length, 0);
	assert.equal(f.pane.isEnabled('buildLog.error'), false); f.pane.execute('buildLog.error');
	assert.equal(f.input.channel, 'output'); assert.equal(f.pane.isEnabled('buildLog.copyAll'), false);
});

for (const restore of [false, true]) test(`diagnostic publication retires an armed channel overflow before the next pane update${restore ? ' even when the diagnostic reappears' : ''}`, async t => {
	const f = await fixture(t), { input, pane, menu } = f;
	const projection = input.actions.menu!, entries = projection.entries, visible = projection.visibleItems;
	const error = input.actions.items.find(item => item.command === 'buildLog.error')!;
	const output = input.actions.items.find(item => item.command === 'buildLog.output')!;
	const copy = input.actions.items.find(item => item.command === 'buildLog.copyAll')!;
	const errorDocument = input.error, outputDocument = input.output;
	assert.equal(error.visible, true); assert.equal(output.visible, true);
	f.bounds.right = f.bounds.left + 18; pane.layout(f.bounds); pane.update();
	const button = input.actions.overflow!.button;
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
	f.publish({ ...input.job, state: 'completed', error: undefined });
	await input.refresh();
	assert.equal(input.channel, 'output'); assert.equal(pane.isEnabled('buildLog.output'), true);
	if (restore) { f.publish({ ...input.job, state: 'failed', error: ERROR }); await input.refresh(); }
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(execute.mock.callCount(), 0, 'enabled capability cannot admit a channel placement from a retired diagnostic');
	assert.equal(menu.visible, false);
	pane.update();
	assert.equal(error.visible, restore); assert.equal(output.visible, restore);
	assert.equal(copy.visible, true); assert.equal(copy.enabled, false, 'an empty output disables Copy All rather than hiding its placement');
	assert.equal(input.output, outputDocument);
	f.publish({ ...input.job, state: 'failed', error: ERROR }); await input.refresh(); pane.update();
	assert.equal(error.visible, true); assert.equal(output.visible, true);
	assert.equal(input.actions.menu, projection); assert.equal(projection.entries, entries); assert.equal(projection.visibleItems, visible);
	assert.equal(input.actions.items.find(item => item.command === 'buildLog.error'), error);
	assert.equal(input.actions.items.find(item => item.command === 'buildLog.output'), output);
	assert.notEqual(input.error, errorDocument, 'a removed diagnostic document is not a hidden fallback snapshot');
	assert.equal(input.output, outputDocument);
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
