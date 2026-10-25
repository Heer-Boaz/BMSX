import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKeyFromParts } from '../../ide/common/resource';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { activeCodeEditor } from '../../ide/editor/ui/code_editor_state';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';
import { runtimeErrorState } from '../../ide/editor/contrib/runtime_error/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture, WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { getProblemsPanelBounds } from '../../ide/workbench/contrib/problems/panel/layout';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { closeTab, getActiveTab, openEditorTab, setActiveTab } from '../../ide/workbench/ui/tabs';
import { createCodeEditorInput, retainLuaCodeTabContext } from '../../ide/workbench/ui/code_tab/contexts';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { parseLuaChunk } from './cpu_test_harness';

function fixture(t: TestContext, source = 'local value = 42\nreturn value') {
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'parts.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'parts.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	for (let index = -1; index < 60; index++) {
		const path = index === -1 ? 'parts.lua' : `directory_${index}/child.lua`;
		const text = index < 0 || index >= 20 ? source : '9return 1';
		registerLuaSourceRecord(registry, { resid: path, type: 'lua', src: text, base_src: text,
			source_path: path, normalized_source_path: path, module_path: path,
			update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	}
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry)), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Part lifetime does not request external domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	t.after(async () => {
		problemsPanel.hide(); problemsPanel.setFixedHeightPx(0); inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); editor.update(0);
	const input = getActiveTab()!;
	assert.ok(input.kind === 'code_editor');
	const model = activeCodeEditor.model!, view = activeCodeEditor.view!;
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); editor.update(0);
	};
	assert.equal(editor.textTarget!.replaceText(0, 0, ' '), true);
	const edited = model.buffer.getText(), version = model.version, cycles = host.runtime.machine.scheduler.nowCycles;
	assert.equal(model.canUndo, true);
	const resource = (index: number) => sources.resourceByIdentity.get(resourceIdentityKeyFromParts(-1, `directory_${index}/child.lua`))!;
	return { ide, editor, host, sources, input, model, view, source, edited, version, cycles, key, resource };
}

test('actual inspector and source attachments preserve user-opened Files and Problems reading state', t => {
	const f = fixture(t), files = f.editor.resourcePanel, tree = files.files.tree;
	for (let index = 0; index < 20; index++) resolveLuaTextFileModel(editorTextModelService, f.sources, f.resource(index));
	resolveLuaTextFileModel(editorTextModelService, f.sources, f.resource(50));
	f.editor.diagnostics.computePending();
	assert.ok(problemsPanel.getDiagnostics().length >= 20, 'the real diagnostics producer supplies a scrollable authored-error list');
	files.show(); files.queuePendingSelection(f.resource(40)); files.applyPendingSelection();
	files.navigateFiles('left'); files.navigateFiles('left');
	const selectedFolder = files.files.selectedNode!; assert.equal(selectedFolder.collapsed, true);
	files.setScroll(10); const fileScroll = files.scroll; assert.ok(fileScroll > 0);
	problemsPanel.show();
	// This is explicit user part-size intent, not a pane-position or layout oracle.
	problemsPanel.setFixedHeightPx(73); problemsPanel.setSelectionIndex(14);
	problemsPanel.handlePointerWheel(12, getProblemsPanelBounds()!);
	const selectedDiagnostic = problemsPanel.selectedDiagnostic, diagnostics = problemsPanel.getDiagnostics(), problemScroll = problemsPanel.getScrollIndex();
	assert.ok(problemScroll > 0);
	const unchanged = () => {
		assert.equal(files.isVisible(), true); assert.equal(files.getMode(), 'resources'); assert.ok(files.files.tree === tree);
		assert.ok(files.files.selectedNode === selectedFolder); assert.equal(selectedFolder.collapsed, true); assert.equal(files.scroll, fileScroll);
		assert.equal(problemsPanel.isVisible, true); assert.ok(problemsPanel.getDiagnostics() === diagnostics);
		assert.ok(problemsPanel.selectedDiagnostic === selectedDiagnostic); assert.equal(problemsPanel.getScrollIndex(), problemScroll);
		assert.equal(problemsPanel.visibleHeight, 73, 'switching editors cannot replace the explicitly requested part size');
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	};
	f.editor.commands.execute('gpuDebugger'); f.editor.update(0);
	assert.equal(getActiveTab()!.kind, 'gpu_debugger'); unchanged();
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0);
	assert.ok(getActiveTab() === f.input); assert.ok(activeCodeEditor.model === f.model); assert.ok(activeCodeEditor.view === f.view); unchanged();
	openEditorTab(f.editor.editorPanes, createCodeEditorInput(retainLuaCodeTabContext(f.sources, f.resource(50)))); f.editor.update(0); unchanged();
	assert.ok(getActiveTab()!.resource === f.resource(50));
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0); unchanged();
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canRedo, true);
	files.setFocused(true); files.hide(); assert.equal(files.isVisible(), false); assert.equal(files.isFocused(), false);
	problemsPanel.setFocused(true); inputFocus.moveFocus(false); assert.equal(problemsPanel.header.hasFocus, true); problemsPanel.hide(); assert.equal(problemsPanel.isVisible, false); assert.equal(problemsPanel.header.hasFocus, false);
});

