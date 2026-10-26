import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import * as colors from '../../ide/common/constants';
import type { EditorDiagnostic, PointerSnapshot } from '../../ide/common/models';
import { EditorTextModel, type EditorTextModel as TextModel } from '../../ide/editor/model/text_model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { initializeNavigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';

const source = 'return 1\n'.repeat(20);
function diagnostic(model: TextModel, row = 13, column = 5): EditorDiagnostic {
	return { model, version: model.version, row, startColumn: column, endColumn: column + 1,
		message: 'The same authored error appears in separate retained resources.', severity: 'error' };
}
function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 240) {
	configureFontVariant(variant);
	const controller = new ProblemsPanelController(), surfaces = new WorkbenchSurfaceService(), group = createTestEditorGroup();
	const attachments = t.mock.method(surfaces, 'attach');
	const area = { left: 0, top: 24, right: 384, bottom: 274 }, bounds = { left: 0, top: 160, right: width, bottom: 274 };
	surfaces.attach({ role: 'content', captureScope: Symbol('Workbench background'), getBounds: () => area, getClip: () => area,
		isVisible: () => true, draw: () => api.fill_rect(area.left, area.top, area.right, area.bottom, 0, colors.COLOR_CODE_BACKGROUND) });
	const owner = surfaces.attach({ role: 'content', captureScope: controller.focusTarget.scope.surfaceScope,
		getBounds: () => bounds, getClip: () => area, isVisible: () => controller.isVisible, draw: () => controller.draw(bounds) });
	const commands: EditorCommandRunner = { isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) };
	controller.attach(surfaces, owner, area, commands); controller.show();
	const feedback: WorkbenchSurface = attachments.mock.calls.at(-1)!.result;
	const models = [new EditorTextModel({ location: { kind: 'workspace' as const, path: 'scenes/intro.lua' }, domain: 0, path: 'scenes/intro.lua', source: { type: 'lua', resid: 'intro' } }, 'lua', source),
		new EditorTextModel({ location: { kind: 'workspace' as const, path: 'scenes/cart.lua' }, domain: 1, path: 'scenes/cart.lua', source: { type: 'lua', resid: 'cart' } }, 'lua', source)];
	controller.setDiagnostics(models.map(model => diagnostic(model)), { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	controller.setSelectionIndex(-1);
	const unbind = controller.focusTarget.bindKeyboard(event => controller.handleKeyboard(event, group));
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		controller.prepareLayout(bounds); controller.header.updateFeedback(); controller.updateFeedback(bounds);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
			glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
		return glyphs;
	};
	const press = (code: string) => { inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none)); inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false)); };
	t.after(() => { controller.hide(); controller.detach(); unbind(); inputFocus.setTarget(null); pointerHover.clear(); surfaces.dispose(); group.dispose(); for (const model of models) model.dispose(); });
	return { controller, surfaces, owner, feedback, group, bounds, area, models, paint, press };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} row disclosure anchors outside the actual Problems part instead of covering neighboring cards`, t => {
	const f = fixture(t, variant, 384), parsed = parseLuaChunkWithRecovery('9return 1', 'scenes/intro.lua').syntaxError!;
	f.controller.setDiagnostics(f.models.map(model => ({ ...diagnostic(model), message: parsed.message })),
		{ ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.bounds.top = f.bounds.bottom - f.controller.visibleHeight;
	f.paint(); f.controller.setFocused(true); f.press('End'); f.paint();
	assert.equal(f.controller.getSelectionIndex(), 1); assert.equal(f.feedback.visible, true);
	assert.ok(f.feedback.getBounds().bottom <= f.bounds.top - 2, 'keyboard disclosure leaves the header and both diagnostic cards uncovered');
	f.controller.setFocused(false);
	const layout = f.controller.getCachedLayout(), y = layout.contentTop + f.controller.getItemLayout(0).height + 2;
	const pointer: PointerSnapshot = { valid: true, insideViewport: true, viewportX: 12, viewportY: y,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	f.controller.handlePointer(f.group, pointer, false, false, f.bounds); f.paint();
	assert.equal(f.controller.getHoverIndex(), 1); assert.equal(f.feedback.visible, true);
	assert.ok(f.feedback.getBounds().bottom <= f.bounds.top - 2, 'hover uses the same actual part anchor');
	assert.equal(f.surfaces.hitTest(pointer.viewportX, pointer.viewportY), f.owner);
	f.controller.setFocused(true); f.controller.setSelectionIndex(0); f.controller.onPointerLeave();
	f.controller.handlePointerWheel(f.controller.getItemLayout(0).height / editorViewState.lineHeight, f.bounds); f.paint();
	assert.equal(f.feedback.visible, false, 'an offscreen selected row cannot leave a disclosure visible');
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} diagnostic paint distinguishes actual files and reserves an unambiguous 1-based location line`, t => {
		const before = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme); t.after(() => colors.setIdeThemeVariant(before));
		const f = fixture(t, variant), painted = f.paint(), a = f.controller.getItemLayout(0), b = f.controller.getItemLayout(1);
		assert.equal(a.location, 'intro.lua:14:6'); assert.equal(b.location, 'cart.lua:14:6');
		assert.equal(a.height, (a.lines.length + 1) * editorViewState.lineHeight);
		const location = painted.find(run => run.items === a.location.toUpperCase())!;
		assert.equal(location.y, f.controller.getCachedLayout().contentTop);
		const error = painted.find(run => run.items === 'E')!;
		assert.equal(error.y, location.y + editorViewState.lineHeight, 'the resource location cannot share or cover a message row');
		assert.ok(painted.some(run => run.items === b.location.toUpperCase()));
		assert.equal(location.color, resolveThemeTokenColor(colors.COLOR_PROBLEMS_PANEL_LOCATION));
		assert.equal(f.group.panes.activePane, null, 'disclosing a location never opens a source');
	});
}

