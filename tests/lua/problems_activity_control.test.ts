import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { pointerHover } from '../../ide/input/pointer/hover';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { EditorDiagnostic } from '../../ide/common/models';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { mainWorkspaceActivityHeaderHeight } from '../../ide/workbench/common/main_workspace_activity';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createTestEditorParts } from '../helpers/editor_panes';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 20, top: 80, right: 300, bottom: 180 };
	const scope = new InputFocusScope(Symbol('Problems activity'), inputFocus.workbenchScope);
	const owner = surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {} });
	let accepted = 0;
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => { accepted++; inputFocus.executeCommand(command, target); },
	};
	const controller = new ProblemsPanelController(parts, commands, surfaces, owner, bounds, scope, parts.main.focusTarget);
	editorTextModelService.clear();
	const model = editorTextModelService.retain({ contextLabel: 'Fixture project', sourceFilePath: 'errors.lua',
		location: { kind: 'workspace', path: 'errors.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'errors.lua',
		source: { resid: 'errors', type: 'lua' } }, 'lua', 'return 1\n'.repeat(20));
	const diagnostics: EditorDiagnostic[] = Array.from({ length: 12 }, (_, row) => ({ model, version: model.version,
		row, startColumn: 0, endColumn: 1, severity: 'error', message: 'A source-owned diagnostic with enough detail to wrap at a narrow allocation.' }));
	controller.setDiagnostics(diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	const headerBounds = { ...bounds, bottom: bounds.top + mainWorkspaceActivityHeaderHeight(editorViewState.font) };
	controller.attach(bounds, headerBounds);
	t.after(() => { controller.dispose(); editorTextModelService.clear(); surfaces.dispose(); inputFocus.setTarget(null); });
	return { controller, diagnostics, model, bounds, headerBounds, scope, accepted: () => accepted };
}

test('Problems native detachment preserves exact diagnostic selection and reading through pending publication', t => {
	const f = fixture(t), panel = f.controller;
	panel.setSelectionIndex(10); panel.revealSelection(panel.layoutState, panel.contentWidth);
	const scroll = panel.getScrollIndex(); assert.ok(scroll > 0);
	panel.focus(); const generation = f.scope.contextGeneration;
	panel.detach();
	assert.equal(panel.attached, false); assert.ok(f.scope.contextGeneration > generation);
	assert.equal(panel.focusTarget.focus(), false);
	assert.ok(panel.selectedDiagnostic === f.diagnostics[10]); assert.equal(panel.getScrollIndex(), scroll);
	panel.setDiagnostics([], { ready: 0, pending: 1, unsupported: 0, failed: 0 });
	assert.equal(panel.selectedDiagnostic, undefined);
	const next = f.diagnostics.map(diagnostic => ({ ...diagnostic, version: diagnostic.version + 1 }));
	panel.setDiagnostics(next, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	panel.attach(f.bounds, f.headerBounds);
	assert.ok(panel.selectedDiagnostic === next[10]); assert.equal(panel.getScrollIndex(), scroll);
	assert.equal(f.model.dirty, false);
});

for (const reattachDuringRetirement of [false, true])
	test(`Problems ${reattachDuringRetirement ? 'reentrant' : 'ordinary'} reattachment cannot revive an armed native header action`, t => {
		const f = fixture(t), panel = f.controller, target = panel.header.controls.focusTarget;
		assert.equal(target.focus(), true);
		inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
		let unbind: (() => void) | undefined;
		if (reattachDuringRetirement) unbind = f.scope.onDidRetireContext(() => panel.attach(f.bounds, f.headerBounds));
		panel.detach(); unbind?.();
		if (!reattachDuringRetirement) panel.attach(f.bounds, f.headerBounds);
		assert.equal(panel.attached, true);
		assert.equal(target.focus(), true);
		inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
		assert.equal(f.accepted(), 0);
		inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
		inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
		assert.equal(f.accepted(), 1);
	});

test('Problems intrinsic constraints consume the supplied font and available width, independently of outer viewport geometry', t => {
	const f = fixture(t), panel = f.controller;
	panel.setDiagnostics([f.diagnostics[0]], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	const tiny = new EditorFont('tiny'), msx = new EditorFont('msx');
	const wide = { minimumHeight: 0, preferredHeight: 0 }, narrow = { ...wide }, alternateFont = { ...wide };
	panel.measure(tiny, 800, wide); panel.measure(tiny, 70, narrow); panel.measure(msx, 800, alternateFont);
	// This is the intrinsic sizing algorithm's contract, not incidental UI geometry.
	assert.ok(narrow.preferredHeight > wide.preferredHeight);
	assert.equal(narrow.minimumHeight, wide.minimumHeight);
	assert.ok(alternateFont.minimumHeight > wide.minimumHeight);
	const previous = editorViewState.viewportHeight; t.after(() => { editorViewState.viewportHeight = previous; });
	editorViewState.viewportHeight = 1;
	const constrainedHost = { minimumHeight: 0, preferredHeight: 0 }; panel.measure(tiny, 800, constrainedHost);
	assert.deepEqual(constrainedHost, wide);
	const rows = t.mock.method(panel, 'getItemLayout');
	for (let frame = 0; frame < 100; frame++) panel.measure(tiny, 800, constrainedHost);
	assert.equal(rows.mock.calls.length, 0, 'stable outer allocation does not rescan or remeasure diagnostic rows');
});


test('Problems body hover ends when the physical route moves to a sibling surface', t => {
	const f = fixture(t), panel = f.controller;
	pointerHover.beginDispatch(f.scope.surfaceScope);
	panel.handlePointer({ valid: true, insideViewport: true, viewportX: panel.bounds.left + 10,
		viewportY: panel.layoutState.contentTop + 1, modifiers: KeyModifier.none, spaceDown: false, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 });
	pointerHover.endDispatch();
	assert.equal(panel.getHoverIndex(), 0);
	pointerHover.beginDispatch(Symbol('another real surface')); pointerHover.endDispatch();
	assert.equal(panel.getHoverIndex(), -1);
});


test('Problems Source captures its selected canonical diagnostic without doing source work during availability checks', async t => {
	const f = fixture(t), panel = f.controller;
	panel.setSelectionIndex(7);
	const sourceLookup = t.mock.method(editorTextModelService, 'get');
	for (let frame = 0; frame < 100; frame++) assert.equal(panel.canOpenSource, true);
	assert.equal(sourceLookup.mock.calls.length, 0);
	const request = panel.captureSourceLocation()!;
	assert.equal(sourceLookup.mock.calls.length, 0);
	const location = await request.readLocation();
	assert.ok(location?.model === f.model); assert.equal(location.modelVersion, f.diagnostics[7].version);
	assert.equal(location.selection?.row, 7); assert.equal(location.selection?.startColumn, 0);
});

for (const cause of ['selection', 'detachment', 'publication', 'edit', 'model replacement'] as const)
	test(`Problems captured Source cannot revive after ${cause}`, async t => {
		const f = fixture(t), panel = f.controller;
		panel.setSelectionIndex(7); const request = panel.captureSourceLocation()!;
		switch (cause) {
			case 'selection': panel.setSelectionIndex(8); panel.setSelectionIndex(7); break;
			case 'detachment': panel.detach(); panel.attach(f.bounds, f.headerBounds); break;
			case 'publication':
				panel.setDiagnostics([], { ready: 0, pending: 1, unsupported: 0, failed: 0 });
				panel.setDiagnostics(f.diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 }); break;
			case 'edit': f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]); break;
			case 'model replacement':
				editorTextModelService.clear(); editorTextModelService.retain(f.model.resource, 'lua', f.model.buffer.getText()); break;
		}
		assert.equal(await request.readLocation(), undefined);
	});