test('actual inspector and source attachments leave Call Hierarchy expansion and reading ownership intact', t => {
	const f = fixture(t), panel = f.editor.resourcePanel;
	const calls = 'local function target() end\n'
		+ Array.from({ length: 20 }, (_, index) => `local function caller_${index}() target() end`).join('\n') + '\n'
		+ Array.from({ length: 40 }, (_, index) => `local function leaf_${index}() caller_0() end`).join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source: calls }]);
	const symbol = frontend.findSymbolsByPosition('calls.lua', 1, 16)!;
	const hierarchy = new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target');
	panel.showCallHierarchy(hierarchy); panel.prepareLayout();
	const firstLevel = panel.itemCount;
	panel.setSelectionIndex(1); panel.expandSelectedCallHierarchyNode();
	assert.ok(panel.itemCount > firstLevel, 'the real semantic producer supplied a nested expanded branch');
	panel.setSelectionIndex(25); panel.setScroll(10);
	const count = panel.itemCount, selected = panel.selectionIndex, scroll = panel.scroll; assert.ok(scroll > 0);
	const unchanged = () => {
		assert.equal(panel.isVisible(), true); assert.equal(panel.getMode(), 'command'); assert.equal(panel.itemCount, count);
		assert.equal(panel.selectionIndex, selected); assert.equal(panel.scroll, scroll);
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	};
	f.editor.commands.execute('gpuDebugger'); f.editor.update(0); unchanged();
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0); unchanged();
	openEditorTab(f.editor.editorPanes, createCodeEditorInput(retainLuaCodeTabContext(f.sources, f.resource(50)))); f.editor.update(0); unchanged();
	panel.setSelectionIndex(1); panel.collapseSelectedCallHierarchyNode();
	assert.equal(panel.itemCount, firstLevel, 'the same retained hierarchy still owns its expanded branch');
	panel.setFocused(true); panel.hide();
	assert.equal(panel.isVisible(), false); assert.equal(panel.isFocused(), false); assert.equal(panel.getMode(), 'resources');
});

