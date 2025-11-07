import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rebuildStateMachine, StateDefinitions, migrateMachineDiff } from '../../src/bmsx/fsm/fsmlibrary';
import { State } from '../../src/bmsx/fsm/state';
import type { StateMachineBlueprint, Stateful } from '../../src/bmsx/fsm/fsmtypes';
import type { StateMachineController } from '../../src/bmsx/fsm/fsmcontroller';
import { Registry } from '../../src/bmsx/core/registry';

class DummyTarget implements Stateful {
	public eventhandling_enabled = true;
	public sc: StateMachineController;

	constructor(public readonly id: string) {
		this.sc = {} as StateMachineController;
	}

	bind(): void { /* no-op */ }
	dispose(): void { /* no-op */ }
}

function cleanupDefinitions(machineId: string): void {
	delete StateDefinitions[machineId];
	const prefix = `${machineId}:/`;
	for (const key of Object.keys(StateDefinitions)) {
		if (key.startsWith(prefix)) delete StateDefinitions[key];
	}
}

test('active FSM instances adopt reloaded tape data, ticks, and markers', () => {
	const registry = Registry.instance;
	const initialRegistryIds = new Set(registry.getRegisteredEntityIds());

	const machineId = `fsm_hot_reload_${Date.now()}`;
	const blueprintA: StateMachineBlueprint = {
		id: machineId,
		initial: '#idle',
		states: {
			'#idle': {
				enable_tape_autotick: true,
				ticks2advance_tape: 10,
				tape_data: ['a', 'b', 'c'],
			},
		},
	};
	const idleBlueprintA = blueprintA.states!['#idle']!;
	assert.ok(rebuildStateMachine(machineId, blueprintA), 'initial FSM definition must register');

	const target = new DummyTarget(`target_${machineId}`);
	registry.register(target);

	const root = State.create(machineId, target.id);
	const idle = root.states?.['#idle'];
	assert.ok(idle, 'idle state should exist after construction');

	const firstThreshold = (idle as any)._tapeTickThreshold;
	assert.equal(
		firstThreshold,
		idleBlueprintA.ticks2advance_tape!,
		'initial tape tick window should match blueprint',
	);

	const blueprintB: StateMachineBlueprint = {
		id: machineId,
		initial: '#idle',
		states: {
			'#idle': {
				enable_tape_autotick: true,
				ticks2advance_tape: 4,
				tape_data: ['x', 'y', 'z', 'w'],
			},
		},
	};
	const idleBlueprintB = blueprintB.states!['#idle']!;
	const previousDefinition = StateDefinitions[machineId];
	assert.ok(previousDefinition, 'previous definition should be available before rebuild');
	const nextDefinition = rebuildStateMachine(machineId, blueprintB);

	migrateMachineDiff(root, previousDefinition, nextDefinition);

	const refreshedThreshold = (idle as any)._tapeTickThreshold;
	assert.equal(
		refreshedThreshold,
		idleBlueprintB.ticks2advance_tape!,
		'threshold should refresh after hot reload',
	);
	assert.deepEqual(
		idle.tape,
		idleBlueprintB.tape_data!,
		'tape payload should refresh after hot reload',
	);

	root.dispose();
	for (const id of registry.getRegisteredEntityIds()) {
		if (!initialRegistryIds.has(id)) registry.deregister(id);
	}
	cleanupDefinitions(machineId);
});
