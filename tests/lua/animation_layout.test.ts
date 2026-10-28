import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationKeyControl } from '../../ide/workbench/contrib/animation/key_control';
import { layoutAnimationEditor, measureAnimationEditor } from '../../ide/workbench/contrib/animation/layout';
import { inputFocus } from '../../ide/input/focus';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { drawAnimationEditor } from '../../ide/workbench/contrib/animation/render';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { uppercaseOutsideStrings } from '../../ide/common/text';
import { createActualSourcePanes } from '../helpers/source_panes';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';

const source = "return {duration_frames=100,clock_scale=1,tracks={{kind='value',interpolation='linear',keys={{frame=0,value=1},{frame=100,value=2}}},{kind='event',keys={{frame=50,event='other'}}}}}";

function fixture(t: TestContext, text = source) {
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua' };
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, text)]);
	const model = editorTextModelService.retain(sources.catalog.resolveResource(resource)!, 'lua', text);
	const controller = new AnimationEditorController(sources.catalog);
	const input = new AnimationEditorInput(model, model.resource.contextId);
	controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 1); controller.selectProperty(input, 0);
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {});
	const keys = new AnimationKeyControl(parent, controller, controller.authoring); keys.setInput(input);
	t.after(() => { keys.dispose(); input.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null); });
	return { input, model, keys, controller };
}

for (const variant of ['tiny', 'msx'] as const) for (const direction of ['right', 'down'] as const)
test(`${variant} Animation publishes its compact constraints to a real ${direction} Source split`, t => {
	const f = createActualSourcePanes(t, false, [['animation.lua', source]]);
	f.editor.setFontVariant(variant);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const model = f.ide.models.retain(resource, 'lua', source), input = new AnimationEditorInput(model, resource.contextId);
	f.editor.animations.refresh(input); f.editor.animations.selectTrack(input, 1); f.editor.animations.selectKey(input, 0);
	f.firstGroup.openEditor(input);
	const sibling = f.firstPart.splitGroup(f.firstGroup, direction);
	sibling.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.firstInput.workingCopy.resource));
	f.update(); f.firstGroup.focus();
	const subject = input.keySelection, split = f.firstPart.arrangement.splits[0].split;
	split.moveTo(split.start); f.update();
	const measured = measureAnimationEditor(editorViewState.font);
	// These are the contribution's hard layout constraints, not a UI geometry snapshot.
	assert.ok(input.layout.bounds.right - input.layout.bounds.left >= measured.compactWidth);
	assert.ok(input.layout.bounds.bottom - input.layout.bounds.top >= measured.compactHeight);
	f.firstBounds.right = f.firstBounds.left + measured.compactWidth - 1;
	f.firstBounds.bottom = f.firstBounds.top + measured.compactHeight - 1;
	f.update();
	assert.ok(f.firstPart.arrangement.contentWidth > f.firstPart.arrangement.bounds.right - f.firstPart.arrangement.bounds.left);
	assert.ok(f.firstPart.arrangement.contentHeight > f.firstPart.arrangement.bounds.bottom - f.firstPart.arrangement.bounds.top);
	assert.ok(input.layout.bounds.right - input.layout.bounds.left >= measured.compactWidth);
	assert.ok(input.layout.bounds.bottom - input.layout.bounds.top >= measured.compactHeight);
	const details = input.clientBar.items.find(item => item.command === 'animation.details')!;
	const x = (details.bounds.left + details.bounds.right) / 2, y = (details.bounds.top + details.bounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update();
	assert.ok(input.activeClient === 'details' && input.layout.detailsVisible);
	assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane!.commandTarget);
	assert.ok(input.keySelection === subject);
	assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
});

