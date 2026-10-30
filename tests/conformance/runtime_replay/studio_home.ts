import { HomeEditorPane } from '../../../ide/workbench/contrib/home/editor_pane';
import { check, type StudioFixture } from './studio_fixture';

/** The real Home catalog remains discoverable while one native command is temporarily unavailable. */
export async function testStudioHomeDiscovery(test: StudioFixture): Promise<void> {
	const { ide, press, frame } = test, editor = ide.editor;
	console.info('STUDIO: Home supported catalog / temporary command admission');
	await test.runPaletteCommand('View: Studio Home');
	const home = editor.editorParts.activeGroup.model.activeTab, pane = editor.editorParts.activeGroup.panes.activePane;
	if (home.kind !== 'home' || !(pane instanceof HomeEditorPane)) throw new Error('Home discovery: actual Home input and pane required');
	const section = home.sections.find(section => section.actions.items.some(item => item.command === 'animation'))!;
	const action = section.actions.items.find(item => item.command === 'animation')!;
	const membership = home.sections.map(section => [...section.actions.items]);
	const documents = [...editor.editorParts.documents], before = test.cycles();
	const origin = pane.commandTarget.commandContext;
	let enabled = false, invoked = 0;
	// A real contribution override uses the same contextual admission as production controls.
	origin.registerCommand('animation', { isEnabled: () => enabled, run: () => { invoked++; } });
	try {
		await frame();
		pane.focus(); await press('Tab'); await press('Home');
		check(action.visible && !action.enabled && section.actions.hasFocus,
			'Home discovery: the supported disabled entry remains in its actual keyboard-reachable section');
		for (let font = 0; font < 2; font++) {
			for (let theme = 0; theme < 2; theme++) {
				await test.click(action.bounds);
				check(invoked === 0 && home.sections.every((section, index) => section.actions.items.length === membership[index].length
					&& section.actions.items.every((item, itemIndex) => item === membership[index][itemIndex] && item.visible)),
					'Home discovery: disabled pointer admission neither executes nor withdraws catalog members');
				await test.capture?.(`home-discovery-${editor.fontVariant}-theme-${theme}-disabled`);
				await press('ControlLeft', 'AltLeft', 'KeyT');
			}
			await press('ControlLeft', 'ShiftLeft', 'KeyT');
		}
		enabled = true; await frame();
		check(action.visible && action.enabled, 'Home discovery: command readiness changes admission without reconstructing its supported action');
		pane.focus(); await press('Tab'); await press('Home');
		for (let step = 0; step < section.actions.items.length
			&& section.actions.items[section.actions.focusedIndex].command !== 'animation'; step++) await press('ArrowDown');
		check(section.actions.items[section.actions.focusedIndex].command === 'animation',
			'Home discovery: ordinary keyboard navigation reaches the newly enabled contextual action');
		await press('Enter');
		check(invoked === 1, 'Home discovery: the same retained action executes once through native keyboard admission');
		enabled = false; await frame();
		check(action.visible && !action.enabled && section.actions.items[section.actions.focusedIndex]?.command !== 'animation',
			'Home discovery: disabling a focused action retires its input admission, not its membership');
		check(editor.editorParts.documents.length === documents.length
			&& editor.editorParts.documents.every((input, index) => input === documents[index]) && test.cycles() === before,
			'Home discovery: capability changes and visual presentation mutate neither documents nor guest execution');
	} finally {
		origin.unregisterCommand('animation');
		await frame();
	}
	console.info('STUDIO: Home supported catalog / temporary command admission PASS');
}
