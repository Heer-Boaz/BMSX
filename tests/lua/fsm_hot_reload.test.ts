import './test_setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ActiveStateMachines, StateDefinitions, rebuildStateMachine, applyPreparedStateMachine } from '../../src/bmsx/fsm/fsmlibrary';
import { State } from '../../src/bmsx/fsm/state';
import type { StateMachineBlueprint, Stateful } from '../../src/bmsx/fsm/fsmtypes';
import { Registry } from '../../src/bmsx/core/registry';

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

	const definitionA = rebuildStateMachine(machineId, blueprintA);
	assert.ok(StateDefinitions[machineId], 'initial FSM definition must register');

	const targetId = `target_${machineId}`;
	const controllerStub = {
		_subscribedCache: new Set<string>(),
		bind(): void { /* no-op */ },
		auto_dispatch(): void { /* no-op */ },
	} as Record<string, any>;

	const target = {
		id: targetId,
		eventhandling_enabled: true,
		sc: controllerStub,
		bind(): void { /* no-op */ },
		dispose(): void { /* no-op */ },
	} as unknown as Stateful;

	registry.register(target);

	const root = State.create(machineId, target.id);
	const idle = root.states?.['#idle'];
	assert.ok(idle, 'idle state should exist after construction');
	ActiveStateMachines.set(machineId, [root]);

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
	applyPreparedStateMachine(machineId, blueprintB, { force: true });

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
