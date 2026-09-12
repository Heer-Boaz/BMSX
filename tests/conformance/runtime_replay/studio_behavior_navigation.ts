import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';

/** Source reveal must survive the automatically scheduled semantic query, not just place the cursor. */
export async function testStudioBehaviorNavigation(test: StudioFixture): Promise<void> {
	const { ide, harness, clipboard, runPaletteCommand, press, click, until, cycles } = test;
	const position = cycles();
	console.info('STUDIO: Moon timeline source reveal and automatic signature help');
	harness.openLuaSource('cart.lua');
	await runPaletteCommand('Behavior Lens: Open');
	check(ide.editor.quickInput.visible, 'behavior navigation: palette offers behavior registrations');
	clipboard.text = 'moon_death_ray';
	await press('ControlLeft', 'KeyV');
	check(ide.editor.quickInput.model.list.rows.length === 1, 'behavior navigation: actual Moon source is selected');
	await press('Enter');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('behavior navigation: selected lens missing');
	check(lens.workingCopy.resource.path === 'enemies/moon_death_ray.lua', 'behavior navigation: actual cart source model');
	const state = lens.view.presentation;
	const timeline = lens.view.source.nodes.find(node => node.authoredRange.start.line === 79)!;
	await revealLensOccurrence(test, lens.view, timeline.rowKey);
	await click(state.actionBar.items[0].bounds);
	const document = harness.getActiveEditorDocument();
	check(document.model.resource.path === 'enemies/moon_death_ray.lua' && document.view.cursorRow === 78 && document.view.cursorColumn === 5,
		'behavior navigation: Source reveals the actual Moon model at 79:6');
	await until(() => harness.getSignatureHelp() !== null, 'behavior navigation: automatic parameter help finishes after source reveal');
	const hint = harness.getSignatureHelp()!;
	const signature = hint.signatures[hint.activeSignature];
	check(signature.parameters.map(parameter => signature.label.slice(parameter.start, parameter.end)).join(',') === 'machine_name,blueprint'
		&& hint.activeParameter === 1 && hint.applicableRange.start.line === 73 && hint.applicableRange.end.line === 106,
		'behavior navigation: the actual enclosing FSM registration signature is resolved, not suppressed');
	await press('ArrowDown');
	check(document.view.cursorRow === 79, 'behavior navigation: keyboard remains responsive after the idle semantic query');
	await runPaletteCommand('Behavior Lens: Open');
	await chooseBehavior(test, lens.title);
	check(getActiveTab() === lens, 'behavior navigation: palette can reopen the retained view after parameter help');
	check(cycles() === position, 'behavior navigation: source navigation does not run or mutate the paused machine');
	harness.openLuaSource('scenes/root.lua');
}