test('Animation renders decoded semantic track and clip captions without recasing their identifier contents or authored source', t => {
	const text = [
		'local apply_mix = function() end',
		'return { duration_ms=100, tracks={',
		' { kind="value", name="Capt\'n `One", keys={{time_ms=0,value=0},{time_ms=100,value=1}} },',
		' { kind="value", name=[=[MiXeD "Two"]=], keys={} },',
		' { kind="value", binding="PoseMiX", path={"OffsetX"}, keys={} },',
		' { kind="value", path={"BodyMiX","Visible"}, keys={} },',
		' { kind="value", name="", keys={} },',
		' { kind="value", apply=apply_mix, keys={} },',
		' { kind="event", keys={} },',
		'}, subsequences={',
		' { id="ClipMiX", sequence={duration_ms=100}, start_time_ms=0, duration_ms=100 },',
		' { id="", sequence={duration_ms=100}, start_time_ms=0, duration_ms=100 },',
		' { sequence={duration_ms=100}, start_time_ms=0, duration_ms=100 },',
		'}, frames={"FrameMiX"} }',
	].join('\n');
	const { input, model, keys } = fixture(t, text), document = input.document!, version = model.version;
	assert.deepEqual(document.tracks.slice(0, 6).map(track => track.label), ["Capt'n `One", 'MiXeD "Two"', 'PoseMiX.OffsetX', 'BodyMiX.Visible', '', 'apply_mix']);
	assert.deepEqual(document.clips.map(clip => clip.preserveCase), [true, true, false], 'empty clip IDs remain semantic strings; generated clip captions remain UI text');
	assert.deepEqual(input.tracks.rows.map(row => row.preserveCase), [false, true, true, true, true, true, false, false, true, true, false, false]);
	const previousFont = editorViewState.font; t.after(() => { editorViewState.font = previousFont; });
	const overlay = createHostOverlayFixture(800, 1000), rendered: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', value => { rendered.push(value); });
	const bounds = { left: 0, top: 0, right: 800, bottom: 1000 };
	for (const variant of ['tiny', 'msx'] as const) {
		editorViewState.font = new EditorFont(variant);
		layoutAnimationEditor(input, bounds, keys); input.overview.update(input);
		assert.ok(input.tracks.layout.visibleRowCount >= input.tracks.rows.length, 'the render contract exercises every actual source and UI row');
		rendered.length = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawAnimationEditor(input, bounds, false); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		for (const row of input.tracks.rows) {
			assert.equal(row.text, row.label, 'the test provides enough layout width to observe the exact semantic bytes');
			if (row.text === '') continue;
			const expected = row.preserveCase ? row.text : uppercaseOutsideStrings(row.text);
			assert.ok(rendered.includes(expected), `${variant}: the text producer preserves semantic identifiers while retaining existing expression and UI formatting`);
		}
		assert.equal(model.version, version); assert.equal(model.buffer.getText(), text);
		assert.ok(input.document === document, 'caption presentation does not rebuild or replace the authored source projection');
	}
});

test('animation composes measured child minima on both axes instead of squeezing every client', t => {
	const { input, keys } = fixture(t);
	const previousFont = editorViewState.font;
	t.after(() => { editorViewState.font = previousFont; });
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new EditorFont(variant); editorViewState.font = font;
		const measured = measureAnimationEditor(font);
		assert.equal(measureAnimationEditor(font), measured, 'unchanged font reuses the measured constraints');
		const bounds = { left: 20, top: 30, right: 20 + measured.expandedWidth, bottom: 30 + measured.expandedHeight };
		layoutAnimationEditor(input, bounds, keys);
		assert.equal(input.layout.mode, 'expanded');
		assert.equal(input.clientBar.bounds.top, input.actionBar.bounds.top, 'both real action groups share one header row');
		assert.ok(input.actionBar.bounds.left > input.clientBar.bounds.right, 'the authoring group consumes only the remaining header extent');
		assert.equal(input.layout.tracksVisible && input.layout.keysVisible && input.layout.detailsVisible, true);
		// Geometry is this owner's contract: composing the minimum must actually grant each child its minimum.
		assert.ok(input.tracks.layout.contentRight - input.tracks.layout.contentLeft >= measured.tracksWidth);
		assert.ok(input.details.layout.contentRight - input.details.layout.contentLeft >= measured.detailsWidth);
		assert.ok(input.keys.range.bounds.right - input.keys.range.bounds.left >= measured.keysWidth);
		assert.ok(input.keys.curve.bounds.bottom - input.keys.curve.bounds.top >= measured.curveHeight);
		for (const reduced of [{ ...bounds, right: bounds.right - 1 }, { ...bounds, bottom: bounds.bottom - 1 }]) {
			layoutAnimationEditor(input, reduced, keys);
			assert.equal(input.layout.mode, 'compact');
			assert.equal(input.layout.tracksVisible, true);
			assert.equal(input.layout.keysVisible || input.layout.detailsVisible, false);
		}
	}
});

