import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { KeyInputEvent } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationKeyControl } from '../../ide/workbench/contrib/animation/key_control';
import { AnimationAuthoring } from '../../ide/workbench/contrib/animation/authoring';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { createLuaTableFieldNumberEdits } from '../../ide/language/lua/source_edits';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../ide/common/models';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

test('a key beneath a coincident tangent endpoint owns the pointer gesture', t => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='cubic',keys={{time_ms=0,value=0,leave_tangent=0},{time_ms=32,value=0,arrive_tangent=0,leave_tangent=0},{time_ms=100,value=0,arrive_tangent=0}}}}}";
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	input.trackIndex = 0;
	input.keys.bind(input.document.tracks[0], 0, input.document);
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!);
	const control = new AnimationKeyControl(parent, { selectKey(input, index) { input.keyIndex = index; input.keys.select(index); } }, authoring);
	control.setInput(input); control.layout(0, 0, 106, 20); input.keys.curve.layout(0, 30, 106, 142); input.keys.curve.update(input.keys);
	t.after(() => { control.dispose(); input.dispose(); model.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	const x = input.keys.xAt(32), y = input.keys.curve.yAt(0);
	assert.deepEqual(input.keys.curve.leaveHandle.slice(2), [x, y]);
	assert.equal(input.keys.curve.keyAt(input.keys, x, y), 1);
	const pointer: PointerSnapshot = { viewportX: x, viewportY: y, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	control.handlePointer({ ...pointer, pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary });
	assert.equal(input.keyIndex, 1);
	assert.equal(pointerCapture.active, false, 'secondary picking must never start the primary key/tangent edit gesture');
	assert.equal(inputFocus.target, parent, 'the popup owner admits focus only after its invalidation subscription exists');
	input.keys.select(0); input.keys.curve.update(input.keys);
	control.handlePointer(pointer);
	assert.equal(input.keys.selected, 1);
	pointerCapture.dispatch({ ...pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 0);
	assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
});

test('key capture preserves grab offset and commits only a physical drop; click, source invalidation and focus loss do not edit', t => {
	const source = "return {duration_ms=1000,tracks={{kind='value',interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100.25,value=1}}}}}";
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
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
	const updated = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(model.buffer.getText(), resource)], [])))!;
	assert.equal(updated.tracks[0].keys[1].coordinate!.value, proposed);
	model.undo(); assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'one drop is one history operation');
});

test('frame and clip axes navigate without a scalar track or a document edit', t => {
	const source = "return {frames={'first','second'},subsequences={{start_ms=50,duration_ms=100,sequence={}}}}";
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
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
			clock.advance(20); keyboard.pollInput(); inputFocus.handleKeyboard(new KeyInputEvent(code, keyboard.getPlayerInput(1).modifiers, false, down));
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

test('tangent direction uses both pointer axes and commits one native slope without moving its key', t => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='cubic',path={'x'},keys={{time_ms=0,value=0,arrive_tangent=0,leave_tangent=2},{time_ms=100,value=100,arrive_tangent=2,leave_tangent=0}}}}}";
	for (const field of ['leave', 'arrive'] as const) {
		const resource = { contextLabel: 'Fixture project', sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua', source: { type: 'lua' as const, resid: 'animation' } };
		const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
		input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		input.trackIndex = 0;
		const keyIndex = field === 'leave' ? 0 : 1;
		input.keys.bind(input.document.tracks[0], keyIndex, input.document);
		const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!);
		const control = new AnimationKeyControl(parent, { selectKey(input, index) { input.keyIndex = index; input.keys.select(index); } }, authoring);
		control.setInput(input); control.layout(0, 0, 806, 20);
		input.keys.curve.layout(0, 30, 806, 230); input.keys.curve.update(input.keys);
		const unbind = model.onDidChangeContent(() => input.invalidateProjection());
		t.after(() => { unbind(); control.dispose(); input.dispose(); model.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
		const handle = field === 'leave' ? input.keys.curve.leaveHandle : input.keys.curve.arriveHandle;
		const x = handle[2] + 1, y = handle[3] + 1, delta = handle[2] - handle[0];
		const primary = PointerButton.Primary;
		const pointer = (x: number, held = 0, down = 0, up = 0): PointerSnapshot => ({ viewportX: x, viewportY: y,
			valid: true, insideViewport: true, pressedButtons: held, justPressedButtons: down, justReleasedButtons: up });
		control.handlePointer(pointer(x, primary, primary));
		pointerCapture.dispatch(pointer(x, 0, 0, primary), false, 0);
		assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null, 'a click does not quantize a native slope');
		control.handlePointer(pointer(x, primary, primary));
		pointerCapture.dispatch(pointer(x + delta, primary), false, 0);
		assert.ok(Math.abs(input.keys.curve.previewValue - 1) < 1e-12, 'a horizontal drag rotates the handle instead of doing nothing');
		assert.equal(input.keys.dragValue, undefined, 'slope editing does not reorder the presentation index');
		assert.equal(model.buffer.getText(), source);
		pointerCapture.dispatch(pointer(x + delta, 0, 0, primary), false, 0);
		const changed = model.buffer.getText();
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(changed, resource)], [])))!;
		assert.ok(Math.abs(document.tracks[0].keys[keyIndex][field]!.value! - 1) < 1e-12);
		assert.equal(document.tracks[0].keys[keyIndex].coordinate!.value, keyIndex === 0 ? 0 : 100);
		for (const optLevel of [0, 3] as const) {
			const expected = field === 'leave' ? 20.3125 : 39.0625;
			const { cpu } = createCartlibProgramHarness(`local component=require('cartlib/timeline/timeline_component'); local owner={x=-1}
				local timelines=component.new({parent=owner}); timelines:define('curve',require('animation')); timelines:play('curve')
				timelines:seek_time('curve',25); local delta=owner.x-${expected}; assert(delta>-1e-12 and delta<1e-12)
			`, { optLevel, modules: [{ path: 'animation', source: changed }] });
			assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		}
		model.undo(); assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
		model.redo(); assert.equal(model.buffer.getText(), changed);
		control.clearInput();
	}
});
