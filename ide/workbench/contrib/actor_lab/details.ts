import type { RuntimeSourceState } from '../../../runtime/sources';
import type { GuestInvalidationReason, SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { BehaviorRuntimeProperties, runtimePropertyIdentitiesEqual, runtimeInspectionPropertiesEqual, type RuntimePropertyIdentity } from '../behavior_lens/runtime_properties';
import { inspectActorNode } from './inspection';
import type { ActorNode, ActorRuntimeTree } from './runtime';
import type { ActorNodeIdentity } from './target';
import type { ResourceDomain } from '../../../common/resource';
import { ActorWatches, type ActorDetailsProperty } from './watches';
export type { ActorDetailsProperty } from './watches';

export type ActorDetailsSelection = { readonly kind: 'watch'; readonly id: number }
	| { readonly kind: 'property'; readonly identity: RuntimePropertyIdentity }
	| { readonly kind: 'notice'; readonly label: string };

export function captureActorDetailsSelection(item: ActorDetailsProperty): ActorDetailsSelection {
	return item.watch !== undefined ? { kind: 'watch', id: item.watch.id }
		: item.identity !== undefined ? { kind: 'property', identity: item.identity } : { kind: 'notice', label: item.label };
}

export function actorDetailsSelectionsEqual(a: ActorDetailsSelection | undefined, b: ActorDetailsSelection | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.kind === 'watch') return b.kind === 'watch' && a.id === b.id;
	if (a.kind === 'property') return b.kind === 'property' && runtimePropertyIdentitiesEqual(a.identity, b.identity);
	return b.kind === 'notice' && a.label === b.label;
}

export function actorDetailsPropertyMatchesSelection(item: ActorDetailsProperty, selection: ActorDetailsSelection | undefined): boolean {
	if (selection === undefined) return false;
	if (selection.kind === 'watch') return item.watch?.id === selection.id;
	if (item.watch !== undefined) return false;
	return selection.kind === 'property' ? item.identity !== undefined && runtimePropertyIdentitiesEqual(item.identity, selection.identity)
		: item.identity === undefined && item.label === selection.label;
}

export function actorDetailsPropertiesEqual(a: ActorDetailsProperty, b: ActorDetailsProperty): boolean {
	if (a.watch !== undefined || b.watch !== undefined) return a.watch === b.watch;
	return runtimeInspectionPropertiesEqual(a, b);
}

/** A selected runtime node is borrowed only during refresh; the pane owns its typed membership. */
export class ActorDetails {
	public readonly watches: ActorWatches;
	public readonly items: ActorDetailsProperty[] = [];
	private readonly properties: BehaviorRuntimeProperties;
	private selection: readonly ActorNodeIdentity[] | undefined;
	private dirty = true;

	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {
		this.properties = new BehaviorRuntimeProperties(sources, guest);
		this.watches = new ActorWatches(sources, guest);
	}

	public dispose(): void { this.watches.dispose(); }

	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		if (reason !== 'execution') this.properties.invalidate();
		this.watches.invalidate(reason);
		this.dirty = true;
	}

	/** Consume the current tree's resolved selection, never enumerate a second copy of the runtime. */
	public refresh(node: ActorNode | undefined, selection: readonly ActorNodeIdentity[] | undefined,
		tree: ActorRuntimeTree, domain: ResourceDomain, historical: boolean): readonly ActorDetailsProperty[] | undefined {
		const properties = this.properties;
		let changed = false;
		if (this.dirty || this.selection !== selection) {
			this.dirty = false;
			this.selection = selection;
			properties.begin();
			if (node === undefined) {
				if (selection === undefined) properties.text('SELECT AN INSTANCE', 'SELECT AN ACTOR NODE TO VIEW ITS LIVE DETAILS.');
				else properties.text('INSTANCE UNAVAILABLE', 'THE SELECTED INSTANCE IS NOT PRESENT AT THIS FRAME.', '', true);
				properties.finish();
			} else inspectActorNode(this.sources, this.guest, node, properties);
			changed = properties.changed;
		}
		changed = this.watches.refresh(tree, domain, historical, node, properties.items) || changed;
		if (!changed) return;
		let index = 0;
		for (const pin of this.watches.pins) this.items[index++] = pin.item;
		for (const property of properties.items) this.items[index++] = property;
		this.items.length = index;
		return this.items;
	}
}
