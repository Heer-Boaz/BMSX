import type { ActorNode } from './runtime';

export type ActorAction = { readonly label: string; readonly method: string; readonly description: string; readonly payload?: string; readonly keyed?: boolean };

export function actorActions(node: ActorNode): readonly ActorAction[] {
	if (node.kind === 'effect') return node.active ? ACTIVE_EFFECT_OPERATIONS : EFFECT_OPERATIONS;
	if (node.kind === 'state' && node.path === undefined) return NO_OPERATIONS;
	return OPERATIONS[node.kind];
}

const NO_OPERATIONS: readonly ActorAction[] = [];
const EFFECT_OPERATIONS: readonly ActorAction[] = [
	{ label: 'Trigger with payload', method: 'trigger', payload: '{}', keyed: true, description: 'Runs trigger gates and cooldown' },
	{ label: 'Activate', method: 'activate', keyed: true, description: 'Adds one activation' },
];
const ACTIVE_EFFECT_OPERATIONS: readonly ActorAction[] = [...EFFECT_OPERATIONS,
	{ label: 'Deactivate', method: 'deactivate', keyed: true, description: 'Removes one activation' }];
const OPERATIONS: Readonly<Record<ActorNode['kind'], readonly ActorAction[]>> = {
	actor: [
		{ label: 'Set position', method: 'set_pos', payload: '0, 0, 0', description: 'x, y, z in cart world units' },
		{ label: 'Add tag', method: 'add_tag', payload: "'tag'", description: '' },
		{ label: 'Remove tag', method: 'remove_tag', payload: "'tag'", description: '' },
		{ label: 'Despawn', method: 'mark_for_disposal', description: 'World-owned disposal and component teardown' },
	],
	state: [{ label: 'Go to state', method: 'transition_to', description: 'Requests a state path; lifecycle guards still apply' }],
	tree: [
		{ label: 'Start', method: 'start', description: '' },
		{ label: 'Stop', method: 'stop', description: '' },
		{ label: 'Request execution', method: 'request_execution', description: 'Schedules the next BT evaluation' },
	],
	timeline: [
		{ label: 'Play from start', method: 'play', keyed: true, description: '' },
		{ label: 'Stop', method: 'stop', keyed: true, description: '' },
		{ label: 'Scrub time (ms)', method: 'scrub_time', payload: '0', keyed: true, description: 'Samples without event replay' },
		{ label: 'Seek time (ms)', method: 'seek_time', payload: '0', keyed: true, description: 'Uses timeline seek semantics' },
	],
	component: NO_OPERATIONS, machine: NO_OPERATIONS, effect: EFFECT_OPERATIONS,
};
