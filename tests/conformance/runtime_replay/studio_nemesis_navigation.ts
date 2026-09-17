import type { Table } from '../../../machine/ts/machine/cpu/table';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { check, type StudioFixture } from './studio_fixture';

export function nemesisTitleState(test: StudioFixture) {
	const machines = test.guest.readStringMember(
		test.guest.readStringMember(test.title(), 'state_machines'), '_machines') as Table;
	return test.guest.formatValue(test.guest.readStringMember(machines.get(1), 'current_id'));
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
	await until(() => space() === 'title' && guest.readStringMember(test.title(), 'presentation') !== null,
		'normal game input reaches title scene');
	check(nemesisTitleState(test) === 'idle', 'title waits for a separate gameplay confirmation');
}
