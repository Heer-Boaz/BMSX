import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { IO_GX_GTE_COMMAND, IO_GX_GTE_PLUS_BASE } from '../../machine/ts/spec/bmsx/io';
import { GteCommandSnapshot, RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
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

/** Physical list admission uses actual GTE observations beside a departing real Source client. */
function pointerFixture(t: TestContext) {
	const f = createActualSourcePanes(t), input = new GteDebuggerInput(f.editor.gte);
	f.firstGroup.openEditor(input);
	const emit = (count = 1) => {
		for (let index = 0; index < count; index++) f.host.runtime.machine.memory.writeMappedU32LE(IO_GX_GTE_COMMAND, 0x00000006);
	};
	emit(3); f.update();
	assert.equal(input.projection.rows.length, 3);
	const pane = f.firstGroup.panes.activePane!;
	f.second.focus();
	const press = (index: number, button: PointerButton) => f.editor.dispatchPointer({
		x: input.list.bounds.left + 4, y: input.list.offsetTop + (index + 0.5) * input.layout.rowHeight,
		buttons: button, pressedButtons: button, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now(),
	});
	return { ...f, input, pane, emit, press };
}

for (const button of [PointerButton.Primary, PointerButton.Secondary]) test(`GTE button ${button} cannot pin old evidence after Source blur replaces its real pane`, t => {
	const f = pointerFixture(t), selected = f.input.selected.sequence, revision = f.input.selectionRevision;
	const words = f.input.selected.afterData.slice(), replacement = new HostErrorInput('newer GTE-group document');
	let callbacks = 0;
	const unbind = f.second.commandTarget.onDidBlur(() => { unbind(); callbacks++; f.firstGroup.openEditor(replacement); });
	t.after(unbind);
	assert.doesNotThrow(() => f.press(0, button));
	assert.equal(callbacks, 1); assert.equal(f.input.selected.sequence, selected);
	assert.equal(f.input.selectionRevision, revision); assert.equal(f.input.following, true);
	assert.deepEqual(f.input.selected.afterData, words);
	assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(f.firstGroup.model.activeTab === replacement && inputFocus.admittedTarget === f.firstGroup.panes.activePane!.commandTarget);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('GTE secondary press rejects a superseded focus request even when blur returns to its same live client and sequence', t => {
	const f = pointerFixture(t), target = f.pane.commandTarget, context = target.scope.contextGeneration;
	const offered = f.input.projection.rows[0], selected = f.input.selected.sequence, revision = f.input.selectionRevision;
	let callbacks = 0;
	const unbind = f.second.commandTarget.onDidBlur(() => {
		unbind(); callbacks++;
		f.second.focus(); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
		target.focus(); assert.ok(inputFocus.admittedTarget === target);
		assert.equal(target.scope.contextGeneration, context); assert.equal(f.input.projection.rows[0], offered);
	}); t.after(unbind);
	f.press(0, PointerButton.Secondary);
	assert.equal(callbacks, 1); assert.ok(inputFocus.admittedTarget === target);
	assert.equal(target.scope.contextGeneration, context); assert.equal(f.input.projection.rows[0], offered);
	assert.equal(f.input.selected.sequence, selected); assert.equal(f.input.selectionRevision, revision);
	assert.equal(f.input.following, true); assert.equal(f.editor.contextMenu.visible, false);
});

for (const button of [PointerButton.Primary, PointerButton.Secondary]) for (const admission of ['files', 'reattach', 'rebind'] as const)
test(`GTE button ${button} rejects its previous attachment when Source blur admits ${admission}`, t => {
	const f = pointerFixture(t), selected = f.input.selected.sequence, revision = f.input.selectionRevision;
	const context = f.pane.inputScope!.contextGeneration;
	const replacement = admission === 'rebind' ? new GteDebuggerInput(f.editor.gte) : f.input;
	const unbind = f.second.commandTarget.onDidBlur(() => {
		unbind();
		if (admission === 'files') f.editor.commands.execute('resources.focus', f.pane.commandTarget);
		else {
			if (admission === 'reattach') f.firstGroup.panes.clearEditor();
			f.firstGroup.openEditor(replacement);
		}
	}); t.after(unbind);
	f.press(0, button);
	assert.equal(f.input.selected.sequence, selected); assert.equal(f.input.selectionRevision, revision);
	assert.equal(f.input.following, true); assert.equal(f.editor.contextMenu.visible, false);
	if (admission === 'files') {
		assert.ok(inputFocus.admittedTarget === f.editor.resourcePanel.focusTarget);
		assert.equal(f.pane.inputScope!.contextGeneration, context);
	} else {
		assert.ok(f.pane.input === replacement && f.firstGroup.model.contains(f.input));
		assert.ok(f.pane.inputScope!.contextGeneration > context);
		assert.ok(inputFocus.admittedTarget === f.pane.commandTarget);
	}
});

for (const button of [PointerButton.Primary, PointerButton.Secondary]) test(`GTE button ${button} selects its exact admitted sequence across unrelated Source rebind and history append`, t => {
	const f = pointerFixture(t), sequence = f.input.projection.rows[0], generation = f.input.history.generation;
	const replacement = new HostErrorInput('unrelated Source document');
	const unbind = f.second.commandTarget.onDidBlur(() => {
		unbind(); f.secondGroup.openEditor(replacement, { preserveFocus: true }); f.emit();
	}); t.after(unbind);
	f.press(0, button);
	assert.equal(f.input.history.generation, generation); assert.equal(f.input.history.count, 4);
	assert.equal(f.input.selected.sequence, sequence); assert.equal(f.input.following, false);
	assert.ok(f.firstGroup.panes.activePane === f.pane && f.secondGroup.model.activeTab === replacement);
	assert.equal(f.editor.contextMenu.visible, button === PointerButton.Secondary);
	if (button === PointerButton.Secondary) {
		assert.ok(f.editor.contextMenu.invocationOrigin === f.pane.commandTarget);
		assert.ok(f.editor.contextMenu.model.rows.find(row => row.command === 'gte.details')!.enabled);
		f.key('Escape');
	}
	assert.ok(inputFocus.admittedTarget === f.pane.commandTarget);
});

for (const change of ['clear', 'expiry', 'filter'] as const) test(`GTE secondary press cannot copy a retired sequence after blur ${change}`, t => {
	const f = pointerFixture(t), sequence = f.input.projection.rows[0], selected = f.input.selected.sequence;
	const revision = f.input.selectionRevision, generation = f.input.history.generation;
	const unbind = f.second.commandTarget.onDidBlur(() => {
		unbind();
		if (change === 'clear') f.input.history.clear();
		else if (change === 'expiry') f.emit(f.input.history.capacity);
		else { f.input.filter = 'no matching observation'; f.input.update(); }
	}); t.after(unbind);
	f.press(0, PointerButton.Secondary);
	assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === f.pane.commandTarget);
	assert.equal(f.input.following, true);
	if (change === 'filter') {
		assert.equal(f.input.projection.rows.length, 0); assert.equal(f.input.selected.sequence, -1);
	} else {
		assert.equal(f.input.projection.rows[0], sequence, 'normal projection has not consumed the domain change yet');
		assert.equal(f.input.selected.sequence, selected); assert.equal(f.input.selectionRevision, revision);
		assert.ok(sequence < f.input.history.firstSequence);
		assert.equal(f.input.history.generation === generation, change === 'expiry', 'ring expiry does not change history generation');
	}
});

test('GTE admitted empty-body context keeps owned evidence and exposes history actions', t => {
	const f = pointerFixture(t), selected = f.input.selected.sequence, revision = f.input.selectionRevision;
	f.press(5, PointerButton.Secondary);
	assert.equal(f.input.selected.sequence, selected); assert.equal(f.input.selectionRevision, revision);
	assert.equal(f.input.following, false); assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.editor.contextMenu.invocationOrigin === f.pane.commandTarget);
	assert.ok(f.editor.contextMenu.model.rows.find(row => row.command === 'gte.filter')!.enabled);
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === f.pane.commandTarget);
});

