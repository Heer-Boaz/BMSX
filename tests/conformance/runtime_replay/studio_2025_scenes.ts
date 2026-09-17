import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { openScene, editPosition } from './studio_scene_authoring';
import { selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Real cart, visible editor commands and keyboard input. Guest inspection is
 * read-only; the game receives new placements only through Save and Reboot. */
export async function runStudio2025Scenes(test: StudioFixture) {
	const { guest, runtime, press, until, runMenuCommand } = test;
	const registered = (id: string) => {
		const registry = guest.global(buildModuleExportSlotName('cartlib/registry', []));
		return guest.readStringMember(guest.readStringMember(registry, '_entries_by_id'), id);
	};
	const director = () => registered('p3.director');
	await until(() => director() !== null && !runtime.completionCallPending(), 'boot the actual 2025 story');
	const original = registered('p3.text.main');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await editPosition(test, await openScene(test, 'dialogue', 4), 1, 1, 104);
	await editPosition(test, await openScene(test, 'combat', 7), 0, 0, 216);
	await editPosition(test, await openScene(test, 'transition', 6), 5, 1, 96);
	check(guest.readStringMember(original, 'y') === 96, 'saving source does not move the live text');
	await test.capture?.('scene-editor');
	await runMenuCommand('reboot');
	await until(() => test.tasks.ready && test.harness.isCartActive()
		&& director() !== null && registered('p3.text.main') !== original
		&& !runtime.completionCallPending(), 'saved scene sources boot a fresh story');
	const text = registered('p3.text.main');
	check(guest.readStringMember(text, 'y') === 104
		&& guest.readStringMember(guest.readStringMember(text, 'dimensions'), 'top') === 104,
		'text layout uses the edited scene position');
	check(guest.readStringMember(registered('p3.combat.monster'), 'home_x') === 216,
		'combat animation anchor comes from the saved scene');
	check(guest.readStringMember(registered('p3.text.transition'), 'y') === 96,
		'the independently placed transition caption uses its saved position');
	await press('KeyX');
	await until(() => guest.formatValue(guest.readStringMember(director(), 'node_id')) === 'overgang_monday',
		'normal confirm starts the first transition');
	await test.capture?.('transition');
	await until(() => guest.formatValue(guest.readStringMember(director(), 'node_id')) === 'klas',
		'the real transition completes into dialogue');
	await until(() => guest.readStringMember(text, '_has_visible_glyphs') === true,
		'ordinary story playback renders text at its edited position');
	await test.capture?.('dialogue');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const reopened = await openScene(test, 'dialogue', 4);
	await selectMember(test, reopened, 1);
	check(reopened.properties[1].value === 104, 'saved text placement survives gameplay and reopening');
	console.info('STUDIO: 2025 dialogue/combat/transition scene authoring, save, reboot and playback PASS');
	return { hostFrames: test.observations.hostFrames, textY: 104, monsterX: 216 };
}