test('a Problems attachment admitted by outgoing header blur keeps its new native header input', t => {
	const f = fixture(t), panel = f.controller, target = panel.header.controls.focusTarget;
	assert.equal(target.focus(), true);
	const unbind = target.onDidBlur(() => panel.attach(f.bounds, f.headerBounds));
	panel.detach(); unbind();
	assert.equal(panel.attached, true);
	assert.equal(target.focus(), true);
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
	assert.equal(f.accepted(), 1);
});

test('a Problems press retains the diagnostic hit before native focus reveals a different client position', t => {
	const f = fixture(t), panel = f.controller;
	const y = panel.layoutState.contentTop + panel.getItemLayout(0).height - 1;
	const unbind = panel.focusTarget.onDidFocus(() => panel.layout({ left: f.bounds.left, top: f.bounds.top - 4,
		right: f.bounds.right, bottom: f.bounds.bottom - 4 }, { ...f.headerBounds, top: f.headerBounds.top - 4, bottom: f.headerBounds.bottom - 4 }));
	// The last pixel of the visible first diagnostic moves over the second row after focus scrolls its owner.
	panel.handlePointer({ valid: true, insideViewport: true, viewportX: panel.bounds.left + 10, viewportY: y,
		modifiers: KeyModifier.none, spaceDown: false, pressedButtons: 1, justPressedButtons: 1, justReleasedButtons: 0 });
	unbind();
	assert.ok(panel.selectedDiagnostic === f.diagnostics[0], 'native focus/reveal must not reinterpret the original physical press');
});


test('Problems passive feedback visits only visible rows when the retained selection is far below the reading position', t => {
	const f = fixture(t), panel = f.controller;
	const records = Array.from({ length: 1000 }, (_, index) => ({ ...f.diagnostics[0], row: index % 20, message: 'Diagnostic ' + index }));
	panel.setDiagnostics(records, { ready: 1, pending: 0, unsupported: 0, failed: 0 }); panel.focus();
	panel.handleKeyboardCommand('end');
	panel.handleWheel({ valid: true, insideViewport: true, viewportX: panel.bounds.left + 10, viewportY: panel.layoutState.contentTop + 1,
		modifiers: KeyModifier.none, deltaX: 0, deltaY: -10000 });
	assert.ok(panel.selectedDiagnostic === records[999]); assert.equal(panel.getScrollIndex(), 0);
	const rows = t.mock.method(panel, 'getItemLayout');
	panel.updateFeedback(); panel.updateFeedback();
	// Bound the hot work by the actual viewport's text capacity, not the distance to an offscreen selection.
	const visibleTextRows = ((panel.layoutState.visibleHeight / editorViewState.font.lineHeight) | 0) + 1;
	assert.ok(rows.mock.calls.length <= visibleTextRows * 2);
});

test('a newer explicit Problems selection during native press focus supersedes the captured old hit', t => {
	const f = fixture(t), panel = f.controller;
	panel.setSelectionIndex(0);
	const unbind = panel.focusTarget.onDidFocus(() => { panel.setSelectionIndex(2); panel.setSelectionIndex(0); });
	panel.handlePointer({ valid: true, insideViewport: true, viewportX: panel.bounds.left + 10,
		viewportY: panel.layoutState.contentTop + panel.getItemLayout(0).height + 1,
		modifiers: KeyModifier.none, spaceDown: false, pressedButtons: 1, justPressedButtons: 1, justReleasedButtons: 0 });
	unbind();
	assert.ok(panel.selectedDiagnostic === f.diagnostics[0]);
});
