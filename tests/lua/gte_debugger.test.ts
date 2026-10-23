import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { IO_GX_GTE_PLUS_BASE } from '../../machine/ts/spec/bmsx/io';
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

test('GTE following retires excluded selections once while pinned evidence survives filtering', () => {
	const { input } = fixture();
	input.update();
	assert.equal(input.selected.sequence, 2);
	input.selectedPoint = 1;
	const revision = input.selectionRevision;
	input.filter = 'no matching command'; input.update();
	assert.equal(input.following, true);
	assert.equal(input.projection.rows.length, 0);
	assert.equal(input.selected.sequence, -1);
	assert.equal(input.selected.image, null);
	assert.equal(input.selectedPoint, 0);
	assert.equal(input.selectionRevision, revision + 1);
	input.update();
	assert.equal(input.selectionRevision, revision + 1, 'waiting does not repeatedly invalidate the empty selection');
	input.filter = 'RTPT'; input.update();
	assert.equal(input.selected.sequence, 0, 'restoring matches follows the newest matching command');
	input.filter = ''; input.update();
	assert.equal(input.selected.sequence, 2);
	input.select(0);
	const pinnedRevision = input.selectionRevision;
	input.filter = 'no matching command'; input.update();
	assert.equal(input.following, false);
	assert.equal(input.projection.rows.length, 0);
	assert.equal(input.selected.sequence, 0, 'filtering does not retire explicitly pinned evidence');
	assert.equal(input.selectionRevision, pinnedRevision);
	input.following = true; input.update();
	assert.equal(input.selected.sequence, -1, 'Follow adopts the empty projection rather than the old pin');
	input.update();
	assert.equal(input.selectionRevision, pinnedRevision + 1);
	input.dispose();
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
	assert.equal(view.properties.length, 0, 'raw details are not formatted while following');
	view.update(projection, 1, 'projected');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[96, 64], [160, 64], [128, 128]]);
	view.update(winding, 1, 'auto');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[96, 64], [160, 64], [128, 128]]);
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
	const empty = new GteCommandSnapshot(); view.update(empty, 1, 'auto');
	assert.equal(view.heading, ''); assert.equal(view.summary, ''); assert.equal(view.flags, ''); assert.equal(view.explanation, '');
	assert.equal(view.points.length, 0); assert.equal(view.colors.length, 0);
	input.dispose();
});

test('PLUS views preserve accepted operands, display only published results and never connect vectors as a triangle', () => {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime, sources } = eventHistoryRuntime(images), history = new RuntimeGteHistory(runtime, sources, 8);
	const input = new GteDebuggerInput(history), view = new GteDebugPresentation(), memory = runtime.machine.memory;
	const write = (index: number, word: number) => memory.writeMappedWord(IO_GX_GTE_PLUS_BASE + index * 4, word);
	const publish = (cycles: number) => { runtime.machine.scheduler.setNowCycles(cycles); memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + 9 * 4); };
	runtime.machine.scheduler.setNowCycles(100);
	write(0, 0xffd00078); write(1, 256); write(2, 0x00100018); write(3, 0xffe0); write(4, 2048); write(8, 1);
	input.update(); input.select(0);
	const accepted = history.snapshot(0);
	assert.equal(accepted.kind, 'plus-accepted');
	view.update(accepted, 1, 'auto');
	assert.deepEqual(view.points.map(point => [point.label, point.x, point.y]), [['ADD', 120, -48], ['MUL', 24, 16]]);
	assert.equal(view.connectPoints, false);
	write(0, 0x0050ffa0);
	publish(105); input.update();
	assert.equal(input.selected.kind, 'plus-accepted', 'a pinned acceptance never gains a future publication');
	assert.equal(input.selected.beforePlus[0], 0xffd00078);
	const published = history.snapshot(1);
	assert.equal(published.kind, 'plus-published'); assert.equal(published.acceptedSequence, 0);
	assert.equal(published.beforePlus[0], 0xffd00078); assert.equal(published.afterPlus[0], 0x0050ffa0);
	view.update(published, 1, 'auto');
	assert.deepEqual(view.points.map(point => [point.label, point.x, point.y]), [['ADD', 120, -48], ['MUL', 24, 16], ['R', 132, -40]]);
	assert.equal(view.connectPoints, false);
	view.update(published, 1, 'input', 'xz');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[120, 256], [24, -32], [132, 240]]);
	assert.equal(view.horizontalAxis, 'X'); assert.equal(view.verticalAxis, 'Z');
	view.update(published, 1, 'input', 'yz');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[-48, 256], [16, -32], [-40, 240]]);
	const filtered = new GteCommandProjection(); filtered.update(history, 'PUBLISH'); assert.deepEqual(filtered.rows, [1]);
	write(8, 0xff); publish(110);
	const invalid = history.snapshot(3);
	view.update(invalid, 1, 'auto');
	assert.equal(view.points.length, 1); assert.equal(view.points[0].label, 'R kept');
	assert.deepEqual([view.points[0].x, view.points[0].y], [132, -40]);
	assert.equal(invalid.deadlineCycles, 106); assert.equal(invalid.cycles, 110);
	write(0, 0x80087ff8); write(1, 1024); write(2, 0xffe00020); write(3, 0xf800); write(4, 2048); write(8, 1); publish(115);
	view.update(history.snapshot(5), 1, 'auto');
	assert.deepEqual([view.points[2].x, view.points[2].y], [32767, -32768]);
	input.dispose();
	write(8, 1);
	const reopened = new GteDebuggerInput(history);
	publish(120);
	const orphan = history.snapshot(history.firstSequence);
	assert.equal(orphan.kind, 'plus-published'); assert.equal(orphan.acceptedSequence, undefined);
	assert.equal(orphan.domain, undefined); assert.equal(orphan.pc, undefined); assert.equal(orphan.image, null);
	view.update(orphan, 1, 'auto');
	assert.equal(view.points.length, 1); assert.equal(view.points[0].label, 'R');
	reopened.dispose();
});

