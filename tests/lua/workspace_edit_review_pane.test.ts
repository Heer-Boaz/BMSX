import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { RectBounds } from '../../machine/ts/common/rect';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { WorkspaceEditReviewPane } from '../../ide/workbench/contrib/edit_review/editor_pane';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { parseLuaChunk } from './cpu_test_harness';

function fixture(t: TestContext) {
	const source = `-- retained authoring bytes: λ\n${Array.from({ length: 36 }, (_, i) => `-- captured consumer ${i}`).join('\n')}\nreturn 'before'`;
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'review.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'review.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'review', type: 'lua', src: source, base_src: source,
		source_path: 'review.lua', normalized_source_path: 'review.lua', module_path: 'review',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Review interaction does not request external domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: registry.entrySourcePath })!));
	t.after(async () => { problemsPanel.hide(); problemsPanel.setFixedHeightPx(0); inputFocus.setTarget(null); await editor.shutdown(); host.audio.dispose(); host.input.dispose(); });
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); editor.update(0);
	const sourcePane = editor.editorParts.main.activeGroup.panes.getPane('code_editor') as CodeEditorPane;
	const code = editor.editorParts.main.activeGroup.model.activeTab!, model = sourcePane.code.model!;
	assert.ok(code.kind === 'code_editor');
	const cycles = host.runtime.machine.scheduler.nowCycles;
	const key = (code: string, down = true, modifiers = KeyModifier.none) => editor.dispatchKey(new KeyInputEvent(code, modifiers, false, down));
	const press = (code: string, modifiers = KeyModifier.none) => { key(code, true, modifiers); key(code, false, modifiers); editor.update(0); };
	const pointer = (bounds: Readonly<RectBounds>, held = 0, down = 0, up = 0) => {
		editor.dispatchPointer({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
			buttons: held, pressedButtons: down, releasedButtons: up, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 }); editor.update(0);
	};
	const show = (count = 36, detailCopies = 1) => {
		const context = new WorkspaceSourceContext(editorTextModelService, sources.catalog), text = context.read(model).source;
		const proposal = new WorkspaceEditProposal('Transfer authored behavior', context, { kind: 'edit', edits: new Map([[model,
			{ version: model.version, edits: [{ offset: text.lastIndexOf('before'), deleteLength: 6, text: 'after' }] }]]) });
		const evidence = { summary: 'One written source edit affects these captured consumers.', items: Array.from({ length: count }, (_, i) => ({
			label: `consumer ${i}`, value: 'before -> after', description: `Captured authored consumer ${i}; source remains unchanged until explicit acceptance. `.repeat(detailCopies),
			location: { model, version: model.version, offset: text.indexOf(`-- captured consumer ${i}`) },
		})) };
		const input = new WorkspaceEditReviewInput(proposal, evidence);
		editor.editorParts.main.activeGroup.openEditor(input); editor.update(0); return input;
	};
	return { sourcePane, editor, host, sources, code, model, source, cycles, key, press, pointer, show };
}

