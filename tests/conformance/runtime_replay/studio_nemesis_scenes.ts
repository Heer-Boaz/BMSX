import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Navigate and edit through visible controls. Guest access below is read-only:
 * no model edits, clipboard injection, runtime calls or alternative cart. */
async function openScene(test: StudioFixture, name: 'title' | 'hangar') {
	await test.press('ControlLeft', 'Comma');
	await test.press('ControlLeft', 'KeyA');
	await test.press('Backspace');
	for (const character of `scenes/${name}`) {
		await test.press(character === '/' ? 'Slash' : `Key${character.toUpperCase()}`);
	}
	const picker = test.ide.editor.quickInput;
	check(picker.model.list.rows[0].item.label === `scenes/${name}.lua`, 'file picker finds the actual scene source');
	await test.press('Enter');
	await test.until(() => getActiveTab().kind === 'code_editor'
		&& getActiveTab().resource?.path === `scenes/${name}.lua`, 'file picker opens scene code');
	const scene = await openSceneEditor(test);
	check(scene.outline.roots.length === 1 && scene.outline.roots[0].children.length === 3,
		`${name}: Studio exposes the three separately authored members`);
	return scene;
}

export async function runStudioNemesisScenes(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, click, until, runMenuCommand, cycles, title } = test;
	const world = () => guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const space = () => guest.formatValue(guest.readStringMember(world(), 'active_space_id'));
	const presentation = () => guest.readStringMember(title(), 'presentation');
	const member = (name: string) => guest.readStringMember(presentation(), name);
	const reachTitle = async () => {
		for (const phase of ['intro', 'story']) {
			if (space() === phase) {
				await press('Space');
				await until(() => space() !== phase, `ordinary confirm leaves ${phase}`);
			}
		}
		await until(() => space() === 'title' && presentation() !== null, 'normal game input reaches title scene');
	};
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'boot the shipped Nemesis cart');
	await reachTitle();
	const oldTitle = title();
	const originalSelector = member('selector');
	check(guest.readStringMember(originalSelector, 'x') === 80, 'unmodified selector starts at its authored position');
	await test.capture?.('title-before');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const menu = await openScene(test, 'title');
	await selectMember(test, menu, 1);
	check(menu.properties[0].value === 80, 'visible selector property matches the unmodified game');
	await click(menu.properties[0].bounds);
	await press('ControlLeft', 'KeyA');
	await press('Digit8'); await press('Digit8'); await press('Enter');
	check(menu.properties[0].value === 88, 'pointer and typing change selector x');
	await press('ControlLeft', 'KeyZ');
	check(menu.properties[0].value === 80, 'ordinary Undo restores authored placement');
	await press('ControlLeft', 'KeyY');
	check(menu.properties[0].value === 88, 'ordinary Redo restores the edit');
	await press('ControlLeft', 'KeyS');
	await until(() => !menu.workingCopy.dirty, 'save title through the product workspace API');
	check(guest.readStringMember(originalSelector, 'x') === 80,
		'source editing and saving do not secretly patch a live object');
	await test.capture?.('title-editor');
	const hangar = await openScene(test, 'hangar');
	await selectMember(test, hangar, 1);
	check(hangar.properties[0].value === 48 && hangar.properties[1].value === 129, 'ship has independently editable scene placement');
	for (const [index, keys] of [[0, ['Digit5', 'Digit6']], [1, ['Digit1', 'Digit2', 'Digit5']]] as const) {
		await click(hangar.properties[index].bounds);
		await press('ControlLeft', 'KeyA');
		for (const key of keys) await press(key);
		await press('Enter');
	}
	await press('ControlLeft', 'KeyS');
	await until(() => !hangar.workingCopy.dirty, 'save hangar through the product workspace API');
	await test.capture?.('hangar-editor');
	await runMenuCommand('reboot');
	await until(() => tasks.ready && harness.isCartActive() && world() !== null
		&& (guest.readStringMember(world(), '_objects') as Table).arrayLength >= 4
		&& !runtime.completionCallPending(), 'Reboot installs the saved scene sources and publishes the root composition');
	check(title() !== oldTitle, 'cold reboot created a fresh controller');
	await reachTitle();
	check(guest.readStringMember(member('selector'), 'x') === 88,
		'the actual rebooted title consumes the edited scene, not the old placement');
	await test.capture?.('title-after');
	await press('Space');
	await until(() => presentation() !== null && member('ship') !== null, 'confirmation naturally enters the hangar scene');
	check(guest.readStringMember(member('ship'), 'x') === 56
		&& guest.readStringMember(member('ship'), 'start_y') === 125,
		'the actual takeoff uses both edited ship coordinates');
	await until(() => guest.readStringMember(member('ship'), 'y') === 69,
		'lift animates relative to edited y=125, reaching 125-56');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await press('ControlRight', 'ShiftRight');
	await test.capture?.('hangar-after');
	check(guest.readStringMember(member('ship'), 'x') === 56 && guest.readStringMember(member('ship'), 'y') === 69,
		'game view displays the authored placement during the takeoff sequence');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	check(!ide.editor.isActive, 'Run Resume returns directly to gameplay');
	await until(() => space() === 'main', 'takeoff completes into gameplay');
	check(presentation() === null, 'gameplay releases the presentation scene');
	await test.capture?.('gameplay');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const reopened = await openScene(test, 'hangar');
	await selectMember(test, reopened, 1);
	check(reopened.properties[0].value === 56 && reopened.properties[1].value === 125,
		'Studio readback after reboot and gameplay retains the saved placement');
	console.info('STUDIO: Nemesis title/hangar authoring, reboot, relative animation and gameplay PASS');
	return { hostFrames: test.observations.hostFrames, selectorX: 88, shipX: 56, shipY: 69 };
}
