import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../machine/ts/spec/bmsx/io';
import { GpuOperationSnapshot, RuntimeGpuHistory } from '../../ide/runtime/gpu_history';
import { GpuDebuggerInput } from '../../ide/workbench/contrib/gpu_debugger/editor_input';
import {
	GpuDebugPresentation,
	GpuOperationProjection,
} from '../../ide/workbench/contrib/gpu_debugger/presentation';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

function fixture() {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime } = eventHistoryRuntime(images);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const history = new RuntimeGpuHistory(runtime, 3, 128), input = new GpuDebuggerInput(history);
	const write = (words: readonly number[]) => {
		for (const word of words) {
			runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 1000);
			runtime.machine.memory.writeMappedWord(IO_GX_GPU_GP0, word);
		}
		runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 1000);
		runtime.machine.memory.readMappedU32LE(IO_GX_GPU_GP1);
	};
	const issue = (triangleWord = 0x300000ff) => write([
		0xe1000321, 0xe20042a5, 0xe3000801, 0xe407ffff, 0xe5003805, 0xe6000003,
		triangleWord, 0x000a0014, 0x0000ff00, 0x000a0028, 0x00ff0000, 0x001e0014,
		0x40001122, 0x00020001, 0x00040003,
		0x60003344, 0x00060005, 0x00020003,
	]);
	return { runtime, history, input, issue, write };
}

test('GPU input owns emitted words and latched state while pinning across ring reuse, clear and tab leases', () => {
	const { history, input, issue, write } = fixture();
	assert.equal(input.view, 'geometry');
	issue(); input.update();
	assert.equal(history.count, 3, 'drawing-state commands do not masquerade as emitted operations');
	assert.equal(input.following, true);
	assert.equal(input.selected.sequence, 2);
	input.select(0);
	const owned = input.selected, revision = input.selectionRevision;
	assert.equal(owned.kind, GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(owned.drawModeWord, 0x321);
	assert.equal(owned.textureWindowWord, 0x42a5);
	assert.equal(owned.drawingAreaTopLeftWord, 0x801);
	assert.equal(owned.drawingAreaBottomRightWord, 0x7ffff);
	assert.equal(owned.drawingOffsetWord, 0x3805);
	assert.equal(owned.maskBitModeWord, 3);
	assert.deepEqual(Array.from(owned.words.subarray(0, owned.wordCount)), [
		0x300000ff, 0x000a0014, 0x0000ff00, 0x000a0028, 0x00ff0000, 0x001e0014,
	]);
	const view = new GpuDebugPresentation();
	view.update(owned, revision, 'geometry');
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[25, 17], [45, 17], [25, 37]]);
	assert.deepEqual(view.vertices.map(vertex => vertex.argb), [0xffff0000, 0xff00ff00, 0xff0000ff]);
	write([0xe5000000, 0xe6000000]);
	issue(0x300000a5); input.update();
	assert.equal(history.firstSequence, 3);
	assert.equal(input.selected, owned);
	assert.equal(input.selectionRevision, revision, 'unrelated emissions do not rebuild a pinned presentation');
	assert.equal(owned.sequence, 0);
	assert.equal(owned.words[0], 0x300000ff);
	assert.equal(owned.drawingOffsetWord, 0x3805);
	history.clear(); input.update();
	assert.equal(owned.sequence, 0, 'a pinned owned observation survives history retirement');
	input.following = true;
	issue(); input.update();
	assert.equal(owned.sequence, 8);
	history.clear(); input.update();
	assert.equal(owned.sequence, -1, 'following cannot label evidence from a previous generation as current');
	issue(); input.update(); input.selectedPoint = 2; input.clear(); input.update();
	assert.equal(input.selected.sequence, -1);
	assert.equal(input.selectedPoint, 0);
	assert.equal(input.projection.rows.length, 0);
	const second = new GpuDebuggerInput(history);
	second.dispose();
	assert.equal(history.observing, true, 'disposing a duplicate input cannot release the retained tab lease');
	input.dispose();
	assert.equal(history.observing, false);
});