test('the compact header keeps client navigation and More reachable while real root property names remain readable', t => {
	const { input, keys, controller } = fixture(t);
	const previousFont = editorViewState.font;
	t.after(() => { editorViewState.font = previousFont; });
	controller.selectTrack(input, 0); input.activeClient = 'details';
	for (const variant of ['tiny', 'msx'] as const) {
		editorViewState.font = new EditorFont(variant);
		const measured = measureAnimationEditor(editorViewState.font);
		layoutAnimationEditor(input, { left: 0, top: 0, right: measured.compactWidth, bottom: measured.compactHeight }, keys);
		assert.equal(input.clientBar.bounds.top, input.actionBar.bounds.top);
		assert.equal(input.actionBar.overflow!.button.visible, true);
		assert.ok(input.actionBar.bounds.left > input.clientBar.bounds.right);
		assert.ok(input.actionBar.bounds.right <= measured.compactWidth);
		assert.equal(input.actionBar.items[0].command, 'animation.addKey', 'key insertion is the first eligible authoring action');
		// This text-layout contract comes from actual authored property names, not a UI workflow label oracle.
		for (const label of ['duration_frames', 'clock_scale']) {
			const property = input.details.rows.find(row => row.element.label === label)!.element;
			assert.equal(property.displayLabel, label, `${variant}: the declared name budget must not truncate this real root field`);
		}
	}
});

test('compact clients retain one source subject, viewport and requested sash placement through relayout', t => {
	const { input, model, keys } = fixture(t);
	const previousFont = editorViewState.font;
	t.after(() => { editorViewState.font = previousFont; });
	input.keys.setView(20, 80); input.keys.setCursor(40);
	const document = input.document, track = input.trackSelection, key = input.keySelection, detail = input.detailSelection;
	let invalidations = 0; const unbind = input.onDidInvalidateProjection(() => invalidations++); t.after(unbind);
	for (const variant of ['tiny', 'msx'] as const) {
		editorViewState.font = new EditorFont(variant);
		const measured = measureAnimationEditor(editorViewState.font);
		const wide = { left: 0, top: 0, right: measured.expandedWidth * 2, bottom: measured.expandedHeight * 2 };
		layoutAnimationEditor(input, wide, keys);
		input.columnSplit.resize(0.45); input.rowSplit.resize(0.4);
		const column = input.columnSplit.ratio, row = input.rowSplit.ratio;
		for (const client of ['tracks', 'keys', 'details'] as const) {
			input.activeClient = client;
			layoutAnimationEditor(input, { ...wide, right: measured.compactWidth, bottom: measured.compactHeight }, keys);
			assert.equal(input.layout.mode, 'compact');
			assert.equal(input.layout.tracksVisible, client === 'tracks');
			assert.equal(input.layout.keysVisible, client === 'keys');
			assert.equal(input.layout.detailsVisible, client === 'details');
			assert.equal(input.columnSplit.ratio, column); assert.equal(input.rowSplit.ratio, row);
			assert.equal(input.document, document); assert.equal(input.trackSelection, track);
			assert.equal(input.keySelection, key); assert.equal(input.detailSelection, detail);
			assert.equal(input.keys.range.minimum, 20); assert.equal(input.keys.range.maximum, 80); assert.equal(input.keys.cursor, 40);
			assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
		}
		layoutAnimationEditor(input, wide, keys);
		assert.equal(input.layout.mode, 'expanded');
		assert.equal(input.columnSplit.ratio, column); assert.equal(input.rowSplit.ratio, row);
	}
	assert.equal(invalidations, 0, 'presentation never rebuilds the source projection');
});
