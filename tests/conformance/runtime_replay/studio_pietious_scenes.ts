import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { openScene, editPosition, editOption, focusOption, typeSourceText } from './studio_scene_authoring';
import { selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';
import { testPietiousRoomReload } from './studio_pietious_room_reload';

/** Visible editing, Save/Reboot and Hot Resume with explicit room recreation.
 * Registry reads observe the resulting objects without mutating them. */
export async function runStudioPietiousScenes(test: StudioFixture) {
	const { guest, runtime, press, until, runMenuCommand } = test;
	const registered = (id: string) => {
		const registry = guest.global(buildModuleExportSlotName('cartlib/registry', []));
		if (registry === null) return null; // The BIOS is still booting the cart.
		const entries = guest.readStringMember(registry, '_entries_by_id');
		return entries === null ? null : guest.readStringMember(entries, id);
	};
	const roomMember = (key: string) => {
		const room = guest.readStringMember(registered('c'), 'room');
		const scene = guest.readStringMember(room, 'scene');
		return guest.readStringMember(guest.readStringMember(scene, 'members'), key);
	};
	const world = () => guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const space = () => guest.formatValue(guest.readStringMember(world(), 'active_space_id'));
	const playing = () => space() === 'main' && guest.readStringMember(world(), 'gameplay_clock_running') === true;
	// Gameplay samples at the cart cadence, unlike the IDE's host-frame input.
	// Hold a press through the requested transition; release across a complete
	// guest update before pressing the same key again.
	const act = async (key: string, predicate: () => boolean, message: string) => {
		test.setKey(key, true);
		await until(predicate, message);
		test.setKey(key, false);
		const releaseEnd = test.cycles() + runtime.timing.cpuHz * runtime.timing.frameDurationMs * 2 / 1000;
		await until(() => test.cycles() >= releaseEnd, `${key}: release reaches the cart`);
	};
	await until(() => registered('d') !== null && !runtime.completionCallPending(), 'boot the actual Pietious intro');
	const originalLogo = registered('intro.logo');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const intro = await openScene(test, 'intro', 2);
	await editPosition(test, intro, 1, 0, 48);
	await editOption(test, intro, 0, 'color', '0xff305070');
	await press('ControlLeft', 'KeyZ');
	check(intro.workingCopy.buffer.getText().includes('color = 0xffffffff'), 'document Undo restores the authored color');
	await press('ControlLeft', 'KeyY');
	await press('ControlLeft', 'KeyS');
	await until(() => !intro.workingCopy.dirty, 'save the redone color');
	await editOption(test, intro, 1, 'region.width', '160');
	await test.capture?.('options-editor');
	const gameplay = await openScene(test, 'gameplay', 2);
	await editPosition(test, gameplay, 0, 0, 168);
	await selectMember(test, gameplay, 1);
	await test.click(gameplay.actionBar.items.find(item => item.command === 'sceneEditor.moveMemberUp')!.bounds);
	check(gameplay.outline.roots[0].children[0].element.label === "'hud'", 'Studio moved HUD before the player');
	await press('ControlLeft', 'KeyS');
	await until(() => !gameplay.workingCopy.dirty, 'persist the reordered gameplay members');
	await editPosition(test, await openScene(test, 'rooms/room_002', 5), 3, 0, 112);
	const effects = await openScene(test, 'effects', 4);
	await editPosition(test, effects, 3, 0, 16);
	await editOption(test, effects, 3, 'text', "'Scene victory!'");
	const visibility = await focusOption(test, effects, 0, 'visible');
	await typeSourceText(test, 'true');
	await press('Enter');
	check(visibility.field.text === 'true', 'boolean options accept ordinary Lua values');
	await press('ControlLeft', 'KeyZ');
	check(effects.optionProperties.find(property => property.label === 'visible')!.sourceText === 'false', 'Undo restores the hidden effect before gameplay');
	await press('ControlLeft', 'KeyS');
	await until(() => !effects.workingCopy.dirty, 'save the original effect visibility');
	await editPosition(test, await openScene(test, 'inventory', 12), 3, 0, 136);
	check(guest.readStringMember(originalLogo, 'x') === 40, 'saving placement leaves the outgoing world untouched');
	await test.capture?.('inventory-editor');
	await runMenuCommand('reboot');
	await until(() => test.tasks.ready && test.harness.isCartActive()
		&& registered('d') !== null && registered('intro.logo') !== originalLogo
		&& !runtime.completionCallPending(), 'saved scenes boot a new Pietious world');
	check(guest.readStringMember(registered('intro.logo'), 'x') === 48, 'intro uses the edited logo anchor');
	const backgroundColor = guest.readStringMember(registered('intro.background'), 'color');
	check(backgroundColor === 0xff305070, `scene construction uses the edited background color: actual=${backgroundColor}`);
	check(guest.readStringMember(guest.readStringMember(registered('pietolon'), 'status'), 'spawn_x') === 168, 'respawn anchor comes from the player scene');
	check(guest.readStringMember(registered('effects.victory_caption'), 'x') === 16,
		'the director retains the edited victory caption placement');
	check(guest.formatValue(guest.readStringMember(registered('effects.victory_caption'), 'text')) === 'Scene victory!',
		'caption construction uses the edited string expression');
	const logo = guest.readStringMember(registered('intro.logo'), 'sprite_component');
	check(guest.readStringMember(logo, 'region_width') === 160, 'nested region option reaches the actual sprite component');
	await until(() => guest.readStringMember(logo, 'visible') === true
		&& (guest.readStringMember(logo, 'region_height') as number) >= 24, 'the edited logo reveals normally');
	await test.capture?.('intro');
	await act('AltRight', () => space() === 'narrative', 'normal confirm enters the story');
	await act('AltRight', () => space() === 'title', 'normal confirm and the audio fade reach the title');
	await act('AltRight', playing, 'the title starts actual gameplay');
	check(guest.readStringMember(registered('pietolon'), 'x') === 168, 'in-game restart retains the authored starting point');
	test.setKey('ArrowRight', true);
	await until(() => guest.readStringMember(registered('c'), 'current_room_number') === 2,
		'walk from the initial room into the edited room');
	test.setKey('ArrowRight', false);
	await until(() => playing() && roomMember('rock_002_01') !== null, 'room admission publishes its placed actors');
	check(guest.readStringMember(roomMember('rock_002_01'), 'x') === 112, 'room admission uses the saved rock placement');
	// State admission precedes draw submission. Advance one complete two-VBlank
	// update/render pair and its scanout before capturing the game view.
	for (let frame = 0; frame < 4; frame += 1) await test.frame();
	await test.capture?.('room');
	await testPietiousRoomReload(test, () => registered('c'), roomMember);
	await act('ShiftLeft', () => space() === 'item', 'ordinary inventory input opens the composed screen');
	const halo = registered('inventory.halo');
	check(guest.readStringMember(halo, 'x') === 136 && guest.readStringMember(halo, 'visible') === true,
		'inventory entry preserves the independently authored halo placement');
	for (let frame = 0; frame < 4; frame += 1) await test.frame();
	await test.capture?.('inventory');
	await act('Enter', () => playing() && guest.readStringMember(registered('c'), 'current_room_number') === 1,
		'Enter activates the real halo and returns to the first room');
	check(guest.readStringMember(registered('pietolon'), 'x') === 168, 'halo returns to the authored player anchor');
	check(roomMember('rock_002_01') === null, 'room departure disposes the outgoing scene actor');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const reopened = await openScene(test, 'rooms/room_002', 5);
	await selectMember(test, reopened, 3);
	check(reopened.properties[0].value === 120, 'refreshed room placement survives gameplay and reopening');
	console.info('STUDIO: Pietious named-member reorder, option/position authoring, save, reboot, walking and Enter/halo PASS');
	return { hostFrames: test.observations.hostFrames, logoX: 48, rockX: 120, playerX: 168, haloX: 136 };
}