test('the retained review tab exposes exact pending bytes and captured Source without acquiring document history', async t => {
	const f = fixture(t), review = f.show(), location = review.evidence.items[17].location;
	assert.equal(f.model.version, 1); assert.equal(f.model.canUndo, false);
	const expected = f.source.replace("return 'before'", "return 'after'");
	let preview = f.source;
	for (const hunk of [...review.proposal.files[0].hunks].reverse()) preview = preview.slice(0, hunk.offset) + hunk.after + preview.slice(hunk.offset + hunk.before.length);
	assert.equal(preview, expected, 'the proposal preview is the exact source edit, not an impact summary');
	f.editor.commands.execute('workspaceEditReview.source');
	const picker = f.editor.editorParts.main.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.model.list.rows.length, review.evidence.items.length);
	picker.model.list.selectionIndex = 17; await picker.accept(); await setImmediate(); f.editor.update(0);
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === f.code && f.sourcePane.code.model === f.model);
	const position = { row: 0, column: 0 }; f.model.buffer.positionAt(location.offset, position);
	assert.equal(f.sourcePane.code.view!.cursorRow, position.row); assert.equal(f.sourcePane.code.view!.cursorColumn, position.column);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.ok(f.editor.editorParts.main.activeGroup.model.tabs.includes(review));
	assert.equal(review.proposal.state, 'pending');
	f.editor.editorParts.main.activeGroup.close(f.code.id); f.editor.editorParts.main.activeGroup.activate(review.id); f.editor.update(0);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review); assert.equal(review.proposal.state, 'pending');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('physical Apply is release-paired, applies one exact working-copy edit, and leaves the review as evidence', async t => {
	const f = fixture(t), review = f.show();
	const apply = review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!;
	assert.equal(apply.visible && !apply.overflowed, true);
	f.pointer(apply.bounds, PointerButton.Primary, PointerButton.Primary);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(review.proposal.state, 'pending');
	f.pointer(review.viewport.bounds, 0, 0, PointerButton.Primary);
	assert.equal(review.proposal.state, 'pending'); assert.equal(f.model.canUndo, false);
	f.pointer(apply.bounds, PointerButton.Primary, PointerButton.Primary);
	f.pointer(apply.bounds, 0, 0, PointerButton.Primary); await setImmediate(); f.editor.update(0);
	assert.equal(f.model.buffer.getText(), f.source.replace("return 'before'", "return 'after'"));
	assert.equal(f.model.version, 2); assert.equal(review.proposal.state, 'applied');
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, f.code); assert.ok(f.editor.editorParts.main.activeGroup.model.tabs.includes(review));
	f.editor.editorParts.main.activeGroup.activate(review.id); f.editor.update(0);
	assert.equal(f.editor.commands.isEnabled('workspaceEditReview.source'), false);
	assert.equal(f.editor.commands.isEnabled('workspaceEditReview.apply'), false);
	f.editor.commands.execute('workspaceEditReview.impacts'); f.editor.update(0);
	assert.ok(review.viewport.scrollTop > 0, 'settled evidence remains readable through its actual navigation command');
	f.editor.editorParts.main.activeGroup.activate(f.code.id); f.editor.update(0); f.press('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.press('KeyZ', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.model.buffer.getText(), f.source.replace("return 'before'", "return 'after'"));
	assert.equal(review.proposal.state, 'applied');
});

test('Source picker admission owns settlement before outgoing focus can publish source', t => {
	const f = fixture(t), review = f.show();
	const detach = inputFocus.target!.onDidBlur(() => {
		detach();
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- published on blur\n' }]);
	});
	f.editor.commands.execute('workspaceEditReview.source'); f.editor.update(0);
	assert.equal(review.proposal.state, 'stale');
	assert.equal(f.editor.editorParts.main.quickInput.visible, false, 'a retired source operation cannot publish captured locations');
	const source = f.model.buffer.getText(), version = f.model.version;
	f.press('Enter');
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review);
});

test('Discard settles retained evidence without editing and closing that tab does not close its canonical working copy', t => {
	const f = fixture(t), review = f.show();
	f.editor.commands.execute('workspaceEditReview.discard'); f.editor.update(0);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review); assert.equal(review.proposal.state, 'discarded');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.equal(f.editor.commands.isEnabled('workspaceEditReview.source'), false);
	assert.equal(f.editor.commands.isEnabled('workspaceEditReview.impacts'), true);
	f.editor.editorParts.main.activeGroup.close(review.id); f.editor.update(0);
	assert.equal(editorTextModelService.get(f.model.identity), f.model);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, f.code);
});

