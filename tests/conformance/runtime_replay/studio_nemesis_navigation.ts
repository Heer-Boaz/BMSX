import { asTable, valueNil } from '../../../machine/ts/machine/cpu/value';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { check, type StudioFixture } from './studio_fixture';

/** Concrete gameplay lookup belongs to the Nemesis workflows, not Studio setup. */
export function nemesisTitle(test: StudioFixture) {
	const { guest } = test;
	const world = guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const objects = asTable(guest.readStringMember(world, '_objects'), guest.cpu.gc);
	for (let index = 1; index <= objects.length(); index++) {
		const object = objects.getInteger(index);
		if (guest.formatValue(guest.readStringMember(object, 'id')) === 'nemesis_s.title_screen') return object;
	}
	throw new Error('real Nemesis title actor missing');
}

export function nemesisTitleState(test: StudioFixture) {
	const machines = asTable(test.guest.readStringMember(
		test.guest.readStringMember(nemesisTitle(test), 'state_machines'), '_machines'), test.guest.cpu.gc);
	return test.guest.formatValue(test.guest.readStringMember(machines.getInteger(1), 'current_id'));
}

/** Confirm only the presentation actually on screen; never queue a title Start. */
export async function reachNemesisTitle(test: StudioFixture) {
	const { guest, until, setKey, releaseGuestKey } = test;
	const world = () => guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const space = () => guest.formatValue(guest.readStringMember(world(), 'active_space_id'));
	for (const phase of ['intro', 'story']) {
		if (space() === phase) {
			setKey('Space', true);
			await until(() => space() !== phase, `ordinary confirm leaves ${phase}`);
			await releaseGuestKey('Space');
		}
	}
	await until(() => space() === 'title' && guest.readStringMember(nemesisTitle(test), 'presentation') !== valueNil(),
		'normal game input reaches title scene');
	check(nemesisTitleState(test) === 'idle', 'title waits for a separate gameplay confirmation');
}