test('GTE scrollbar scrolls without accepting Source focus or pinning evidence', t => {
	const f = pointerFixture(t); f.emit(80); f.update(); f.second.focus();
	const selected = f.input.selected.sequence, revision = f.input.selectionRevision, track = f.input.list.scrollbar.getTrack();
	f.input.list.scrollbar.setScroll(0);
	let blurs = 0; t.after(f.second.commandTarget.onDidBlur(() => { blurs++; }));
	f.editor.dispatchPointer({ x: (track.left + track.right) / 2, y: track.bottom - 2,
		buttons: 0, pressedButtons: PointerButton.Primary, releasedButtons: PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.ok(f.input.list.scrollTop > 0); assert.equal(blurs, 0);
	assert.equal(f.input.selected.sequence, selected); assert.equal(f.input.selectionRevision, revision);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget); assert.equal(f.editor.contextMenu.visible, false);
});

test('GTE input follows by owned copy, pins across ring reuse and distinguishes clear from generation changes', () => {
	const { history, input, issue } = fixture();
	assert.equal(input.actions.overflow!.secondary, WORKBENCH_MENUS['gte.context']);
	assert.ok(input.actions.overflow!.secondary!.some(item => item.type === 'command' && item.command === 'gte.source'));
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
	assert.equal(view.heading, 'No command selected'); assert.equal(view.summary, ''); assert.equal(view.flags, ''); assert.equal(view.explanation, 'Select an observed command in history.');
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
	assert.equal(properties[0].descriptionDisplay, 'disclosure'); assert.match(properties[0].description, /not elapsed frame time/);
	const flag = properties.find(row => row.label === 'Result')!;
	assert.equal(flag.warning, true); assert.equal(flag.descriptionDisplay, 'disclosure'); assert.match(flag.description, /does not summarize every saturation bit/);
	const projection = properties.find(row => row.label === 'Projection')!;
	assert.equal(projection.descriptionDisplay, 'disclosure'); assert.match(projection.description, /no framebuffer mapping/);
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
	assert.equal(flag.descriptionDisplay, 'disclosure'); assert.match(flag.description, /Acceptance was not observed/); assert.match(flag.description, /next calculation/);
	assert.equal(properties.filter(row => row.label.startsWith('Accepted[')).length, 0, 'unobserved accepted operands are not invented from published writable inputs');
	const published = properties.filter(row => row.label.startsWith('Published['));
	assert.equal(published.length, 10); assert.equal(published[0].value, '12345678h'); assert.equal(published[0].descriptionDisplay, 'disclosure');
	assert.match(published[0].description, /not an accepted operand/);
});
