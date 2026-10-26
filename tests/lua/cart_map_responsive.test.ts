import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { ScrollbarController } from '../../ide/editor/ui/scrollbar_controller';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { handleEditorCommandBindings } from '../../ide/input/keyboard/global_bindings';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CartMapPane } from '../../ide/workbench/contrib/cart_maps/editor_pane';
import { projectCartMap, selectCartMapRow } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as colors from '../../ide/common/constants';

const SOURCE = [
	'2:', "  map: ['........................................................................................................................']",
	'  objects:', '  - { type: rock, x: 1, y: 0 } # selected source occurrence',
	'  - { type: rock, x: 2, y: 0 }', '',
].join('\n');

function fixture(t: TestContext, variant: 'tiny' | 'msx', width = 384, source = SOURCE, kind: 'pietious' | 'nemesis' = 'pietious') {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const path = kind === 'pietious' ? 'res/data/castle_map.yaml' : 'res/data/nemesis_s_stage.yaml';
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path }, domain: 0, path, source: { resid: 'map', type: 'data' } }, 'yaml', source);
	const input = new CartMapInput(model, kind);
	projectCartMap(input);
	const previousScrollbarController = editorViewState.scrollbarController;
	editorViewState.scrollbarController = new ScrollbarController({ codeVertical: input.grid.vertical, codeHorizontal: input.grid.horizontal,
		resourceVertical: input.tree.scrollbar, resourceHorizontal: input.grid.horizontal }, () => {}, pointerCapture);
	const bounds = { left: 23, top: 31, right: 23 + width, bottom: 277 }, surfaces = new WorkbenchSurfaceService();
	const surface = surfaces.attach({ role: 'content', captureScope: Symbol('responsive map fixture'), getBounds: () => bounds,
		getClip: () => bounds, isVisible: () => true, draw() {} });
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const pane = new CartMapPane(null!, commands,
		createScenarioTestSourceState([]), surfaces, surface, bounds, inputFocus.workbenchScope);
	pane.setInput(input, bounds); pane.update();
	const layout = (nextWidth = bounds.right - bounds.left, nextVariant: 'tiny' | 'msx' = editorViewState.font.variant) => {
		if (nextVariant !== editorViewState.font.variant) configureFontVariant(new VirtualHeadlessClock(), nextVariant, null);
		bounds.right = bounds.left + nextWidth; pane.layout(bounds); pane.update();
	};
	const press = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
		pane.update();
	};
	let time = 0;
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0) => {
		const snapshot: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y,
			modifiers: KeyModifier.none, spaceDown: false, pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!pointerCapture.dispatch(snapshot, false, ++time)) pane.handlePointer(snapshot, down !== 0, false, time, false);
	};
	t.after(() => {
		pane.clearInput(); inputFocus.setTarget(null); pointerCapture.cancel(); pane.dispose(); surfaces.dispose(); input.dispose(); model.dispose();
		editorViewState.scrollbarController = previousScrollbarController;
	});
	return { model, input, pane, bounds, layout, press, pointer };
}

