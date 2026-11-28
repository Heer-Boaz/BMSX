// Consumes the same-build cartlib layout in docs/cartlib_inspection_contract.md.
import { isNil, numberToHost, valueNil, valuesEqual, ValueTag, type Value, valuePayload } from '../../../../machine/ts/machine/cpu/value';
import { createFsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';

export type ActorNode = {
	readonly kind: 'actor' | 'component' | 'machine' | 'state' | 'tree' | 'timeline' | 'effect';
	readonly hashId: number;
	readonly keyIdentity: SuspendedValueIdentity;
	readonly name: string;
	readonly prefix: string;
	readonly label: string;
	readonly children: ActorNode[];
	/** Borrowed only between CPU slices. Display identity survives, guest handles do not. */
	value: Value | null;
	receiver: Value | null;
	component: Value | null;
	key: Value;
	active: boolean;
	readonly stateKeys: readonly string[];
	readonly path?: string;
};

export function runtimeWorld(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): Value | undefined {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	return world.kind === 'value' && !isNil(world.value) ? world.value : undefined;
}

/** The ordinary global registerfile is shared: mounted ROMs are not separate worlds. */
export function readRuntimeActors(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	if (world.kind === 'unavailable') return { domain, status: world.reason } as const;
	if (isNil(world.value)) return { domain, status: 'uninitialized' } as const;
	return { domain, status: 'available', objects: valuePayload(guest.readStringMember(world.value, '_objects')) } as const;
}

export function findRuntimeActor(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, hashId: number): Value | undefined {
	return findWorldActor(guest, runtimeWorld(sources, guest, domain), hashId);
}

/** Lookup from an already resolved World; callers can retain its scalar identity separately. */
export function findWorldActor(guest: SuspendedGuestSession, world: Value | undefined, hashId: number): Value | undefined {
	if (world === undefined) return;
	const objects = valuePayload(guest.readStringMember(world, '_objects'));
	for (let i = 1, length = guest.cpu.tables.length(objects); i <= length; i += 1) {
		const actor = guest.cpu.tables.getInteger(objects, i);
		if (guest.identityScalar(actor, ValueTag.Table) === hashId) return actor;
	}
}

const COMPONENT_TYPES = [
	['cartlib/fsm/fsm_component', 'FSM'], ['cartlib/behaviour_tree/bt_component', 'BT'],
	['cartlib/timeline/timeline_component', 'TIMELINES'], ['cartlib/actioneffects/actioneffect_component', 'ACTIONEFFECTS'],
] as const;
const NO_KEYS: readonly string[] = [];

/** Runtime enumeration and human-facing sibling order have distinct owners. */
type RetainedActorNode = ActorNode & { readonly members: RetainedActorNode[]; childrenDirty: boolean };

function compareActorNames(left: ActorNode, right: ActorNode): number {
	return left.name < right.name ? -1 : left.name > right.name ? 1
		: left.keyIdentity.tag - right.keyIdentity.tag
			|| (left.keyIdentity.scalar < right.keyIdentity.scalar ? -1 : left.keyIdentity.scalar > right.keyIdentity.scalar ? 1 : 0);
}

/** Reconcile one actor by guest identity. Ordinary state changes retain nodes, labels and rows. */
export class ActorRuntimeTree {
	public readonly roots: ActorNode[] = [];
	public topologyRevision = 0;
	public activityRevision = 0;
	private readonly members: RetainedActorNode[] = [];
	private rootsDirty = false;
	private changed = false;
	private activityChanged = false;
	private borrowed = false;
	private readonly kinds: number[] = [];
	public update(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, actor: Value | undefined): boolean {
		this.changed = false;
		this.activityChanged = false;
		this.borrowed = actor !== undefined;
		if (actor === undefined) {
			this.finishChildren(null, 0);
		} else {
			const id = guest.readStringMember(actor, 'id');
			const root = this.node(guest, null, 0, 'actor', actor, actor, null, id, guest.isTruthy(guest.readStringMember(actor, 'active')));
			const components = valuePayload(guest.readStringMember(actor, '_components'));
			const componentCount = guest.cpu.tables.length(components);
			this.kinds.length = componentCount + 1;
			this.kinds.fill(-1);
			const classes = valuePayload(guest.readStringMember(actor, '_components_by_class'));
			for (let i = 0; i < COMPONENT_TYPES.length; i += 1) {
				const type = readRuntimeLuaModuleExport(sources, guest, domain, COMPONENT_TYPES[i][0]);
				if (type.kind !== 'value' || isNil(type.value)) continue;
				const bucketValue = guest.cpu.tables.get(classes, type.value);
				if (!isNil(bucketValue)) {
					const bucket = valuePayload(bucketValue);
					for (let j = 1, length = guest.cpu.tables.length(bucket); j <= length; j += 1) {
						const index = numberToHost(guest.readStringMember(guest.cpu.tables.getInteger(bucket, j), '_owner_component_index'));
						this.kinds[index] = i;
					}
				}
			}
			for (let i = 1; i <= componentCount; i += 1) {
				const component = guest.cpu.tables.getInteger(components, i);
				const type = this.kinds[i];
				const id = guest.readStringMember(component, type === 1 ? 'tree_id' : 'id');
				const branch = this.node(guest, root, i - 1, type === 1 ? 'tree' : 'component', component, component, component, id,
					guest.isTruthy(guest.readStringMember(component, 'enabled')) && root.active,
					type === -1 ? 'COMPONENT' : COMPONENT_TYPES[type][1]);
				let count = 0;
				if (type === 0) {
					const machines = valuePayload(guest.readStringMember(component, '_machines'));
					for (let index = 1, length = guest.cpu.tables.length(machines); index <= length; index++) {
						const machine = guest.cpu.tables.getInteger(machines, index);
						const node = this.node(guest, branch, count++, 'machine', machine, machine, component, guest.readStringMember(machine, 'localdef_id'),
							branch.active && guest.isTruthy(guest.readStringMember(component, '_started')));
						this.states(guest, node, machine, component);
					}
				} else if (type === 2 || type === 3) {
					guest.visitTableEntries(guest.readStringMember(component, type === 2 ? '_entries_by_id' : 'effects'), (key, value) => {
						this.node(guest, branch, count++, type === 2 ? 'timeline' : 'effect', value, component, component, key,
							type === 2 ? guest.isTruthy(guest.readStringMember(value, 'playing')) : numberToHost(guest.readStringMember(value, 'active_count')) > 0);
					});
				}
				this.finishChildren(branch, count, type === 2 || type === 3);
			}
			this.finishChildren(root, componentCount);
			this.finishChildren(null, 1);
		}
		if (this.changed) this.topologyRevision++;
		if (this.activityChanged || this.changed) this.activityRevision++;
		return this.changed;
	}

	private node(guest: SuspendedGuestSession, parent: RetainedActorNode | null, index: number, kind: ActorNode['kind'], value: Value, receiver: Value,
		component: Value | null, key: Value, active: boolean, prefix = ''): RetainedActorNode {
		const hashId = guest.identityScalar(value, ValueTag.Table);
		const siblings = parent === null ? this.members : parent.members;
		let node = siblings[index];
		if (node === undefined || node.hashId !== hashId || node.kind !== kind || node.prefix !== prefix || !guest.matchesIdentity(key, node.keyIdentity)) {
			let previous = index + 1;
			for (; previous < siblings.length; previous++) {
				const candidate = siblings[previous];
				if (candidate.hashId === hashId && candidate.kind === kind && candidate.prefix === prefix && guest.matchesIdentity(key, candidate.keyIdentity)) break;
			}
			if (previous < siblings.length) node = siblings[previous];
			else {
				const name = guest.formatValue(key);
				const stateKeys = kind === 'state' ? [...parent!.stateKeys, name] : NO_KEYS;
				const label = prefix === '' ? name : `${prefix} ${name}`;
				node = { kind, hashId, keyIdentity: guest.identity(key), name, prefix, label, children: [], members: [], childrenDirty: false,
					value, receiver, component, key, active, stateKeys, path: kind === 'state' ? createFsmStatePath(true, 0, stateKeys)?.text : undefined };
				previous = siblings.length;
			}
			for (let position = previous; position > index; position--) siblings[position] = siblings[position - 1];
			siblings[index] = node;
			if (parent === null) this.rootsDirty = true; else parent.childrenDirty = true;
		}
		if (node.active !== active) this.activityChanged = true;
		node.value = value; node.receiver = receiver; node.component = component; node.key = key; node.active = active;
		return node;
	}

	private finishChildren(parent: RetainedActorNode | null, count: number, sortNames = false): void {
		const members = parent === null ? this.members : parent.members;
		const children = parent === null ? this.roots : parent.children;
		if (members.length !== count) {
			releaseActorBorrows(members, count);
			members.length = count;
			if (parent === null) this.rootsDirty = true; else parent.childrenDirty = true;
		}
		if (!(parent === null ? this.rootsDirty : parent.childrenDirty)) return;
		for (let index = 0; index < count; index++) children[index] = members[index];
		children.length = count;
		if (sortNames) children.sort(compareActorNames);
		if (parent === null) this.rootsDirty = false; else parent.childrenDirty = false;
		this.changed = true;
	}

	public release(): void {
		if (!this.borrowed) return;
		releaseActorBorrows(this.roots, 0);
		this.borrowed = false;
	}
	public dispose(): void {
		this.release();
		if (this.roots.length !== 0) { this.topologyRevision++; this.activityRevision++; }
		this.roots.length = 0; this.members.length = 0;
	}

	private states(guest: SuspendedGuestSession, parent: RetainedActorNode, machine: Value, component: Value): void {
		const state = parent.value!;
		const children = valuePayload(guest.readStringMember(state, 'states'));
		const ids = valuePayload(guest.readStringMember(state, 'state_ids'));
		const current = guest.readStringMember(state, 'current_id');
		const stateCount = guest.cpu.tables.length(ids);
		for (let i = 1; i <= stateCount; i += 1) {
			const id = guest.cpu.tables.getInteger(ids, i);
			const child = guest.cpu.tables.get(children, id);
			const active = parent.active && (valuesEqual(current, id) || guest.isTruthy(guest.readStringMember(guest.readStringMember(child, 'definition'), 'is_concurrent')));
			const node = this.node(guest, parent, i - 1, 'state', child, machine, component, id, active);
			this.states(guest, node, machine, component);
		}
		this.finishChildren(parent, stateCount, true);
	}
}

/** Scalar presentation identity may survive execution; no guest object may do so. */
function releaseActorBorrows(nodes: readonly ActorNode[], start: number): void {
	for (let index = start; index < nodes.length; index++) {
		const node = nodes[index];
		node.value = null; node.receiver = null; node.component = null; node.key = valueNil();
		releaseActorBorrows(node.children, 0);
	}
}
