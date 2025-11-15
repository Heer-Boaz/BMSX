import './test_setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ActiveStateMachines, StateDefinitions, applyPreparedStateMachine, rebuildStateMachine } from '../../src/bmsx/fsm/fsmlibrary';
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

test('active FSM instances adopt reloaded timeline definitions', () => {
	const registry = Registry.instance;
	const initialRegistryIds = new Set(registry.getRegisteredEntityIds());

	const machineId = `fsm_hot_reload_${Date.now()}`;
	const blueprintA: StateMachineBlueprint = {
		id: machineId,
		initial: '#idle',
		states: {
			'#idle': {
				timeline: {
					id: `${machineId}.idle`,
					frames: ['a', 'b', 'c'],
					ticksPerFrame: 2,
				},
			},
		},
	};
	rebuildStateMachine(machineId, blueprintA);

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

	const blueprintB: StateMachineBlueprint = {
		id: machineId,
		initial: '#idle',
		states: {
			'#idle': {
				timeline: {
					id: `${machineId}.idle`,
					frames: ['x', 'y', 'z', 'w'],
					ticksPerFrame: 4,
				},
			},
		},
	};
	const idleBlueprintB = blueprintB.states!['#idle']!;
	applyPreparedStateMachine(machineId, blueprintB, { force: true });

	assert.deepEqual(
		idle.definition.timeline,
		idleBlueprintB.timeline,
		'timeline payload should refresh after hot reload',
	);

	root.dispose();
	for (const id of registry.getRegisteredEntityIds()) {
		if (!initialRegistryIds.has(id)) registry.deregister(id);
	}
	cleanupDefinitions(machineId);
});
