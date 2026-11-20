import { check, type StudioFixture } from './studio_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';

/** Source reveal must survive the automatically scheduled semantic query, not just place the cursor. */
export async function testStudioBehaviorNavigation(test: StudioFixture): Promise<void> {
	const { ide, harness, clipboard, runPaletteCommand, press, until, cycles } = test;
	const position = cycles();
	console.info('STUDIO: Moon timeline source reveal and automatic signature help');
	harness.openLuaSource('cart.lua');
	await runPaletteCommand('behaviorLens.stateMachines');
	check(ide.editor.editorParts.activePart.quickInput.visible, 'behavior navigation: palette offers behavior registrations');
	await clipboard.writeText('moon_death_ray');
	await press('ControlLeft', 'KeyV');
	check(ide.editor.editorParts.activePart.quickInput.model.list.rows.length === 1, 'behavior navigation: actual Moon source is selected');
	await press('Enter');
	const lens = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens') throw new Error('behavior navigation: selected lens missing');
	check(lens.workingCopy.resource.path === 'enemies/moon_death_ray.lua', 'behavior navigation: actual cart source model');
	const model = lens.workingCopy;
	const lines = model.buffer.getText().split('\n');
	const timelineRow = lines.findIndex(line => line.trimStart().startsWith('[expansion_timeline_id] = {'));
	const registrationRow = lines.findIndex(line => line.trimStart().startsWith('fsm_library.register(ids_moon_death_ray_fsm,'));
	const registrationEnd = lines.findIndex((line, row) => row > registrationRow && line === '\t})');
	check(registrationRow >= 0 && timelineRow > registrationRow && registrationEnd > timelineRow, 'behavior navigation: the authored expansion belongs to the Moon FSM registration');
	const timeline = lens.view.source.nodes.find(node => node.authoredRange.start.line === timelineRow + 1);
	if (timeline === undefined) throw new Error('behavior navigation: the expansion timeline has no source occurrence');
	await revealLensOccurrence(test, lens.view, timeline.rowKey);
	await runPaletteCommand('editor.source');
	const document = harness.getActiveEditorDocument()!;
	check(document.model === model && document.view.cursorRow === timelineRow && document.view.cursorColumn === lines[timelineRow].indexOf('['),
		'behavior navigation: Source reveals the authored expansion timeline, not its parent state');
	await until(() => harness.getSignatureHelp() !== null, 'behavior navigation: automatic parameter help finishes after source reveal');
	const hint = harness.getSignatureHelp()!;
	const signature = hint.signatures[hint.activeSignature];
	check(signature.parameters.map(parameter => signature.label.slice(parameter.start, parameter.end)).join(',') === 'machine_name,blueprint'
		&& hint.activeParameter === 1 && hint.applicableRange.start.line === registrationRow + 1 && hint.applicableRange.end.line === registrationEnd + 1,
		'behavior navigation: the actual enclosing FSM registration signature is resolved, not suppressed');
	await press('ArrowDown');
	check(document.view.cursorRow === timelineRow + 1, 'behavior navigation: keyboard remains responsive after the idle semantic query');
	await runPaletteCommand('behaviorLens.stateMachines');
	await chooseBehavior(test, lens.title);
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens, 'behavior navigation: palette can reopen the retained view after parameter help');
	check(cycles() === position, 'behavior navigation: source navigation does not run or mutate the paused machine');
	harness.openLuaSource('scenes/root.lua');
}