test('GTE compact Details preserve every before/after raw word and visible interpretation limits', () => {
	const record = new GteCommandSnapshot(), view = new GteDebugPresentation();
	record.sequence = 5; record.commandWord = 0x00080030; record.beforeData[0] = 0x89abcdef; record.afterData[0] = 0xfedcba98;
	record.afterControl[31] = 0x00400000;
	view.update(record, 1, 'auto');
	const properties = view.details(record), registers = properties.filter(row => /^[DC]\[/.test(row.label));
	assert.equal(registers.length, 64); assert.ok(properties.every(row => row.compact === true));
	assert.equal(registers[0].value, '89ABCDEFh -> FEDCBA98h'); assert.match(registers[0].label, /changed/);
	assert.ok(registers.every(row => row.descriptionDisplay === 'disclosure' && row.description.includes('not an MMIO alias read')));
	assert.equal(properties[0].descriptionDisplay, 'inline'); assert.match(properties[0].description, /not elapsed frame time/);
	const flag = properties.find(row => row.label === 'Result FLAG')!;
	assert.equal(flag.warning, true); assert.equal(flag.descriptionDisplay, 'inline'); assert.match(flag.description, /does not summarize every saturation bit/);
	const projection = properties.find(row => row.label === 'Projection at issue')!;
	assert.equal(projection.descriptionDisplay, 'inline'); assert.match(projection.description, /no framebuffer mapping/);
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new Font({ variant }), model = new WorkbenchPropertyInspectorModel<InspectedProperty>();
		let measurements = 0;
		const measure = (text: string, start: number, end: number) => { measurements++; return font.measure(text.slice(start, end)); };
		const bounds = { left: 0, top: 40, right: 384, bottom: 256 };
		model.setItems(properties); model.layout(font, measure, bounds);
		const visible = model.rows.filter(row => row.bottom <= bounds.bottom - bounds.top);
		assert.ok(visible.length >= 10, `${variant}: compact retained fields expose at least ten values, not four paragraph cards (${visible.length})`);
		assert.equal(model.rows[0].textExpanded, false);
		const measured = measurements, rows = model.rows;
		for (let n = 0; n < 1000; n++) { assert.equal(view.update(record, 1, 'auto'), false); model.layout(font, measure, bounds); }
		assert.equal(measurements, measured); assert.equal(model.rows, rows); assert.equal(view.properties, properties);
	}

});

test('PLUS compact Details keep absent acceptance, result lifetime and writable-bank ambiguity explicit', () => {
	const record = new GteCommandSnapshot(), view = new GteDebugPresentation();
	record.sequence = 7; record.kind = 'plus-published'; record.commandWord = 1;
	record.afterPlus[0] = 0x12345678;
	view.update(record, 1, 'auto');
	const properties = view.details(record);
	assert.ok(properties.every(row => row.compact === true));
	const flag = properties.find(row => row.label === 'Published FLAG')!;
	assert.equal(flag.descriptionDisplay, 'inline'); assert.match(flag.description, /Acceptance was not observed/); assert.match(flag.description, /next calculation/);
	assert.equal(properties.filter(row => row.label.startsWith('Accepted[')).length, 0, 'unobserved accepted operands are not invented from published writable inputs');
	const published = properties.filter(row => row.label.startsWith('Published['));
	assert.equal(published.length, 10); assert.equal(published[0].value, '12345678h'); assert.equal(published[0].descriptionDisplay, 'disclosure');
	assert.match(published[0].description, /not an accepted operand/);
});