test('narrow measured labels preserve line/column and expose full path/message through keyboard and passive hover', t => {
	const f = fixture(t, 'msx', 96), model = f.models[0];
	const long = { ...diagnostic(model), message: 'A deliberately long diagnostic with source details '.repeat(12) };
	f.controller.setDiagnostics([long], { ready: 1, pending: 0, unsupported: 0, failed: 0 }); f.controller.setFocused(true);
	f.press('Home'); const painted = f.paint(), item = f.controller.getItemLayout(0);
	assert.ok(item.location.endsWith(':14:6')); assert.ok(editorViewState.font.measure(item.location) <= f.controller.resolveAvailableWidth(f.bounds));
	assert.equal(item.feedback, `CART 0 / scenes/intro.lua:14:6\n${long.message}`);
	assert.equal(f.controller.focusTarget.clipboard!.copy(), item.feedback, 'copy retains the complete message beyond the visible tooltip height');
	assert.ok(painted.some(run => String(run.items).includes('scenes/intro.lua')));
	assert.equal(f.group.panes.activePane, null);
	f.controller.setFocused(false); f.controller.setSelectionIndex(-1);
	const row = f.controller.getCachedLayout();
	const pointer: PointerSnapshot = { valid: true, insideViewport: true, viewportX: 12, viewportY: row.contentTop + 2,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	f.controller.handlePointer(f.group, pointer, false, false, f.bounds);
	assert.ok(f.paint().some(run => String(run.items).includes('scenes/intro.lua')));
	assert.equal(f.surfaces.hitTest(pointer.viewportX, pointer.viewportY), f.owner, 'full diagnostic feedback never intercepts the row');
	f.controller.onPointerLeave(); assert.equal(f.paint().some(run => String(run.items).includes('scenes/intro.lua')), false);
});

test('an empty owned diagnostic message remains empty while its resource location and copy identity stay available', t => {
	const f = fixture(t), empty = { ...diagnostic(f.models[0]), message: '' };
	f.controller.setDiagnostics([empty], { ready: 1, pending: 0, unsupported: 0, failed: 0 }); f.paint();
	const item = f.controller.getItemLayout(0);
	assert.equal(item.message, ''); assert.deepEqual(item.lines, ['']); assert.equal(item.location, 'intro.lua:14:6');
	assert.equal(f.controller.focusTarget.clipboard!.copy(), 'CART 0 / scenes/intro.lua:14:6\n');
	assert.equal(item.height, editorViewState.lineHeight * 2);
});

test('actual multiline parser diagnostics consume measured visual rows rather than painting into the next resource', t => {
	const f = fixture(t), parsed = parseLuaChunkWithRecovery('9return 1', 'scenes/intro.lua').syntaxError!;
	assert.ok(parsed.message.includes('\n'));
	const first = { ...diagnostic(f.models[0]), message: parsed.message };
	f.controller.setDiagnostics([first, diagnostic(f.models[1])], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.controller.setSelectionIndex(-1); const painted = f.paint(), item = f.controller.getItemLayout(0);
	assert.ok(item.lines.every(line => !line.includes('\n')));
	assert.ok(item.lines.length <= colors.PROBLEMS_PANEL_MAX_WRAP_LINES);
	const next = f.controller.getItemLayout(1), nextPaint = painted.find(run => run.items === next.location.toUpperCase())!;
	assert.equal(nextPaint.y, f.controller.getCachedLayout().contentTop + item.height);
	assert.equal(f.controller.focusTarget.clipboard!.copy(), null);
	f.controller.setSelectionIndex(0); assert.equal(f.controller.focusTarget.clipboard!.copy(), item.feedback);
	assert.ok(item.feedback.endsWith(parsed.message), 'row clipping cannot rewrite parser source/caret context in the copy');
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} default panel height measures whole visible diagnostic cards at the actual root width and stays warm`, t => {
	const f = fixture(t, variant, editorViewState.viewportWidth), parsed = parseLuaChunkWithRecovery('9return 1', 'scenes/intro.lua').syntaxError!;
	f.controller.setDiagnostics(f.models.map(model => ({ ...diagnostic(model), message: parsed.message })),
		{ ready: 2, pending: 0, unsupported: 0, failed: 0 });
	const height = f.controller.visibleHeight;
	const content = f.models.reduce((sum, _model, index) => sum + f.controller.getItemLayout(index,
		editorViewState.viewportWidth - colors.PROBLEMS_PANEL_CONTENT_PADDING_X * 2).height, 0);
	f.bounds.top = f.bounds.bottom - height; const layout = f.controller.prepareLayout(f.bounds);
	assert.equal(layout.visibleHeight, content, 'two bounded parser cards must fit completely in the automatic viewport');
	assert.ok(layout.visibleHeight <= colors.PROBLEMS_PANEL_MAX_VISIBLE_ROWS * editorViewState.lineHeight);
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.controller.visibleHeight, height);
	assert.equal(advance.mock.callCount(), 0, 'height queries reuse actual-width measured row records');
	f.controller.setFixedHeightPx(73); assert.equal(f.controller.visibleHeight, 73, 'manual height remains an independent user choice');
});

test('automatic height stops materializing additional diagnostics at its existing visual-line budget', t => {
	const f = fixture(t), records = Array.from({ length: 100 }, (_, row) => diagnostic(f.models[row & 1], row, 0));
	f.controller.setDiagnostics(records, { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	const layout = t.mock.method(f.controller, 'getItemLayout');
	assert.ok(f.controller.visibleHeight > 0);
	assert.ok(layout.mock.callCount() <= 4, 'location plus message needs at most four cards to fill eight visual lines');
});

test('qualified feedback distinguishes duplicate basenames and retires on replacement, modality, hide and detach', t => {
	const f = fixture(t), duplicate = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'other/intro.lua' }, domain: 1, path: 'other/intro.lua', source: { type: 'lua', resid: 'other' } }, 'lua', source);
	t.after(() => duplicate.dispose());
	f.controller.setDiagnostics([diagnostic(f.models[0]), diagnostic(duplicate)], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.controller.setFocused(true); f.press('Home'); f.paint();
	assert.ok(f.controller.getItemLayout(0).feedback.startsWith('CART 0 / scenes/intro.lua:14:6'));
	f.press('ArrowDown'); f.paint(); assert.ok(f.controller.getItemLayout(1).feedback.startsWith('CART 1 / other/intro.lua:14:6'));
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('modal'), getBounds: () => f.area,
		getClip: () => f.area, isVisible: () => true, draw() {} });
	assert.equal(f.paint().some(run => String(run.items).includes('other/intro.lua')), false); modal.dispose();
	f.controller.setDiagnostics([], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.equal(f.paint().some(run => String(run.items).includes('other/intro.lua')), false);
	f.controller.hide(); assert.equal(f.paint().length, 0); f.controller.detach();
});

test('the coverage disclosure owns feedback while its header is hovered or keyboard-focused', t => {
	const f = fixture(t); f.controller.setFocused(true); f.paint(); f.press('Home');
	assert.ok(f.paint().some(run => String(run.items).includes('scenes/intro.lua')));
	inputFocus.executeCommand('problems.coverage', f.controller.focusTarget);
	const coverage = f.paint();
	assert.ok(coverage.some(run => run.items === 'Diagnostics coverage'));
	assert.equal(coverage.some(run => String(run.items).includes('scenes/intro.lua')), false);
});

test('new row heights govern Home/End/Page and wheel hit geometry without changing diagnostic order or warm caches', t => {
	const f = fixture(t, 'tiny', 120), diagnostics = Array.from({ length: 12 }, (_, row) => diagnostic(f.models[row & 1], row, 0));
	f.controller.setDiagnostics(diagnostics, { ready: 2, pending: 0, unsupported: 0, failed: 0 }); f.controller.setFocused(true);
	f.paint(); f.press('End'); f.paint(); assert.equal(f.controller.getSelectionIndex(), 11); assert.ok(f.controller.getScrollIndex() > 0);
	f.press('Home'); f.paint(); assert.equal(f.controller.getSelectionIndex(), 0); assert.equal(f.controller.getScrollIndex(), 0);
	const item = f.controller.getItemLayout(0), lineHeight = editorViewState.lineHeight;
	f.controller.handlePointerWheel(item.height / lineHeight, f.bounds); assert.equal(f.controller.getScrollIndex(), 1);
	assert.equal(f.controller.getSelectionIndex(), 0, 'wheel navigation is independent of selection');
	const font = editorViewState.font, advance = t.mock.method(font, 'advance'); f.paint(); advance.mock.resetCalls();
	for (let frame = 0; frame < 1000; frame++) { f.controller.prepareLayout(f.bounds); f.controller.updateFeedback(f.bounds); }
	assert.equal(advance.mock.callCount(), 0); assert.equal(f.controller.getItemLayout(0), item);
	assert.equal(f.controller.getDiagnostics(), diagnostics);
});

test('Enter preserves the diagnostic model/version and exact source selection rather than the displayed basename', t => {
	const f = fixture(t); editorTextModelService.clear(); f.group.model.clear();
	t.after(initializeNavigationState(f.group));
	const a = editorTextModelService.retain({ location: { kind: 'workspace' as const, path: 'a/shared.lua' }, domain: 0, path: 'a/shared.lua', source: { type: 'lua', resid: 'a' } }, 'lua', source);
	const b = editorTextModelService.retain({ location: { kind: 'workspace' as const, path: 'b/shared.lua' }, domain: 1, path: 'b/shared.lua', source: { type: 'lua', resid: 'b' } }, 'lua', source);
	t.after(() => { f.group.model.clear(); resetNavigationHistoryState(); editorTextModelService.clear(); });
	f.controller.setDiagnostics([diagnostic(a), diagnostic(b, 7, 3)], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.controller.setFocused(true); f.paint(); f.press('End'); f.press('Enter');
	const opened = f.group.model.activeTab!; assert.equal(opened.kind, 'code_editor');
	if (opened.kind === 'code_editor') { assert.equal(opened.context.model, b); assert.equal(opened.context.view.cursorRow, 7); assert.equal(opened.context.view.cursorColumn, 3); }
	assert.equal(a.buffer.getText(), source); assert.equal(b.buffer.getText(), source);
});

for (const theme of ['light', 'dark']) test(`${theme} diagnostic severity uses its actual surface ink and selected foreground`, t => {
	const previous = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme); t.after(() => colors.setIdeThemeVariant(previous));
	const f = fixture(t), error = diagnostic(f.models[0]), warning = { ...diagnostic(f.models[1]), severity: 'warning' as const };
	f.controller.setDiagnostics([error, warning], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.controller.setSelectionIndex(-1);
	const markers = () => f.paint().filter(run => run.items === 'E' || run.items === 'W');
	assert.deepEqual(markers().map(run => run.color), [colors.COLOR_PROBLEMS_PANEL_ERROR, colors.COLOR_PROBLEMS_PANEL_WARNING].map(resolveThemeTokenColor));
	f.controller.setFocused(true); f.controller.setSelectionIndex(0);
	assert.equal(markers()[0].color, resolveThemeTokenColor(colors.COLOR_SELECTION_TEXT));
	f.controller.setSelectionIndex(1);
	assert.equal(markers()[1].color, resolveThemeTokenColor(colors.COLOR_SELECTION_TEXT));
});

test('pending diagnostic projection retains semantic selection and reading intent without exposing stale actions', t => {
	const f = fixture(t), records = Array.from({ length: 20 }, (_, row) => diagnostic(f.models[row & 1], row, 0));
	f.controller.setDiagnostics(records, { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	f.controller.setSelectionIndex(15); f.controller.setFocused(true); f.controller.prepareLayout(f.bounds);
	f.controller.handlePointerWheel(30, f.bounds); const scroll = f.controller.getScrollIndex(); assert.ok(scroll > 0);
	f.controller.setDiagnostics([], { ready: 0, pending: 2, unsupported: 0, failed: 0 });
	assert.equal(f.controller.selectedDiagnostic, null); assert.equal(f.controller.focusTarget.clipboard!.copy(), null);
	assert.equal(f.controller.handleKeyboardCommand(f.group, 'activate'), false); assert.equal(f.group.panes.activePane, null);
	assert.equal(f.controller.getScrollIndex(), 0, 'an empty projection presents no nonexistent reading row');
	// Freshness changes independently of marker identity; projection order can change too.
	f.models[1].pushEditOperations([{ offset: f.models[1].buffer.length, deleteLength: 0, text: ' ' }]);
	const fresh = records.map(record => ({ ...record, version: record.model.version })).reverse();
	f.controller.setDiagnostics(fresh, { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.ok(f.controller.selectedDiagnostic === fresh[4], 'the fresh semantic marker, not an index or stale object, owns selection');
	assert.equal(f.controller.getScrollIndex(), scroll, 'pending projection cannot erase the owned reading position');
});

test('explicit selection during pending coverage replaces the old semantic marker intent', t => {
	const f = fixture(t), a = diagnostic(f.models[0]), b = diagnostic(f.models[1]);
	f.controller.setDiagnostics([a, b], { ready: 2, pending: 0, unsupported: 0, failed: 0 }); f.controller.setSelectionIndex(1);
	const currentA = { ...a };
	f.controller.setDiagnostics([currentA], { ready: 1, pending: 1, unsupported: 0, failed: 0 });
	assert.equal(f.controller.selectedDiagnostic, null, 'unresolved selection cannot silently jump to another fresh row');
	f.controller.setSelectionIndex(0);
	const fresh = [{ ...b }, { ...a }];
	f.controller.setDiagnostics(fresh, { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.ok(f.controller.selectedDiagnostic === fresh[1], 'a later publication cannot undo the user choosing a different live marker');
});

test('settled marker deletion and explicit reopening retire prior pending selection intent', t => {
	const f = fixture(t), a = diagnostic(f.models[0]), b = diagnostic(f.models[1]);
	f.controller.setDiagnostics([a, b], { ready: 2, pending: 0, unsupported: 0, failed: 0 }); f.controller.setSelectionIndex(1);
	f.controller.setDiagnostics([], { ready: 0, pending: 2, unsupported: 0, failed: 0 });
	f.controller.setDiagnostics([a], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.ok(f.controller.selectedDiagnostic === a, 'settled deletion uses the normal first-error selection policy');
	f.controller.setDiagnostics([b, a], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.ok(f.controller.selectedDiagnostic === a, 'a deleted marker cannot resurrect its retired intent');
	f.controller.setSelectionIndex(0); f.controller.setDiagnostics([], { ready: 0, pending: 2, unsupported: 0, failed: 0 });
	f.controller.hide(); f.controller.show();
	f.controller.setDiagnostics([a, b], { ready: 2, pending: 0, unsupported: 0, failed: 0 });
	assert.ok(f.controller.selectedDiagnostic === a, 'explicit reopening starts a fresh selection instead of reviving pending intent');
});
