import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { Value } from '../../../../machine/ts/machine/cpu/value';
import { createFsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

export type ActorNode = {
	readonly kind: 'actor' | 'component' | 'machine' | 'state' | 'tree' | 'timeline' | 'effect';
	readonly hashId: number;
	readonly name: string;
	readonly prefix: string;
	readonly label: string;
	readonly children: ActorNode[];
	/** Borrowed only between CPU slices. Display identity survives, guest handles do not. */
	value: Table | null;
	receiver: Table | null;
	component: Table | null;
	key: Value;
	active: boolean;
	readonly stateKeys: readonly string[];
	readonly path?: string;
};

export function runtimeWorld(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): Table | undefined {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	return world.kind === 'value' && world.value !== null ? world.value as Table : undefined;
}

/** The ordinary global registerfile is shared: mounted ROMs are not separate worlds. */
export function readRuntimeActors(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	if (world.kind === 'unavailable') return { domain, status: world.reason } as const;
	if (world.value === null) return { domain, status: 'uninitialized' } as const;
	return { domain, status: 'available', objects: guest.readStringMember(world.value, '_objects') as Table } as const;
}

export function findRuntimeActor(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, hashId: number): Table | undefined {
	const world = runtimeWorld(sources, guest, domain);
	if (world === undefined) return;
	const objects = guest.readStringMember(world, '_objects') as Table;
	for (let i = 1; i <= objects.arrayLength; i += 1) {
		const actor = objects.getInteger(i) as Table;
		if (actor.hashId === hashId) return actor;
	}
}

const COMPONENT_TYPES = [
	['cartlib/fsm/fsm_component', 'FSM'], ['cartlib/behaviour_tree/bt_component', 'BT'],
	['cartlib/timeline/timeline_component', 'TIMELINES'], ['cartlib/actioneffects/actioneffect_component', 'ACTIONEFFECTS'],
] as const;
const NO_KEYS: readonly string[] = [];

/** Reconcile one actor by guest identity. Ordinary state changes retain nodes, labels and rows. */
export class ActorRuntimeTree {
	public readonly roots: ActorNode[] = [];
	private changed = false;
	private readonly kinds: number[] = [];
	public update(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, actor: Table | undefined): boolean {
		this.changed = false;
		if (actor === undefined) {
			this.finishChildren(null, 0);
		} else {
			const id = guest.readStringMember(actor, 'id');
			const root = this.node(guest, null, 0, 'actor', actor, actor, null, id, guest.isTruthy(guest.readStringMember(actor, 'active')));
			const components = guest.readStringMember(actor, '_components') as Table;
			this.kinds.length = components.arrayLength + 1;
			this.kinds.fill(-1);
			const classes = guest.readStringMember(actor, '_components_by_class') as Table;
			for (let i = 0; i < COMPONENT_TYPES.length; i += 1) {
				const type = readRuntimeLuaModuleExport(sources, guest, domain, COMPONENT_TYPES[i][0]);
				if (type.kind !== 'value' || type.value === null) continue;
				const bucket = classes.get(type.value) as Table | null;
				if (bucket !== null) for (let j = 1; j <= bucket.arrayLength; j += 1) {
					const index = guest.readStringMember(bucket.getInteger(j), '_parent_component_index') as number;
					this.kinds[index] = i;
				}
			}
			for (let i = 1; i <= components.arrayLength; i += 1) {
				const component = components.getInteger(i) as Table;
				const type = this.kinds[i];
				const id = guest.readStringMember(component, type === 1 ? 'tree_id' : 'id');
				const branch = this.node(guest, root, i - 1, type === 1 ? 'tree' : 'component', component, component, component, id,
					guest.isTruthy(guest.readStringMember(component, 'enabled')) && root.active,
					type === -1 ? 'COMPONENT' : COMPONENT_TYPES[type][1]);
				let count = 0;
				if (type === 0) {
					guest.visitTableEntries(guest.readStringMember(component, '_machines_by_id'), (key, machine) => {
						const node = this.node(guest, branch, count++, 'machine', machine as Table, machine as Table, component, key,
							branch.active && guest.isTruthy(guest.readStringMember(component, '_started')));
						this.states(guest, node, machine as Table, component);
					});
				} else if (type === 2 || type === 3) {
					guest.visitTableEntries(guest.readStringMember(component, type === 2 ? '_entries_by_id' : 'effects'), (key, value) => {
						this.node(guest, branch, count++, type === 2 ? 'timeline' : 'effect', value as Table, component, component, key,
							type === 2 ? guest.isTruthy(guest.readStringMember(value, 'playing')) : (guest.readStringMember(value, 'active_count') as number) > 0);
					});
				}
				this.finishChildren(branch, count);
			}
			this.finishChildren(root, components.arrayLength);
			this.finishChildren(null, 1);
		}
		return this.changed;
	}

	private node(guest: SuspendedGuestSession, parent: ActorNode | null, index: number, kind: ActorNode['kind'], value: Table, receiver: Table,
		component: Table | null, key: Value, active: boolean, prefix = ''): ActorNode {
		const siblings = parent === null ? this.roots : parent.children;
		let node = siblings[index];
		const name = guest.formatValue(key);
		if (node === undefined || node.hashId !== value.hashId || node.kind !== kind || node.name !== name || node.prefix !== prefix) {
			// Changed membership, classification or key retires the old branch, including captured operations.
			releaseActorBorrows(siblings, index);
			siblings.length = index;
			const stateKeys = kind === 'state' ? [...parent!.stateKeys, name] : NO_KEYS;
			const label = prefix === '' ? name : `${prefix} ${name}`;
			node = { kind, hashId: value.hashId, name, prefix, label, children: [], value, receiver, component, key, active, stateKeys,
				path: kind === 'state' ? createFsmStatePath(true, 0, stateKeys)?.text : undefined };
			siblings.push(node);
			this.changed = true;
		} else {
			node.value = value; node.receiver = receiver; node.component = component; node.key = key; node.active = active;
		}
		return node;
	}

	private finishChildren(parent: ActorNode | null, count: number): void {
		const children = parent === null ? this.roots : parent.children;
		if (children.length === count) return;
		releaseActorBorrows(children, count);
		children.length = count;
		this.changed = true;
	}

	public release(): void { releaseActorBorrows(this.roots, 0); }
	public dispose(): void { this.release(); this.roots.length = 0; }

	private states(guest: SuspendedGuestSession, parent: ActorNode, machine: Table, component: Table): void {
		const state = parent.value!;
		const children = guest.readStringMember(state, 'states') as Table;
		const ids = guest.readStringMember(state, 'state_ids') as Table;
		const current = guest.readStringMember(state, 'current_id');
		for (let i = 1; i <= ids.arrayLength; i += 1) {
			const id = ids.getInteger(i);
			const child = children.get(id) as Table;
			const active = parent.active && (current === id || guest.isTruthy(guest.readStringMember(guest.readStringMember(child, 'definition'), 'is_concurrent')));
			const node = this.node(guest, parent, i - 1, 'state', child, machine, component, id, active);
			this.states(guest, node, machine, component);
		}
		this.finishChildren(parent, ids.arrayLength);
	}
}

/** Scalar presentation identity may survive execution; no guest object may do so. */
function releaseActorBorrows(nodes: readonly ActorNode[], start: number): void {
	for (let index = start; index < nodes.length; index++) {
		const node = nodes[index];
		node.value = null; node.receiver = null; node.component = null; node.key = null;
		releaseActorBorrows(node.children, 0);
	}
}