test('GPU following retires excluded selections once while pinned evidence survives filtering', () => {
	const { input, issue } = fixture();
	issue(); input.update();
	assert.equal(input.selected.sequence, 2);
	input.selectedPoint = 1; input.selectedWord = 2;
	const revision = input.selectionRevision;
	input.filter = 'no matching operation'; input.update();
	assert.equal(input.following, true);
	assert.equal(input.projection.rows.length, 0);
	assert.equal(input.selected.sequence, -1);
	assert.equal(input.selected.wordCount, 0);
	assert.equal(input.selectedPoint, 0);
	assert.equal(input.selectedWord, 0);
	assert.equal(input.selectionRevision, revision + 1);
	input.update();
	assert.equal(input.selectionRevision, revision + 1, 'waiting does not repeatedly invalidate the empty selection');
	input.filter = 'polygon'; input.update();
	assert.equal(input.selected.sequence, 0, 'restoring matches follows the newest matching operation');
	input.filter = ''; input.update();
	assert.equal(input.selected.sequence, 2);
	input.select(0);
	const pinnedRevision = input.selectionRevision;
	input.filter = 'no matching operation'; input.update();
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

test('GPU operation projection filters emitted metadata without retaining reused ring slots', () => {
	const { history, input, issue } = fixture(), projection = new GpuOperationProjection();
	issue();
	projection.update(history, 'polygon');
	assert.deepEqual(projection.rows, [0]);
	assert.equal(projection.update(history, 'polygon'), false);
	issue(); projection.update(history, 'polygon');
	assert.deepEqual(projection.rows, [3]);
	projection.update(history, 'rectangle');
	assert.deepEqual(projection.rows, [5]);
	projection.update(history, '');
	assert.deepEqual(projection.rows, [3, 4, 5]);
	history.clear(); projection.update(history, '');
	assert.deepEqual(projection.rows, []);
	input.dispose();
});

test('GPU polygon integer offset sums differ from rectangle origin rewrapping and sizes follow opcode', () => {
	const view = new GpuDebugPresentation(), polygon = new GpuOperationSnapshot(4);
	polygon.sequence = 1; polygon.kind = GX_GPU_COMMAND_DRAW_POLYGON; polygon.opcode = 0x20; polygon.wordCount = 4;
	polygon.drawingOffsetWord = 0x003ff801; // X=1, Y=-1.
	polygon.words.set([0x20332211, 0x040003ff, 0x040103fe, 0x03ff03fd]);
	view.update(polygon, 1, 'geometry');
	assert.deepEqual(view.vertices.map(vertex => [vertex.packetX, vertex.packetY]), [[1023, -1024], [1022, -1023], [1021, 1023]]);
	assert.deepEqual(view.vertices.map(vertex => [vertex.x, vertex.y]), [[1024, -1025], [1023, -1024], [1022, 1022]]);
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[1024, -1025], [1023, -1024], [1022, 1022]]);
	assert.deepEqual(view.triangles, [0, 1, 2]);
	assert.equal(view.properties.length, 0, 'raw details remain lazy during ordinary following');
	assert.equal(view.update(polygon, 1, 'geometry'), false);
	const rectangle = new GpuOperationSnapshot(3);
	rectangle.sequence = 2; rectangle.kind = GX_GPU_COMMAND_DRAW_RECTANGLE; rectangle.opcode = 0x60; rectangle.wordCount = 3;
	rectangle.drawingOffsetWord = polygon.drawingOffsetWord;
	rectangle.words.set([0x60332211, 0x040003ff, 0x02010401]);
	view.update(rectangle, 1, 'geometry');
	assert.deepEqual([view.vertices[0].packetX, view.vertices[0].packetY], [1023, -1024]);
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[-1024, 1023], [-1023, 1023], [-1024, 1024], [-1023, 1024]]);
	for (const [opcode, size] of [[0x68, 1], [0x70, 8], [0x78, 16]]) {
		rectangle.opcode = opcode; rectangle.words[0] = (opcode << 24) | 0x332211;
		view.update(rectangle, opcode, 'geometry');
		assert.equal(view.points[1].x - view.points[0].x, size);
		assert.equal(view.points[2].y - view.points[0].y, size);
	}
});

