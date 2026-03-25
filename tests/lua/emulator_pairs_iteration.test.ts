import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Table, type Value } from '../../src/bmsx/emulator/cpu';

function keyLabel(value: Value): string {
	if (value === true) {
		return 'true';
	}
	if (value === false) {
		return 'false';
	}
	return String(value);
}

test('pairs cursor iteration survives deleting the current key', () => {
	const target = new Table(1, 4);
	target.set(1, 11);
	target.set(true, 22);
	target.set(false, 33);

	const state = new Table(4, 0);
	state.set(1, target);
	state.set(2, 0);
	state.set(3, 0);
	state.set(4, null);

	const visited: string[] = [];
	while (true) {
		const entry = target.nextEntryFromCursor(
			state.get(2) as number,
			state.get(3) as number,
			state.get(4),
		);
		if (entry === null) {
			break;
		}
		state.set(2, entry[0]);
		state.set(3, entry[1]);
		state.set(4, entry[1] === 0 ? null : entry[2]);
		visited.push(keyLabel(entry[2]));
		target.set(entry[2], null);
	}

	visited.sort();
	assert.deepEqual(visited, ['1', 'false', 'true']);
	assert.equal(
		target.nextEntryFromCursor(
			state.get(2) as number,
			state.get(3) as number,
			state.get(4),
		),
		null,
	);
});