for (const variant of ['tiny', 'msx'] as const) {
	const minimum = variant === 'tiny' ? 78 : 118;
	test(`Cart Map ${variant} uses measured split minima, offset bounds and a full-width compact client`, t => {
		const f = fixture(t, variant), { input, bounds } = f;
		const threshold = input.layout.splitMinimumWidth;
		assert.ok(threshold > minimum);
		f.layout(threshold - 1);
		assert.equal(input.section, 'outline'); assert.equal(input.layout.mode, 'outline');
		assert.equal(input.tree.layout.contentLeft, bounds.left + 4);
		assert.equal(input.grid.bounds.left, input.grid.bounds.right); assert.equal(input.grid.bounds.top, input.grid.bounds.bottom);
		for (const field of input.fieldBounds) { assert.equal(field.left, field.right); assert.equal(field.top, field.bottom); }
		input.section = 'map'; f.layout(minimum);
		assert.equal(input.layout.mode, 'map');
		assert.equal(input.tree.layout.contentLeft, input.tree.layout.contentRight);
		assert.equal(input.tree.layout.contentTop, input.tree.layout.contentBottom);
		assert.equal(workbenchListRowIndexAtPosition(input.tree, bounds.left + 6, bounds.top + 45), -1);
		assert.equal(input.grid.bounds.left, bounds.left + 4);
		selectCartMapRow(input, 1); f.pane.update();
		const [x, y] = input.fieldBounds;
		assert.equal(x.left, y.left); assert.equal(x.right, y.right); assert.ok(x.bottom <= y.top, 'signed-word fields stack rather than share a narrow row');
		for (const field of input.fieldBounds) assert.ok(field.right - field.left - 6
			>= editorViewState.font.measure('-2147483648') + editorViewState.font.advance(' '), 'a full signed word and caret fit the actual field');
		f.layout(threshold);
		assert.equal(input.layout.mode, 'split'); assert.equal(input.section, 'map');
		assert.ok(input.tree.layout.contentRight <= input.grid.bounds.left);
		assert.ok(input.tree.layout.contentRight - input.tree.layout.contentLeft - input.tree.layout.indentWidth * 2 >= editorViewState.font.advance('M') * 14);
		assert.ok(input.grid.bounds.right - input.grid.bounds.left >= input.grid.cellSize * 8);
		assert.ok(input.grid.bounds.bottom - input.grid.bounds.top >= input.grid.cellSize * 8);
		f.layout(threshold + 1); assert.equal(input.layout.mode, 'split');
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	});

	test(`Cart Map ${variant} Enter/Back preserve sheet and marker identity and exclude hidden focus targets`, t => {
		const f = fixture(t, variant, minimum), { input, pane } = f;
		pane.focus(); const outline = inputFocus.target!;
		assert.equal(input.selected, undefined); assert.ok(input.grid.content);
		assert.equal(inputFocus.getCommand('cartMap.map')!.isEnabled(), true, 'a sheet root does not need an editable marker to open its map');
		f.press('Enter'); const map = inputFocus.target!;
		assert.notEqual(map, outline); assert.equal(input.layout.mode, 'map'); assert.equal(input.section, 'map');
		assert.equal(input.selected, undefined);
		f.press('Escape'); assert.equal(inputFocus.target, outline); assert.equal(input.layout.mode, 'outline');
		selectCartMapRow(input, 1); pane.update(); const selected = input.selected;
		const range = { ...input.selectionRange };
		f.press('Enter'); assert.equal(inputFocus.target, map);
		assert.equal(pane.controls[0].field.focusTarget.parent, map); assert.equal(pane.controls[1].field.focusTarget.parent, map);
		assert.equal(pane.controls[0].field.focusTarget.getCommand('cartMap.outline'), outline.getCommand('cartMap.outline'));
		const visited = new Set();
		for (let index = 0; index < 8; index++) {
			visited.add(inputFocus.target); assert.notEqual(inputFocus.target, outline);
			assert.equal(inputFocus.moveFocus(false), true);
		}
		assert.ok(visited.has(map)); assert.ok(visited.has(pane.controls[0].field.focusTarget)); assert.ok(visited.has(pane.controls[1].field.focusTarget));
		const field = pane.controls[0].field;
		field.focusTarget.focus(); assert.equal(field.replaceText(0, field.text.length, '-'), true);
		inputFocus.executeCommand('cartMap.outline');
		assert.equal(input.layout.mode, 'map'); assert.equal(inputFocus.target, field.focusTarget); assert.equal(field.text, '-');
		f.press('Escape'); assert.equal(inputFocus.target, map); assert.equal(input.layout.mode, 'map');
		f.press('Escape');
		assert.equal(inputFocus.target, outline); assert.equal(input.selected, selected); assert.deepEqual(input.selectionRange, range);
		for (const control of pane.controls) { control.field.focusTarget.focus(); assert.notEqual(inputFocus.target, control.field.focusTarget); }
		for (let index = 0; index < 4; index++) {
			assert.notEqual(inputFocus.target, map); assert.equal(inputFocus.moveFocus(index % 2 !== 0), true);
		}
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
	});

	test(`Cart Map ${variant} presentation changes retain the active coordinate draft and local history`, t => {
		const f = fixture(t, variant), { input, pane, model } = f;
		selectCartMapRow(input, 1); pane.update(); input.section = 'map'; pane.update();
		const control = pane.controls[0]; control.field.focusTarget.focus();
		assert.equal(control.field.replaceText(0, control.field.text.length, '-2147483648'), true);
		const undo = control.field.focusTarget.getCommand('undo')!;
		assert.equal(control.pending, true); assert.equal(undo.isEnabled(), true);
		const roots = [...input.tree.roots], rows = [...input.tree.rows], selected = input.selected, range = { ...input.selectionRange }, version = model.version;
		for (const [width, font] of [[minimum, variant], [384, variant === 'tiny' ? 'msx' : 'tiny'], [minimum, variant], [384, variant]] as const) {
			f.layout(width, font);
			assert.equal(input.section, 'map'); assert.notEqual(input.layout.mode, 'outline');
			assert.equal(inputFocus.target, control.field.focusTarget); assert.equal(control.field.text, '-2147483648');
			assert.equal(control.pending, true); assert.equal(undo.isEnabled(), true);
			assert.equal(input.selected, selected); assert.deepEqual(input.selectionRange, range);
			assert.ok(input.tree.roots.every((root, index) => root === roots[index])); assert.ok(input.tree.rows.every((row, index) => row === rows[index]));
		}
		undo.run(); assert.equal(control.field.text, '1'); assert.equal(control.pending, false);
		assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.version, version); assert.equal(model.canUndo, false);
	});

	test(`Cart Map ${variant} hiding the map retires its scrollbar gesture and hidden field pointer target`, t => {
		const source = `map_rows:\n${Array.from({ length: 40 }, () => `  - "m${' '.repeat(119)}"\n`).join('')}`;
		const f = fixture(t, variant, minimum, source, 'nemesis'), { input, pane } = f;
		selectCartMapRow(input, 1); pane.update(); pane.focus(); f.press('Enter');
		const field = { ...input.fieldBounds[0] }, track = { ...input.grid.horizontal.getTrack() };
		assert.equal(input.grid.horizontal.isVisible(), true);
		f.pointer((track.left + track.right) / 2, (track.top + track.bottom) / 2, PointerButton.Primary, PointerButton.Primary);
		assert.equal(pointerCapture.active, true);
			assert.notEqual(inputFocus.target!.getCommand('cartMap.outline'), undefined, 'the active map client owns its outline action directly');
		inputFocus.executeCommand('cartMap.outline'); pane.update();
		assert.equal(input.layout.mode, 'outline'); assert.equal(pointerCapture.active, false);
		const handle = t.mock.method(pane.controls[0], 'handlePointer');
		f.pointer(field.left + 4, field.top + 2, PointerButton.Primary);
		f.pointer(field.left + 4, field.top + 2, 0, 0, PointerButton.Primary);
		assert.equal(handle.mock.callCount(), 0, 'the old field rectangle cannot receive input after its client is hidden');
		assert.equal(input.grid.horizontal.isVisible(), false); assert.equal(input.grid.vertical.isVisible(), false);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
	});

	test(`Cart Map ${variant} explicitly opening the compact map reveals its wide-selected source marker`, t => {
		const cells = Array<string>(300).fill(' '); cells[257] = 'm';
		const source = `map_rows: ["${cells.join('')}"]\n`;
		const f = fixture(t, variant, 384, source, 'nemesis'), { input, pane, model } = f;
		pane.focus(); f.press('ArrowDown');
		assert.equal(input.layout.mode, 'split'); assert.equal(input.selected!.x, 257);
		const selectedRange = { ...input.selectionRange }, grid = input.grid;
		let left = grid.bounds.left + 257 * grid.cellSize - grid.horizontal.getScroll();
		assert.ok(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right, 'the real tree navigation reveals the marker in the wide map');
		f.layout(minimum); assert.equal(input.layout.mode, 'outline');
		f.press('Enter'); assert.equal(input.layout.mode, 'map');
		left = grid.bounds.left + 257 * grid.cellSize - grid.horizontal.getScroll();
		const top = grid.bounds.top - grid.vertical.getScroll();
		assert.ok(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right,
			'explicit Map navigation reveals the selected source occurrence in the new compact viewport');
		assert.ok(top >= grid.bounds.top && top + grid.cellSize <= grid.bounds.bottom);
		assert.equal(grid.columnAt(left + grid.cellSize / 2), 257); assert.equal(grid.rowAt(top + grid.cellSize / 2), 0);
		assert.deepEqual(input.selectionRange, selectedRange); assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
	});

	test(`Cart Map ${variant} accepted field edits expose document Undo/Redo on the actual grid while local drafts shadow them`, t => {
		const f = fixture(t, variant, minimum), { input, pane, model } = f;
		pane.focus(); f.press('ArrowDown'); f.press('Enter');
		const grid = inputFocus.target!, outline = grid.parent!, field = pane.controls[0].field;
		assert.equal(input.selected!.x, 1);
		field.focusTarget.focus(); assert.equal(field.replaceText(0, field.text.length, '3'), true); f.press('Enter');
		const edited = SOURCE.replace('x: 1', 'x: 3');
		assert.equal(model.buffer.getText(), edited); assert.equal(inputFocus.target, grid); assert.equal(model.canUndo, true);
		const undo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
		assert.equal(handleEditorCommandBindings(undo, undefined, grid), true, 'the physical grid target must own document Undo, not merely alias the outline command context');
		assert.equal(undo.consumed, true); assert.equal(model.buffer.getText(), SOURCE); assert.equal(input.selected!.x, 1);
		assert.equal(grid.getCommand('undo'), outline.getCommand('undo'));
		const redo = new KeyInputEvent('KeyY', KeyModifier.ctrl);
		assert.equal(handleEditorCommandBindings(redo, undefined, grid), true); assert.equal(redo.consumed, true);
		assert.equal(model.buffer.getText(), edited); assert.equal(input.selected!.x, 3); assert.equal(grid.getCommand('redo'), outline.getCommand('redo'));
		field.focusTarget.focus(); assert.equal(field.replaceText(0, field.text.length, '30'), true);
		const version = model.version;
		assert.notEqual(field.focusTarget.getCommand('undo'), grid.getCommand('undo'));
		for (let index = 0; index < 2; index++) {
			const localUndo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
			assert.equal(handleEditorCommandBindings(localUndo, undefined, field.focusTarget), true); assert.equal(localUndo.consumed, true);
			assert.equal(field.text, '3'); assert.equal(model.buffer.getText(), edited); assert.equal(model.version, version);
		}
	});

	test(`Cart Map ${variant} clean responsive updates do not parse or measure retained source and labels`, t => {
		const f = fixture(t, variant, minimum); f.pane.focus(); f.press('Enter'); f.pane.update();
		const roots = [...f.input.tree.roots], rows = [...f.input.tree.rows];
		const reads = t.mock.method(f.model.buffer, 'getText'), advance = t.mock.method(editorViewState.font, 'advance');
		for (let index = 0; index < 1000; index++) f.pane.update();
		assert.equal(reads.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
		assert.ok(f.input.tree.roots.every((root, index) => root === roots[index])); assert.ok(f.input.tree.rows.every((row, index) => row === rows[index]));
	});

	test(`Cart Map ${variant} a zero-height field retires held pointer input without committing or losing its draft`, t => {
		const f = fixture(t, variant, minimum), { input, pane, model } = f;
		selectCartMapRow(input, 1); pane.update(); pane.focus(); f.press('Enter');
		const control = pane.controls[0], field = control.field, bounds = { ...input.fieldBounds[0] }, version = model.version;
		field.focusTarget.focus(); assert.equal(field.replaceText(0, field.text.length, '321'), true);
		f.pointer(bounds.left + 3, bounds.top + 2, PointerButton.Primary, PointerButton.Primary);
		assert.equal(field.pointerSelecting, true); assert.equal(field.canUndo, true); assert.equal(control.pending, true);
		const column = field.cursorColumn, anchor = field.selectionAnchor === null ? null : { ...field.selectionAnchor };
		f.bounds.bottom = f.bounds.top + 12; f.layout();
		assert.equal(input.layout.mode, 'map'); assert.equal(input.fieldBounds[0].top, input.fieldBounds[0].bottom);
		assert.equal(field.pointerSelecting, false, 'the actual field visibility transition cancels input before arranging its empty rectangle');
		assert.equal(inputFocus.target, field.focusTarget, 'retained focus intent does not blur-commit an invisible draft');
		assert.equal(inputFocus.admittedTarget, null);
		const handle = t.mock.method(control, 'handlePointer');
		f.pointer(bounds.right - 3, bounds.top + 2, PointerButton.Primary);
		f.pointer(bounds.right - 3, bounds.top + 2, 0, 0, PointerButton.Primary);
		assert.equal(handle.mock.callCount(), 0); assert.equal(field.cursorColumn, column); assert.deepEqual(field.selectionAnchor, anchor);
		assert.equal(field.text, '321'); assert.equal(field.canUndo, true); assert.equal(control.pending, true);
		f.bounds.bottom = 277; f.layout(); field.focusTarget.focus();
		assert.equal(inputFocus.admittedTarget, field.focusTarget); assert.equal(field.text, '321'); assert.equal(field.canUndo, true);
		assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.version, version); assert.equal(model.canUndo, false);
	});
}

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`Cart Map ${theme}/${variant} status owns real ranges, sheet dimensions and admitted hover without allocating a viewport snapshot`, t => {
		const oldTheme = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme); t.after(() => colors.setIdeThemeVariant(oldTheme));
		const f = fixture(t, variant, variant === 'tiny' ? 78 : 118), overlay = createHostOverlayFixture(384, 288);
		f.pane.focus(); f.press('Enter');
		const statusBounds = { left: 0, top: 276, right: 384, bottom: 288 };
		const draw = () => {
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			f.pane.drawStatusBar(statusBounds, colors.COLOR_STATUS_TEXT); overlay.renderer.endFrame();
			const frame = overlay.queue.consumeOverlayFrame();
			for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
				return (frame.commandRefs[index] as GlyphRenderSubmission).items as string;
			assert.fail('the real status renderer did not queue its text');
		};
		assert.match(draw(), variant === 'tiny' ? /^X0-8 Y0-27 \| MAP 120x1/ : /^X0-10 Y0-21 \| MAP 120x1/);
		assert.equal(f.input.selected, undefined, 'initial orientation must not choose a marker');
		const grid = f.input.grid, x = grid.bounds.left + grid.cellSize * 2 + 1, y = grid.bounds.top + grid.cellSize * 3 + 1;
		pointerHover.beginDispatch(); f.pointer(x, y); pointerHover.endDispatch();
		assert.match(draw(), / @2,3 \| /);
		grid.scrollBy(2.5, 0); assert.match(draw(), / @4,3 \| /, 'stationary pointer coordinates follow a real grid pan');
		const capture = t.mock.method(grid, 'captureView'), read = t.mock.method(f.model.buffer, 'getText'), advance = t.mock.method(editorViewState.font, 'advance');
		for (let frame = 0; frame < 1000; frame++) draw();
		assert.equal(capture.mock.callCount(), 0); assert.equal(read.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
		grid.content = { ...grid.content! }; draw();
		assert.equal(advance.mock.callCount(), 0, 'a source generation with unchanged status values does not remeasure identical text');
		f.layout(variant === 'tiny' ? 118 : 78, variant === 'tiny' ? 'msx' : 'tiny');
		assert.match(draw(), variant === 'tiny' ? / @4,2 \| / : / @5,4 \| /, 'font reflow reprojects the stationary admitted pointer');
		f.layout(variant === 'tiny' ? 78 : 118, variant);
		assert.match(draw(), / @4,3 \| /);
		f.bounds.top += 50; f.layout();
		assert.doesNotMatch(draw(), / @/, 'layout moving the grid away revokes the old physical cell');
		f.bounds.top -= 50; f.layout();
		pointerHover.clear(); assert.doesNotMatch(draw(), / @/, 'surface occlusion retires the actual hover lease');
		pointerHover.beginDispatch(); f.pointer(x, y); pointerHover.endDispatch();
		assert.match(draw(), / @4,3 \| /);
		f.input.section = 'outline'; f.layout(); assert.match(draw(), /^MAP 120x1/); assert.doesNotMatch(draw(), / @|^X/);
		f.input.diagnostic = 'Authored row is source-only.'; assert.equal(draw(), f.input.diagnostic, 'diagnostics retain status priority');
		f.input.diagnostic = ''; assert.equal(draw(), '', 'empty authored diagnostics are not replaced with orientation text');
		f.input.diagnostic = null; f.pane.clearInput(); assert.equal(pointerHover.has(f.pane), false);
	});
}

for (const variant of ['tiny', 'msx'] as const) test(`Cart Map ${variant} intrinsic admission uses retained section and new font before pane arrangement`, t => {
	const f = fixture(t, variant, 700), { input, pane } = f;
	assert.equal(input.layout.mode, 'split');
	input.section = 'outline';
	assert.equal(pane.companionGameMinimumWidth, input.layout.outlineMinimumWidth);
	input.section = 'map';
	assert.equal(pane.companionGameMinimumWidth, input.layout.mapMinimumWidth);
	const arrangedFont = input.layout.font;
	configureFontVariant(new VirtualHeadlessClock(), variant === 'tiny' ? 'msx' : 'tiny', null);
	const width = pane.companionGameMinimumWidth;
	assert.equal(input.layout.font, arrangedFont, 'intrinsic measurement does not pretend that pane arrangement has run');
	assert.equal(input.layout.mode, 'split'); assert.equal(input.section, 'map');
	assert.equal(width, input.layout.mapMinimumWidth);
	assert.ok(width >= input.grid.minimumWidth + 8, 'the selected compact map retains eight complete cells and its lanes');
	const read = t.mock.method(f.model.buffer, 'getText'), advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(pane.companionGameMinimumWidth, width);
	assert.equal(read.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
});