test('outgoing source presentation retires without clearing the retained context of another editor', t => {
	const f = fixture(t), context = f.input.context;
	f.editor.showRuntimeError(2, 1, 'Source presentation lifetime');
	const overlay = runtimeErrorState.activeOverlay, stop = runtimeErrorState.executionStopRow;
	assert.ok(overlay !== null); assert.ok(stop !== null);
	editorCaretState.cursorRevealSuspended = true;
	f.editor.commands.execute('gpuDebugger'); f.editor.update(0);
	assert.equal(runtimeErrorState.activeOverlay, null); assert.equal(runtimeErrorState.executionStopRow, null);
	assert.equal(editorCaretState.cursorRevealSuspended, false);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0);
	assert.ok(runtimeErrorState.activeOverlay === overlay); assert.equal(runtimeErrorState.executionStopRow, stop);
	const other = createCodeEditorInput(retainLuaCodeTabContext(f.sources, f.resource(50)));
	openEditorTab(f.editor.editorPanes, other); f.editor.update(0);
	assert.equal(runtimeErrorState.activeOverlay, null); assert.equal(runtimeErrorState.executionStopRow, null);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0);
	assert.ok(activeCodeEditor.model === f.model && activeCodeEditor.view === f.view);
	assert.ok(runtimeErrorState.activeOverlay === overlay); assert.equal(runtimeErrorState.executionStopRow, stop);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.model.canUndo, true); assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('source presentation clears on workbench retirement and last-input close, then restores only its retained source', t => {
	const f = fixture(t), context = f.input.context;
	f.editor.showRuntimeError(2, 1, 'Retained source presentation');
	const overlay = runtimeErrorState.activeOverlay, stop = runtimeErrorState.executionStopRow;
	assert.ok(overlay !== null && stop !== null);
	f.editor.deactivate();
	assert.equal(runtimeErrorState.activeOverlay, null); assert.equal(runtimeErrorState.executionStopRow, null);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	f.editor.activate(); f.editor.update(0);
	assert.ok(activeCodeEditor.model === f.model && getActiveTab() === f.input);
	assert.ok(runtimeErrorState.activeOverlay === overlay); assert.equal(runtimeErrorState.executionStopRow, stop);
	closeTab(f.editor.editorPanes, f.input.id);
	assert.equal(getActiveTab(), null); assert.equal(activeCodeEditor.model, null);
	assert.equal(runtimeErrorState.activeOverlay, null); assert.equal(runtimeErrorState.executionStopRow, null);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('an actual Files scrollbar gesture survives sibling editor activation while a source gesture retires and drains', t => {
	const source = 'local value = 42\n' + 'value = value + 1\n'.repeat(60) + 'return value';
	const f = fixture(t, source), files = f.editor.resourcePanel;
	files.show(); files.queuePendingSelection(f.resource(40)); files.applyPendingSelection();
	f.editor.update(0); files.prepareLayout();
	const thumb = editorViewState.scrollbars.resourceVertical.getThumb()!;
	assert.ok(thumb !== null);
	const x = (thumb.left + thumb.right) / 2, y = (thumb.top + thumb.bottom) / 2;
	// Published thumb bounds are input targets, never a pixel-position oracle.
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	const chrome = pointerCapture.routeScope;
	assert.ok(pointerCapture.active && chrome !== undefined && chrome !== WORKBENCH_POINTER_SCOPE);
	const sourceScroll = f.view.scrollRow, fileScroll = files.scroll;
	f.editor.commands.execute('gpuDebugger'); f.editor.update(0);
	assert.ok(pointerCapture.active && pointerCapture.routeScope === chrome && !pointerCapture.draining);
	setActiveTab(f.editor.editorPanes, f.input.id); f.editor.update(0);
	assert.ok(pointerCapture.active && pointerCapture.routeScope === chrome);
	f.editor.dispatchPointer({ x, y: y + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.ok(files.scroll > fileScroll); assert.equal(f.view.scrollRow, sourceScroll);
	f.editor.dispatchPointer({ x, y: y + 24, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.active, false);
	f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
	f.editor.draw(); f.ide.overlayRenderer.endFrame();
	const codeThumb = editorViewState.scrollbars.codeVertical.getThumb()!;
	assert.ok(codeThumb !== null);
	const codeX = (codeThumb.left + codeThumb.right) / 2, codeY = (codeThumb.top + codeThumb.bottom) / 2;
	f.editor.dispatchPointer({ x: codeX, y: codeY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	assert.ok(pointerCapture.active && pointerCapture.routeScope === WORKBENCH_POINTER_SCOPE);
	const retainedFiles = files.scroll, retainedSource = f.view.scrollRow;
	f.editor.commands.execute('gpuDebugger'); f.editor.update(0);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	f.editor.dispatchPointer({ x, y: y + 48, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 5 });
	assert.equal(files.scroll, retainedFiles); assert.equal(f.view.scrollRow, retainedSource);
	f.editor.dispatchPointer({ x, y: y + 48, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 6 });
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});
