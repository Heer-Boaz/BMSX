import { PSX_MACHINE_SPEC } from '../../machine/ts/machine/model_registry';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartridgeSlots } from '../helpers/cartridge';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { Value } from '../../machine/ts/machine/cpu/value';

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
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const target = cpu.createTable(1, 4);
	target.set(1, 11);
	target.set(true, 22);
	target.set(false, 33);

	const state = cpu.createTable(4, 0);
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
