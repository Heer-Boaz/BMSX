import { getActiveIdeThemeVariant } from '../../../ide/common/constants';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { RuntimeInspectionProperty } from '../../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { check, type StudioFixture } from './studio_fixture';

/** Continues the actor fixture at its second recorded guest-input mutation. */
export async function testBehaviorValueChanges(test: StudioFixture) {
	const { ide, runtime, guest, press, frame, cycles, until, runPaletteCommand } = test;
	const observations: { kind: string; before: string; previous: string; replayed: string }[] = [];
	for (const [kind, sourceCommand, query, liveCommand] of [
		['bt', 'Behavior Lens: Open Behavior Tree (BT)', 'rover', 'Behavior Tree: Inspect Runtime Instance'],
		['fsm', 'Behavior Lens: Open State Machine (FSM)', 'walker', 'State Machine: Inspect Runtime Instance'],
		['effect', 'Behavior Lens: Open ActionEffect', 'pulse', 'Behavior Lens: Inspect Granted ActionEffect'],
	] as const) {
		await runPaletteCommand(sourceCommand);
		await test.clipboard.writeText(query); await press('ControlLeft', 'KeyV');
		check(ide.editor.quickInput.model.list.rows.length === 1, 'fixture source registration is uniquely selected');
		await press('Enter');
		await runPaletteCommand(liveCommand);
		await test.clipboard.writeText('first'); await press('ControlLeft', 'KeyV');
		check(ide.editor.quickInput.model.list.rows.length === 1, 'instance choice belongs to the first actor');
		await press('Enter');
		if (kind === 'fsm') {
			const index = ide.editor.quickInput.model.list.rows.findIndex(row => row.item.label.endsWith(':/nest'));
			check(index >= 0, 'choose the retained nest state, not an authored registration');
			for (let n = 0; n < index; n++) await press('ArrowDown');
			await press('Enter');
		}
		const inspector = (ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
		check(inspector.visible && inspector.model.rows.every(row => !row.element.valueChanged), 'opening a live instance starts neutral');
		const index = inspector.model.rows.findIndex(row => {
			const identity = (row.element as RuntimeInspectionProperty).identity;
			return kind === 'bt' ? identity?.section === 'blackboard' && identity.key?.scalar === 1
				: kind === 'fsm' ? identity?.section === 'instance' && identity.field === 'data'
				: identity?.section === 'world' && identity.field === 'gameplay_time_ms';
		});
		check(index >= 0, 'selected live inspector exposes its expected runtime property');
		await press('Home');
		for (let n = 0; n < index; n++) await press('ArrowDown');
		const property = inspector.model.rows[index].element, before = property.value, position = cycles();
		await runPaletteCommand('Run: Previous Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() < position, `behavior changes: ${kind} previous frame`);
		const previous = property.value, previousPosition = cycles();
		check(inspector.visible && property.valueChanged === true && previous !== before
			&& inspector.model.rows[inspector.model.selectionIndex].element === property, 'rewind marks the retained selected property');
		await runPaletteCommand('Run: Next Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() > previousPosition, `behavior changes: ${kind} replay frame`);
		check(property.valueChanged === true && property.value === before, 'replay compares against the previous completed observation');
		await test.capture?.(`behavior-${kind}-changed-light`);
		await press('ControlLeft', 'AltLeft', 'KeyT');
		check(getActiveIdeThemeVariant() === 'dark' && property.valueChanged === true, 'theme changes preserve the observed marker');
		await test.capture?.(`behavior-${kind}-changed-dark`);
		await press('ControlLeft', 'AltLeft', 'KeyT');
		const pausedCycles = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes();
		let reads = 0;
		const read = guest.readStringMember, visit = guest.visitTableEntries;
		guest.readStringMember = function(value, name) { reads++; return read.call(this, value, name); };
		guest.visitTableEntries = function(value, visitor) { reads++; visit.call(this, value, visitor); };
		for (let n = 0; n < 6; n++) await frame();
		guest.readStringMember = read; guest.visitTableEntries = visit;
		check(reads === 0 && property.valueChanged === true && cycles() === pausedCycles && runtime.machine.cpu.luaHeap.usedBytes() === heap,
			'paused live inspection paints keep the marker without guest reads, cycles or heap changes');
		await runPaletteCommand('Run: Next Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() > pausedCycles, `behavior changes: ${kind} next observation`);
		if (kind !== 'effect') check(!property.valueChanged && property.value === before, 'next unchanged observation clears the marker');
		const forward = cycles();
		await runPaletteCommand('Run: Previous Frame');
		await until(() => ide.frameNavigation.active === undefined && cycles() < forward, `behavior changes: ${kind} return to input boundary`);
		observations.push({ kind, before, previous, replayed: property.value });
		await press('Escape');
		await runPaletteCommand(liveCommand);
		await test.clipboard.writeText('second'); await press('ControlLeft', 'KeyV');
		check(ide.editor.quickInput.model.list.rows.length === 1, 'select the distinct second owner');
		await press('Enter');
		if (kind === 'fsm') await press('Enter');
		check(inspector.visible && inspector.model.rows.every(row => !row.element.valueChanged), 'a new selected instance cannot inherit another baseline');
		await press('Escape');
	}
	return observations;
}
