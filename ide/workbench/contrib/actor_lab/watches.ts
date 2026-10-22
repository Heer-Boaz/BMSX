import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { GuestInvalidationReason, SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { BehaviorRuntimeProperties, type RuntimeInspectionProperty, type RuntimePropertyIdentity,
	runtimePropertyIdentitiesEqual, RuntimePropertyIndex } from '../behavior_lens/runtime_properties';
import { inspectActorNode } from './inspection';
import { ActorRuntimeTree, findWorldActor, runtimeWorld, type ActorNode } from './runtime';
import { actorTargetsEqual, resolveActorTarget, type ActorTarget } from './target';

export type ActorDetailsProperty = RuntimeInspectionProperty & { readonly watch?: ActorPropertyWatch };

/** A pin owns only typed membership and presentation, not the mutable row it was pinned from. */
export class ActorPropertyWatch {
	public readonly item: {
		label: string; value: string; description: string; warning: boolean; valueChanged: boolean;
		source?: RuntimeInspectionProperty['source']; readonly watch: ActorPropertyWatch;
	};
	public available = true;
	public retired = false;
	public observed = false;
	private description = '';
	private label: string;
	public constructor(public readonly id: number, public readonly target: ActorTarget,
		public readonly property: RuntimePropertyIdentity, private readonly context: string, initial: RuntimeInspectionProperty) {
		this.label = initial.label;
		this.item = { label: `PIN / ${initial.label}`, value: '', description: context, warning: false, valueChanged: false, watch: this };
		this.publish(initial);
	}

	/** A pin compares its own last observation, independent of the selected-node projection. */
	public publish(property: RuntimeInspectionProperty | undefined, compareChanges = false): boolean {
		const available = property !== undefined && !this.retired;
		const label = available ? property.label : this.label;
		const value = available ? property.value : this.retired ? 'INSTANCE RETIRED' : 'UNAVAILABLE AT THIS FRAME';
		const source = available ? property.source : undefined;
		const description = available ? property.description : '';
		const warning = available ? property.warning : true;
		const valueChanged = available && this.available && !warning && (compareChanges ? this.item.value !== value : this.item.valueChanged);
		const changed = this.available !== available || this.label !== label || this.item.value !== value || this.item.source !== source
			|| this.description !== description || this.item.warning !== warning || this.item.valueChanged !== valueChanged;
		if (!changed) return false;
		this.available = available;
		if (this.label !== label) { this.label = label; this.item.label = `PIN / ${label}`; }
		this.item.value = value; this.item.source = source; this.item.warning = warning; this.item.valueChanged = valueChanged;
		this.description = description;
		this.item.description = description === '' ? this.context : `${this.context}\n${description}`;
		return true;
	}
}

type WatchedNode = {
	readonly target: ActorTarget;
	readonly pins: ActorPropertyWatch[];
	readonly index: RuntimePropertyIndex<ActorPropertyWatch>;
	readonly properties: BehaviorRuntimeProperties;
};
type WatchedActor = { readonly target: ActorTarget; readonly tree: ActorRuntimeTree; readonly nodes: WatchedNode[] };

/** Cross-selection watches reconcile once per actor and project once per watched node, never per pin. */
export class ActorWatches {
	public readonly pins: ActorPropertyWatch[] = [];
	private readonly actors: WatchedActor[] = [];
	private nextId = 0;
	private dirty = true;
	private observationPending = false;
	private membershipChanged = false;
	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {}

	public find(target: ActorTarget, property: RuntimePropertyIdentity): ActorPropertyWatch | undefined {
		return this.pins.find(pin => !pin.retired && actorTargetsEqual(pin.target, target) && runtimePropertyIdentitiesEqual(pin.property, property));
	}

	public add(target: ActorTarget, context: string, property: RuntimeInspectionProperty): ActorPropertyWatch {
		const watch = new ActorPropertyWatch(this.nextId++, target, property.watchIdentity!, context, property);
		let actor = this.actors.find(actor => actor.target.domain === target.domain && actor.target.worldHashId === target.worldHashId
			&& actor.target.actorHashId === target.actorHashId);
		if (actor === undefined) {
			actor = { target, tree: new ActorRuntimeTree(), nodes: [] };
			this.actors.push(actor);
		}
		let node = actor.nodes.find(node => actorTargetsEqual(node.target, target));
		if (node === undefined) {
			const index = new RuntimePropertyIndex<ActorPropertyWatch>();
			node = { target, pins: [], index, properties: new BehaviorRuntimeProperties(this.sources, this.guest,
				(section, field, key) => index.find(section, field, key, this.guest) !== undefined) };
			actor.nodes.push(node);
		}
		node.pins.push(watch); node.index.set(watch.property, watch); this.pins.push(watch);
		this.dirty = true; this.membershipChanged = true;
		return watch;
	}

	public remove(watch: ActorPropertyWatch): void {
		this.pins.splice(this.pins.indexOf(watch), 1);
		for (let a = 0; a < this.actors.length; a++) {
			const actor = this.actors[a];
			const n = actor.nodes.findIndex(node => node.pins.includes(watch));
			if (n < 0) continue;
			const node = actor.nodes[n];
			node.pins.splice(node.pins.indexOf(watch), 1);
			if (!watch.retired) node.index.delete(watch.property);
			if (node.pins.length === 0) actor.nodes.splice(n, 1);
			if (actor.nodes.length === 0) { actor.tree.dispose(); this.actors.splice(a, 1); }
			break;
		}
		this.dirty = true; this.membershipChanged = true;
	}

	public invalidate(reason: GuestInvalidationReason): void {
		this.observationPending = reason !== 'heap-replaced';
		for (const actor of this.actors) {
			if (reason === 'heap-replaced') actor.tree.dispose(); else actor.tree.release();
			for (const node of actor.nodes) {
				if (reason !== 'execution') node.properties.invalidate();
				if (reason === 'heap-replaced') for (const pin of node.pins) if (!pin.retired) { pin.retired = true; node.index.delete(pin.property); }
			}
		}
		this.dirty = true;
	}

	public dispose(): void { for (const actor of this.actors) actor.tree.dispose(); this.actors.length = 0; this.pins.length = 0; }

	/** Discarded-future identities cannot bind to new allocations on a live branch. */
	public resumeHistory(current: ActorRuntimeTree, domain: ResourceDomain, otherTree?: ActorRuntimeTree, otherDomain?: ResourceDomain): void {
		for (const actor of this.actors) {
			const tree = this.resolveActor(actor, current, domain, otherTree, otherDomain);
			for (const group of actor.nodes) {
				const node = tree === undefined || group.pins.every(pin => pin.retired)
					? undefined : resolveActorTarget(tree.roots, group.target, this.guest);
				for (const pin of group.pins) pin.observed = false;
				if (node !== undefined) {
					group.properties.begin();
					for (const property of inspectActorNode(this.sources, this.guest, node, group.properties)) {
						const pin = property.watchIdentity === undefined ? undefined : group.index.get(property.watchIdentity);
						if (pin !== undefined) pin.observed = true;
					}
				}
				for (const pin of group.pins) if (!pin.retired && (node === undefined || !pin.observed && pin.property.key !== undefined)) {
					pin.retired = true; group.index.delete(pin.property);
				}
			}
		}
		this.dirty = true;
	}

	public refresh(current: ActorRuntimeTree, domain: ResourceDomain, historical: boolean, selected: ActorNode | undefined,
		selectedProperties: readonly RuntimeInspectionProperty[], otherTree?: ActorRuntimeTree, otherDomain?: ResourceDomain): boolean {
		if (!this.dirty) return false;
		this.dirty = false;
		const compareChanges = this.observationPending;
		this.observationPending = false;
		let changed = this.membershipChanged;
		this.membershipChanged = false;
		for (const actor of this.actors) {
			const tree = this.resolveActor(actor, current, domain, otherTree, otherDomain);
			for (const group of actor.nodes) {
				const node = tree === undefined || group.pins.every(pin => pin.retired)
					? undefined : resolveActorTarget(tree.roots, group.target, this.guest);
				let properties: readonly RuntimeInspectionProperty[] | undefined;
				if (node !== undefined) {
					if (node === selected) properties = selectedProperties;
					else { group.properties.begin(); properties = inspectActorNode(this.sources, this.guest, node, group.properties); }
				}
				for (const pin of group.pins) pin.observed = false;
				if (properties !== undefined) for (const property of properties) {
					const pin = property.watchIdentity === undefined ? undefined : group.index.get(property.watchIdentity);
					if (pin === undefined) continue;
					pin.observed = true;
					changed = pin.publish(property, compareChanges) || changed;
				}
				for (const pin of group.pins) {
					if (!pin.retired && node === undefined && !historical) { pin.retired = true; group.index.delete(pin.property); }
					if (!pin.observed) changed = pin.publish(undefined) || changed;
				}
			}
		}
		return changed;
	}

	private resolveActor(actor: WatchedActor, current: ActorRuntimeTree, domain: ResourceDomain,
		otherTree?: ActorRuntimeTree, otherDomain?: ResourceDomain): ActorRuntimeTree | undefined {
		if (actor.nodes.every(node => node.pins.every(pin => pin.retired))) return;
		const target = actor.target;
		const world = runtimeWorld(this.sources, this.guest, target.domain);
		if (world === undefined || world.hashId !== target.worldHashId) return;
		if (domain === target.domain && current.roots[0]?.hashId === target.actorHashId) return current;
		if (otherDomain === target.domain && otherTree?.roots[0]?.hashId === target.actorHashId) return otherTree;
		actor.tree.update(this.sources, this.guest, target.domain, findWorldActor(this.guest, world, target.actorHashId));
		return actor.tree;
	}
}
