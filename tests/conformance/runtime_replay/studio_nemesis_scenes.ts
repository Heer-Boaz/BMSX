import { openScene, editPosition } from './studio_scene_authoring';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

export async function runStudioNemesisScenes(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, click, until, runMenuCommand, cycles, title } = test;
	const world = () => guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const space = () => guest.formatValue(guest.readStringMember(world(), 'active_space_id'));
	const presentation = () => guest.readStringMember(title(), 'presentation');
	const member = (name: string) => guest.readStringMember(presentation(), name);
	const registered = (id: string) => {
		const registry = guest.global(buildModuleExportSlotName('cartlib/registry', []));
		return guest.readStringMember(guest.readStringMember(registry, '_entries_by_id'), id);
	};
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
	await editPosition(test, await openScene(test, 'intro', 2), 1, 0, 44);
	await editPosition(test, await openScene(test, 'story', 4), 1, 1, 148);
	await editPosition(test, await openScene(test, 'end_demo', 3), 1, 1, 10);
	await editPosition(test, await openScene(test, 'gameplay', 6), 3, 0, 88);
	await editPosition(test, await openScene(test, 'stage_actors', 179), 0, 1, 24);
	await test.capture?.('stage-actors-editor');
	await runMenuCommand('reboot');
	await until(() => tasks.ready && harness.isCartActive() && world() !== null
		&& (guest.readStringMember(world(), '_objects') as Table).arrayLength >= 4
		&& !runtime.completionCallPending(), 'Reboot installs the saved scene sources and publishes the root composition');
	check(title() !== oldTitle, 'cold reboot created a fresh controller');
	const intro = guest.readStringMember(registered('nemesis_s.intro'), 'presentation');
	check(guest.readStringMember(guest.readStringMember(intro, 'logo'), 'x') === 44,
		'rebooted intro consumes the separately authored logo placement');
	await press('Space');
	await until(() => space() === 'story'
		&& guest.readStringMember(registered('nemesis_s.story'), 'presentation') !== null
		&& !runtime.completionCallPending(), 'normal confirm admits the edited story composition');
	const story = guest.readStringMember(registered('nemesis_s.story'), 'presentation');
	check(guest.readStringMember(guest.readStringMember(story, 'primary_caption'), 'y') === 148,
		'normal story playback consumes the edited caption position');
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
	const player = registered('nemesis_s.player.1');
	check(guest.readStringMember(guest.readStringMember(player, 'start_point'), 'x') === 88,
		'player admission and respawn share the edited scene start point');
	const stage = registered('nemesis_s.stage');
	const firstSpawn = (guest.readStringMember(stage, 'actor_spawns') as Table).get(1);
	check(guest.readStringMember(guest.readStringMember(guest.readStringMember(firstSpawn, 'options'), 'pos'), 'y') === 24,
		'streaming admission consumes the actor placement edited in Studio');
	await until(() => (guest.readStringMember(stage, 'actor_spawn_index') as number) > 1
		&& !runtime.completionCallPending(), 'ordinary play reaches the edited enemy formation');
	const formation = guest.readStringMember(guest.readStringMember(firstSpawn, 'options'), 'formation');
	const objects = guest.readStringMember(world(), '_objects') as Table;
	let editedEnemy: Table | null = null;
	for (let index = 1; index <= objects.arrayLength; index += 1) {
		const object = objects.get(index);
		if (guest.readStringMember(object, 'formation') === formation
			&& guest.readStringMember(object, 'y') === 24) editedEnemy = object as Table;
	}
	check(editedEnemy !== null, 'the actual admitted enemy uses the scene position edited in Studio');
	await until(() => (guest.readStringMember(editedEnemy, 'x') as number) < 240,
		'the edited enemy moves from its admission gate into the visible playfield');
	await test.capture?.('gameplay');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const reopened = await openScene(test, 'hangar');
	await selectMember(test, reopened, 1);
	check(reopened.properties[0].value === 56 && reopened.properties[1].value === 125,
		'Studio readback after reboot and gameplay retains the saved placement');
	const endDemo = await openScene(test, 'end_demo');
	await selectMember(test, endDemo, 1);
	check(endDemo.properties[1].value === 10, 'end-demo scene edit persists through reboot and gameplay');
	console.info('STUDIO: Nemesis presentation/gameplay/actor authoring, reboot and relative animation PASS');
	return { hostFrames: test.observations.hostFrames, selectorX: 88, shipX: 56, shipY: 69 };
}