test('source and readonly publication permanently stale the same retained review, never turning captured evidence back into edit authority', t => {
	const f = fixture(t);
	for (const change of ['content', 'readonly'] as const) {
		const review = f.show(), lines = review.lines;
		if (change === 'content') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later generation\n' }]);
		else { const resource = f.model.resource; f.model.refreshResource({ ...resource, source: { ...resource.source!, generated: true } }); f.model.refreshResource(resource); }
		assert.equal(review.proposal.state, 'stale');
		assert.equal(f.editor.commands.isEnabled('workspaceEditReview.apply'), false);
		assert.equal(f.editor.commands.isEnabled('workspaceEditReview.source'), false);
		f.editor.commands.execute('workspaceEditReview.apply');
		assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review); assert.equal(review.lines, lines);
		if (change === 'content') { f.editor.editorParts.main.activeGroup.activate(f.code.id); f.editor.update(0); f.press('KeyZ', KeyModifier.ctrl); }
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(review.proposal.state, 'stale');
		f.editor.editorParts.main.activeGroup.close(review.id); f.editor.update(0);
	}
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} actual Files reflow preserves captured reading intent, source bytes and retained idle projection`, t => {
	const f = fixture(t); editorViewState.font = new EditorFont(variant); f.editor.update(0);
	const review = f.show(); f.editor.commands.execute('workspaceEditReview.impacts'); f.editor.update(0);
	const topRow = review.rows[Math.trunc(review.viewport.scrollTop / review.layout.rowHeight)];
	const line = topRow.line, offset = topRow.start, lines = review.lines;
	f.editor.resourcePanel.show(); f.editor.update(0);
	const panel = f.editor.resourcePanel.getBounds()!;
	const sash = { left: panel.right, right: panel.right, top: panel.top, bottom: panel.bottom };
	f.pointer(sash, PointerButton.Primary, PointerButton.Primary);
	f.pointer({ ...sash, left: (review.layout.left + review.layout.right) / 2, right: (review.layout.left + review.layout.right) / 2 }, 0, 0, PointerButton.Primary);
	assert.equal(review.reading.line, line); assert.equal(review.reading.offset, offset);
	f.editor.resourcePanel.hide(); f.editor.update(0);
	assert.equal(review.reading.line, line); assert.equal(review.reading.offset, offset);
	const rows = review.rows.slice();
	for (let i = 0; i < 20; i++) f.editor.update(0);
	assert.equal(review.lines, lines); assert.deepEqual(review.rows, rows);
	assert.ok(review.rows.every((row, i) => row === rows[i]), 'idle publication reuses the retained row projections');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.version, 1);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});


test('keyboard re-entry reaches visible review actions when the reading body has no presentation', t => {
	const f = fixture(t), review = f.show(), pane = f.editor.editorParts.main.activeGroup.panes.activePane!;
	// Focus admission is the contract: keep the actual title actions presented
	// while the reading body has no client area.
	pane.layout({ left: review.layout.left, top: review.layout.top, right: review.layout.right,
		bottom: review.layout.top + review.layout.rowHeight + 4 }); pane.update(0);
	assert.equal(review.viewport.height, 0);
	assert.ok(review.actionBar.bounds.top < review.actionBar.bounds.bottom);
	inputFocus.setTarget(null); pane.focus();
	assert.notEqual(inputFocus.admittedTarget, null, 'visible title actions remain keyboard reachable');
	const actions = inputFocus.admittedTarget;
	f.key('Tab'); f.key('Tab', false); assert.equal(inputFocus.admittedTarget, actions);
	f.key('Tab', true, KeyModifier.shift); f.key('Tab', false, KeyModifier.shift);
	assert.equal(inputFocus.admittedTarget, actions, 'focus traversal does not enter the hidden reading control');
	f.key('End'); f.key('End', false); f.key('Enter'); f.key('Enter', false);
	assert.equal(review.proposal.state, 'discarded');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('captured Source picker retires on source publication and cannot apply or resurrect authority on dismissal', t => {
	const f = fixture(t), review = f.show();
	f.editor.commands.execute('workspaceEditReview.source');
	assert.equal(f.editor.editorParts.main.quickInput.visible, true);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- subsequent source\n' }]);
	assert.equal(review.proposal.state, 'stale'); assert.equal(f.editor.editorParts.main.quickInput.visible, false);
	f.press('Enter');
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review); assert.equal(review.proposal.state, 'stale');
	assert.equal(f.model.version, 2); assert.equal(f.model.buffer.getText(), '-- subsequent source\n' + f.source);
	f.editor.editorParts.main.activeGroup.activate(f.code.id); f.editor.update(0); f.press('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(review.proposal.state, 'stale');
});

test('source observations precede review focus admission, including reentrant source publication during the outgoing blur', t => {
	const f = fixture(t), origin = inputFocus.admittedTarget!;
	const stop = origin.onDidBlur(() => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- during admission\n' }]));
	const review = f.show(); stop();
	assert.equal(review.proposal.state, 'stale'); assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, review);
	assert.equal(f.editor.commands.isEnabled('workspaceEditReview.apply'), false);
	f.editor.commands.execute('workspaceEditReview.apply');
	assert.equal(f.model.buffer.getText(), '-- during admission\n' + f.source); assert.equal(f.model.version, 2);
});

test('reflow and replacement cancel an armed review action rather than migrating its release to a different proposal', t => {
	const f = fixture(t), first = f.show();
	f.press('Tab'); f.press('Home');
	assert.equal(first.actionBar.items[first.actionBar.focusedIndex].command, 'workspaceEditReview.apply');
	f.key('Enter');
	f.editor.resourcePanel.show(); f.editor.update(0);
	f.key('Enter', false); f.editor.update(0);
	assert.equal(first.proposal.state, 'pending'); assert.equal(f.model.buffer.getText(), f.source);
	f.press('Escape'); f.press('Tab'); f.press('Home'); f.key('Space');
	const second = f.show(); f.key('Space', false); f.editor.update(0);
	assert.equal(first.proposal.state, 'pending'); assert.equal(second.proposal.state, 'pending');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});


test('Impacts retains its immutable destination when the whole review initially fits, then real Files/font reflow makes scrolling necessary', t => {
	const f = fixture(t); editorViewState.font = new EditorFont('tiny'); f.editor.update(0);
	const review = f.show(1, 16);
	const destination = review.lines.find(line => line.part === 'impacts')!;
	// These extents are the reading-state precondition: there is no scrollable
	// pixel position capable of representing the requested logical destination.
	assert.ok(review.viewport.contentHeight <= review.viewport.height);
	assert.equal(review.viewport.scrollTop, 0);
	f.editor.commands.execute('workspaceEditReview.impacts'); f.editor.update(0);
	assert.equal(review.viewport.scrollTop, 0);
	f.editor.resourcePanel.show(); f.editor.update(0);
	const panel = f.editor.resourcePanel.getBounds()!;
	const sash = { left: panel.right, right: panel.right, top: panel.top, bottom: panel.bottom };
	f.pointer(sash, PointerButton.Primary, PointerButton.Primary);
	f.pointer({ ...sash, left: (review.layout.left + review.layout.right) / 2, right: (review.layout.left + review.layout.right) / 2 }, 0, 0, PointerButton.Primary);
	editorViewState.font = new EditorFont('msx'); f.editor.update(0);
	assert.ok(review.viewport.contentHeight > review.viewport.height);
	const first = review.rows[Math.trunc(review.viewport.scrollTop / review.layout.rowHeight)];
	assert.ok(first.line === destination, 'reflow must reveal the requested immutable Impacts line, not the file header');
	assert.equal(first.start, destination.sourceOffset);
	assert.equal(review.reading.line, destination);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});


test('an initially covered review retains an Impacts command destination before any row projection exists', t => {
	const f = fixture(t);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	const review = f.show(1, 16), pane = f.editor.editorParts.main.activeGroup.panes.activePane!;
	assert.ok(pane instanceof WorkspaceEditReviewPane);
	assert.equal(review.rows.length, 0); assert.equal(review.viewport.height, 0);
	const destination = review.lines.find(line => line.part === 'impacts')!;
	// Invoke the pane's actual command contribution before layout can produce
	// a pixel destination. This is a logical command, not hidden native input.
	pane.execute('workspaceEditReview.impacts');
	editorViewState.font = new EditorFont('msx'); f.editor.updateViewport({ width: 192, height: 288 });
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(review.viewport.contentHeight > review.viewport.height);
	const first = review.rows[Math.trunc(review.viewport.scrollTop / review.layout.rowHeight)];
	assert.ok(first.line === destination, 'first publication must reveal the retained immutable destination');
	assert.equal(first.start, destination.sourceOffset);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});
