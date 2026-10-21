import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { GteCommandSnapshot, RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { GteDebuggerInput } from '../../ide/workbench/contrib/gte_debugger/editor_input';
import { GteCommandProjection, GteDebugPresentation } from '../../ide/workbench/contrib/gte_debugger/presentation';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

const PROGRAM = `
local data<const>: *word = 0x08010244
local control<const>: *word = 0x080102c4
local command<const>: *word = 0x08010344
control[0] = 0x1000
control[2] = 0x1000
control[4] = 0x1000
control[24] = 128 << 16
control[25] = 96 << 16
control[26] = 256
function issue()
 data[0] = 0xffc0ffc0
 data[1] = 512
 data[2] = 0xffc00040
 data[3] = 512
 data[4] = 0x00400000
 data[5] = 512
 *command = 0x00080030
 *command = 0x00000006
 data[0] = 4096
 data[1] = 0
 *command = 0x0008043f
end
issue()
return true`;

function fixture() {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources, 3);
	const input = new GteDebuggerInput(history);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const issue = () => {
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure, []);
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	};
	return { runtime, history, input, issue };
}

test('GTE input follows by owned copy, pins across ring reuse and distinguishes clear from generation changes', () => {
	const { history, input, issue } = fixture();
	input.update();
	assert.equal(input.following, true);
	assert.equal(input.selected.sequence, 2);
	input.select(0);
	const owned = input.selected;
	assert.equal(owned.beforeData[0], 0xffc0ffc0);
	issue(); input.update();
	assert.equal(history.firstSequence, 3);
	assert.equal(input.selected, owned);
	assert.equal(owned.sequence, 0);
	assert.equal(owned.beforeData[0], 0xffc0ffc0);
	history.clear(); input.update();
	assert.equal(owned.sequence, 0, 'a pinned detached observation survives source/history retirement');
	input.following = true;
	issue(); input.update();
	assert.equal(owned.sequence, 8);
	history.clear(); input.update();
	assert.equal(owned.sequence, -1, 'following does not present prior-generation evidence as current');
	issue(); input.update(); input.selectedPoint = 2; input.clear(); input.update();
	assert.equal(input.selected.sequence, -1);
	assert.equal(input.selectedPoint, 0);
	assert.equal(input.projection.rows.length, 0);
	const second = new GteDebuggerInput(history);
	second.dispose();
	assert.equal(history.observing, true, 'disposing a duplicate input cannot end the retained input lease');
	input.dispose();
	assert.equal(history.observing, false);
});

test('GTE projection incrementally filters metadata and does not retain reused slots', () => {
	const { history, input, issue } = fixture(), projection = new GteCommandProjection();
	projection.update(history, 'RTPT');
	assert.deepEqual(projection.rows, [0]);
	assert.equal(projection.update(history, 'RTPT'), false);
	issue(); projection.update(history, 'RTPT');
	assert.deepEqual(projection.rows, [3]);
	projection.update(history, 'NCLIP');
	assert.deepEqual(projection.rows, [4]);
	input.dispose();
});

test('GTE visual facts use actual command operands, not later normal vectors or fabricated stages', () => {
	const { history, input } = fixture(), view = new GteDebugPresentation();
	const projection = history.snapshot(0), winding = history.snapshot(1), lighting = history.snapshot(2);
	view.update(projection, 1, 'input');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[-64, -64], [64, -64], [0, 64]]);
	assert.match(view.points[0].value, /512/);
	assert.equal(view.properties.length, 0, 'raw details are not formatted while following');
	view.update(projection, 1, 'projected');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[96, 64], [160, 64], [128, 128]]);
	view.update(winding, 1, 'auto');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[96, 64], [160, 64], [128, 128]]);
	assert.match(view.explanation, /4096/);
	view.update(lighting, 1, 'input');
	assert.equal(view.points[0].x, 4096);
	assert.equal(projection.beforeData[0], 0xffc0ffc0);
	for (const command of [0x12, 0x11, 0x3d, 0x3e, 0x2a]) {
		const record = new GteCommandSnapshot(); record.sequence = 4; record.commandWord = command;
		view.update(record, 1, 'input');
		assert.equal(view.points.length, 0, `${command.toString(16)} must not pretend that V0 is its input`);
	}
	const replacement = new GteCommandSnapshot(); replacement.sequence = 9; replacement.commandWord = 0x10;
	replacement.afterData[22] = 0x344b519e; replacement.afterControl[31] = 0x00400000;
	view.update(replacement, 1, 'auto');
	assert.equal(view.colors[0].word, 0x344b519e);
	assert.equal(view.colors[0].argb, 0xff9e514b);
	assert.match(view.flags, /IR3 saturation/);
	assert.doesNotMatch(view.flags, /ERROR/);
	const empty = new GteCommandSnapshot(); view.update(empty, 1, 'auto');
	assert.equal(view.heading, ''); assert.equal(view.summary, ''); assert.equal(view.flags, ''); assert.equal(view.explanation, '');
	assert.equal(view.points.length, 0); assert.equal(view.colors.length, 0);
	input.dispose();
});