test('GPU textured polygon views keep supplied UV and colors aligned with real quad topology', () => {
	const view = new GpuDebugPresentation(), quad = new GpuOperationSnapshot(12);
	quad.sequence = 3; quad.kind = GX_GPU_COMMAND_DRAW_POLYGON; quad.opcode = 0x3c; quad.wordCount = 12;
	quad.drawModeWord = 0x221;
	quad.words.set([
		0x3c332211, 0x000a0014, 0x1234fefa,
		0x00665544, 0x000a0028, 0x0123fd03,
		0x00998877, 0x001e0014, 0x000004f9,
		0x00ccbbaa, 0x001e0028, 0x00000502,
	]);
	view.update(quad, 1, 'uv');
	assert.deepEqual(view.vertices.map(vertex => [vertex.u, vertex.v]), [[250, 254], [3, 253], [249, 4], [2, 5]]);
	assert.deepEqual(view.points.map(point => [point.x, point.y]), [[250, 254], [3, 253], [249, 4], [2, 5]]);
	assert.deepEqual(view.triangles, [0, 1, 2, 2, 1, 3]);
	assert.deepEqual(view.vertices.map(vertex => vertex.color), [0x332211, 0x665544, 0x998877, 0xccbbaa]);
	assert.deepEqual(view.vertices.map(vertex => vertex.argb), [0xff112233, 0xff445566, 0xff778899, 0xffaabbcc]);
	view.update(quad, 1, 'color');
	assert.deepEqual(view.vertices.map(vertex => vertex.color), [0x332211, 0x665544, 0x998877, 0xccbbaa], 'swatches are supplied RGB, not computed pixels');
	const flat = new GpuOperationSnapshot(7);
	flat.sequence = 4; flat.kind = GX_GPU_COMMAND_DRAW_POLYGON; flat.opcode = 0x24; flat.wordCount = 7;
	flat.words.set([0x24332211, 0x000a0014, 0x1234fefa, 0x000a0028, 0x0123fd03, 0x001e0014, 0x000004f9]);
	view.update(flat, 1, 'uv');
	assert.deepEqual(view.vertices.map(vertex => [vertex.u, vertex.v, vertex.color]), [[250, 254, 0x332211], [3, 253, 0x332211], [249, 4, 0x332211]]);
	assert.deepEqual(view.triangles, [0, 1, 2]);
});

test('GPU Properties keeps fixed decoded state while the independent Words table owns payload rows', () => {
	const count = 70;
	const view = new GpuDebugPresentation(), upload = new GpuOperationSnapshot(count * 2);
	upload.sequence = 5; upload.kind = GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM; upload.opcode = 0xa0; upload.wordCount = count;
	upload.words.fill(0xdeadbeef);
	upload.words.set([0xa0000000, 0x00020001, 0x00010000 | (count - 3) * 2]);
	for (let index = 3; index < upload.wordCount; index++) upload.words[index] = index;
	view.update(upload, 1, 'geometry');
	const first = view.details(upload), firstCount = first.length;
	assert.equal(first.find(item => item.label === 'Words')!.value, String(count));
	assert.equal(first.some(item => item.label.startsWith('Word[')), false);
	upload.wordCount = 3;
	view.update(upload, 2, 'geometry');
	assert.equal(view.details(upload).length, firstCount, 'Properties work does not scale with payload length or snapshot capacity');
	assert.equal(view.details(upload).find(item => item.label === 'Words')!.value, '3');
});

test('GPU filtering reports interior projection changes even when visible endpoints stay equal', () => {
	const { input, history, write } = fixture(), projection = new GpuOperationProjection();
	write([0x480000ff, 0x00010001, 0x00020002, 0x50005000,
		0x200000ff, 0x00010001, 0x00010002, 0x00020001,
		0x480000ff, 0x00010001, 0x00020002, 0x50005000]);
	projection.update(history, 'poly'); assert.deepEqual(projection.rows, [0, 1, 2]);
	assert.equal(projection.update(history, 'line'), true);
	assert.deepEqual(projection.rows, [0, 2]);
	input.dispose();
});

test('GPU Properties expose compact decoded fields and the retained packet extent without duplicating payload rows', () => {
	const record = new GpuOperationSnapshot(4), view = new GpuDebugPresentation();
	record.sequence = 5; record.kind = GX_GPU_COMMAND_DRAW_POLYGON; record.opcode = 0x20; record.wordCount = 4;
	record.words.set([0x20332211, 0x00010002, 0x00030004, 0x00050006]);
	view.update(record, 1, 'geometry');
	const properties = view.details(record), words = properties.filter(row => row.label.startsWith('Word['));
	assert.ok(properties.every(row => row.compact === true));
	assert.equal(properties[0].descriptionDisplay, 'disclosure'); assert.match(properties[0].description, /not completion/);
	assert.equal(words.length, 0);
	const raw = properties.find(row => row.label === 'Words')!;
	assert.equal(raw.value, String(record.wordCount));
	assert.equal(raw.descriptionDisplay, 'disclosure'); assert.match(raw.description, /every active word/);
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
		for (let n = 0; n < 1000; n++) { assert.equal(view.update(record, 1, 'geometry'), false); model.layout(font, measure, bounds); }
		assert.equal(measurements, measured); assert.equal(model.rows, rows); assert.equal(view.properties, properties);
	}

});
