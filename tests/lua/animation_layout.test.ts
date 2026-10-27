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

const source = "return {duration_frames=100,clock_scale=1,tracks={{kind='value',interpolation='linear',keys={{frame=0,value=1},{frame=100,value=2}}},{kind='event',keys={{frame=50,event='other'}}}}}";

function fixture(t: TestContext) {
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua' };
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(sources.catalog.resolveResource(resource)!, 'lua', source);
	const controller = new AnimationEditorController(sources.catalog, undefined!);
	const input = new AnimationEditorInput(model, model.resource.contextId);
	controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 1); controller.selectProperty(input, 0);
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {});
	const keys = new AnimationKeyControl(parent, controller, controller.authoring); keys.setInput(input);
	t.after(() => { keys.dispose(); input.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null); });
	return { input, model, keys, controller };
}

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
