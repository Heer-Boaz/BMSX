import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { semanticSnapshot } from './semantic_test_harness';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationKeyControl } from '../../ide/workbench/contrib/animation/key_control';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { createLuaTableFieldNumberEdits } from '../../ide/language/lua/source_edits';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import type { PointerSnapshot } from '../../ide/common/models';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';

test('key capture preserves grab offset and commits only a physical drop; click, source invalidation and focus loss do not edit', t => {
	const source = "return {duration_ms=1000,tracks={{kind='value',interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100.25,value=1}}}}}";
	const resource = { domain: 0 as const, path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
	input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	input.trackIndex = 0;
	input.keys.bind(input.document.tracks[0], -1, input.document);
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	let commits = 0;
	const control = new AnimationKeyControl(parent, {
		selectKey(input, index) { input.keyIndex = index; input.keys.select(index); },
	}, {
		canMoveKey() { return true; },
		canEditCurveField() { return false; },
		editCurveKey() { throw new Error('not a curve gesture'); },
		moveKey(_input, key, value) {
			commits++;
			model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer, key.source!.file.chunk.locations, key.coordinate!.field, value)!);
		},
	});
	control.setInput(input); control.layout(400, 20, 960, 50);
	const unbind = model.onDidChangeContent(() => input.invalidateProjection());
	t.after(() => { unbind(); control.dispose(); input.dispose(); model.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	const primary = PointerButton.Primary;
	const pointer = (x: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
		viewportX: x, viewportY: 35, valid: true, insideViewport: true,
		pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
	});
	const origin = input.keys.xAt(100.25);
	control.handlePointer(pointer(origin, primary, primary));
	pointerCapture.dispatch(pointer(origin, 0, 0, primary), false, 0);
	assert.equal(commits, 0); assert.equal(model.undo(), null);
	for (const cancel of [() => input.invalidateProjection(), () => parent.focus(), () => pointerCapture.cancel(),
		() => control.layout(399, 20, 960, 50)]) {
		control.handlePointer(pointer(origin, primary, primary));
		pointerCapture.dispatch(pointer(origin + 55, primary), false, 0);
		assert.equal(model.buffer.getText(), source);
		cancel();
		pointerCapture.dispatch(pointer(origin + 55, 0, 0, primary), false, 0);
		assert.equal(commits, 0); assert.equal(input.keys.dragValue, undefined);
		control.layout(400, 20, 960, 50);
	}
	control.handlePointer(pointer(origin, primary, primary));
	pointerCapture.dispatch(pointer(origin + 55, primary), false, 0);
	assert.equal(model.buffer.getText(), source);
	const proposed = input.keys.dragValue;
	pointerCapture.dispatch(pointer(origin + 55, 0, 0, primary), false, 0);
	assert.equal(commits, 1);
	const updated = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(model.buffer.getText(), resource.path)))!;
	assert.equal(updated.tracks[0].keys[1].coordinate!.value, proposed);
	model.undo(); assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'one drop is one history operation');
});

test('frame and clip axes navigate without a scalar track or a document edit', t => {
	const source = "return {frames={'first','second'},subsequences={{start_ms=50,duration_ms=100,sequence={}}}}";
	const resource = { domain: 0 as const, path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
	input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const unexpected = () => { throw new Error('axis navigation does not edit or select a scalar key'); };
	const control = new AnimationKeyControl(parent, { selectKey: unexpected }, {
		canMoveKey: unexpected, moveKey: unexpected, canEditCurveField: unexpected, editCurveKey: unexpected,
	});
	control.setInput(input); control.layout(400, 20, 960, 50);
	t.after(() => { control.dispose(); input.dispose(); model.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	const pointer = (x: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
		viewportX: x, viewportY: 35, valid: true, insideViewport: true,
		pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
	});
	const clock = new VirtualHeadlessClock(), keyboard = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const press = (code: string) => {
		for (const down of [true, false]) {
			keyboard.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
			clock.advance(20); keyboard.pollInput(); inputFocus.handleKeyboard(keyboard.getPlayerInput(1));
		}
	};
	for (const unit of ['frame', 'time_ms'] as const) {
		input.keys.bind(undefined, -1, input.document, unit);
		assert.equal(control.handlePointer(pointer(input.keys.xAt(1), PointerButton.Primary, PointerButton.Primary)), true);
		assert.equal(inputFocus.target, control.focusTarget);
		assert.equal(input.keys.cursor, 1);
		press('End'); assert.equal(input.keys.cursor, input.keys.extentMaximum);
		press('ArrowLeft'); assert.equal(input.keys.cursor, input.keys.extentMaximum - 1);
		press('Home'); assert.equal(input.keys.cursor, input.keys.extentMinimum);
		press('Escape');
		const minimum = input.keys.range.minimum, maximum = input.keys.range.maximum;
		control.handlePointer(pointer(600, PointerButton.Auxiliary, PointerButton.Auxiliary));
		pointerCapture.dispatch(pointer(620, PointerButton.Auxiliary), false, 0);
		assert.ok(input.keys.range.minimum < minimum);
		pointerCapture.dispatch(pointer(640, 0, 0, PointerButton.Auxiliary), false, 0);
		assert.equal(input.keys.range.maximum - input.keys.range.minimum, maximum - minimum);
		assert.equal(pointerCapture.active, false);
		assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
	}
});
