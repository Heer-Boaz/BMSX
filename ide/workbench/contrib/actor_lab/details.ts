import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { GuestInvalidationReason, SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { BehaviorRuntimeProperties, runtimePropertyIdentitiesEqual, runtimeInspectionPropertiesEqual, type RuntimePropertyIdentity } from '../behavior_lens/runtime_properties';
import { inspectActorNode } from './inspection';
import { ActorRuntimeTree, findWorldActor, runtimeWorld, type ActorNode } from './runtime';
import { actorPathsEqual, resolveActorTarget, type ActorNodeIdentity, type ActorTarget } from './target';
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

/** Independent typed subject and retained properties; guest borrows belong only to runtime trees. */
export class ActorDetails {
	public readonly watches: ActorWatches;
	public readonly items: ActorDetailsProperty[] = [];
	private subjectValue: ActorTarget | undefined;
	private lockedValue = false;
	private subjectPathValue = '';
	private availableValue = false;
	private retiredValue = false;
	private titleValue = 'DETAILS — SELECT AN INSTANCE';
	public get subject(): ActorTarget | undefined { return this.subjectValue; }
	public get locked(): boolean { return this.lockedValue; }
	public get subjectPath(): string { return this.subjectPathValue; }
	public get available(): boolean { return this.availableValue; }
	public get retired(): boolean { return this.retiredValue; }
	public get title(): string { return this.titleValue; }
	private readonly properties: BehaviorRuntimeProperties;
	private readonly runtime = new ActorRuntimeTree();
	private subjectTree: ActorRuntimeTree | undefined;
	private subjectDirty = true;
	private pathTree: ActorRuntimeTree | undefined;
	private pathRevision = -1;
	private pathSubject: ActorTarget | undefined;
	private titleSubject: ActorTarget | undefined;
	private titlePath = '';
	private titleAvailable = false;
	private selection: readonly ActorNodeIdentity[] | undefined;
	private domain: ResourceDomain | undefined;
	private worldHashId: number | undefined;
	private dirty = true;

	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {
		this.properties = new BehaviorRuntimeProperties(sources, guest);
		this.watches = new ActorWatches(sources, guest);
	}

	public dispose(): void { this.runtime.dispose(); this.watches.dispose(); }

	/** Selection changes supply stable scalar membership; clean checks allocate nothing. */
	public followSelection(domain: ResourceDomain, worldHashId: number | undefined, actorHashId: number,
		path: readonly ActorNodeIdentity[] | undefined, current: ActorRuntimeTree): void {
		if (this.lockedValue) return;
		const previous = this.subjectValue;
		if (path === undefined || worldHashId === undefined) {
			if (previous === undefined) return;
			this.subjectValue = undefined; this.subjectPathValue = ''; this.availableValue = false;
		} else {
			if (previous !== undefined && previous.domain === domain && previous.worldHashId === worldHashId
				&& previous.actorHashId === actorHashId && actorPathsEqual(previous.path, path)) return;
			this.subjectValue = { domain, worldHashId, actorHashId, path }; this.subjectPathValue = '';
			this.availableValue = resolveActorTarget(current.roots, this.subjectValue, this.guest) !== undefined;
			if (this.availableValue) this.updateSubjectPath(current);
		}
		this.retiredValue = false; this.subjectDirty = true; this.subjectTree = undefined;
		this.selection = undefined; this.dirty = true;
		this.updateTitle();
	}

	public setLocked(locked: boolean): void {
		if (!locked && this.lockedValue && this.retiredValue) this.restoreSubject(undefined, false, '', false);
		this.lockedValue = locked && this.subjectValue !== undefined;
	}

	/** Navigation restores only an admitted identity bookmark, never a heap borrow. */
	public restoreSubject(subject: ActorTarget | undefined, locked: boolean, path: string, retired: boolean): void {
		this.subjectValue = subject; this.lockedValue = locked; this.subjectPathValue = path; this.retiredValue = retired;
		this.availableValue = false; this.subjectDirty = true; this.subjectTree = undefined;
		this.selection = undefined; this.dirty = true;
		this.updateTitle();
	}

	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		this.runtime.release(); this.subjectTree = undefined; this.subjectDirty = true; this.availableValue = false;
		if (reason !== 'execution') this.properties.invalidate();
		if (reason === 'heap-replaced') {
			this.runtime.dispose(); this.retiredValue = this.subjectValue !== undefined;
			this.selection = undefined; this.domain = undefined; this.worldHashId = undefined;
			this.updateTitle();
		}
		this.watches.invalidate(reason);
		this.dirty = true;
	}

	/** Validate hidden subjects before discarded-future allocation identities can be reused. */
	public resumeHistory(current: ActorRuntimeTree, domain: ResourceDomain, worldHashId: number | undefined): void {
		this.subjectDirty = true;
		this.resolveSubject(current, domain, worldHashId, false);
		this.watches.resumeHistory(current, domain, this.subjectTree, this.subjectValue?.domain);
		this.dirty = true;
	}

	public refreshSubject(current: ActorRuntimeTree, domain: ResourceDomain, worldHashId: number | undefined,
		historical: boolean): readonly ActorDetailsProperty[] | undefined {
		const node = this.resolveSubject(current, domain, worldHashId, historical), subject = this.subjectValue;
		return this.refresh(node, subject?.path, this.subjectTree ?? current, subject?.domain ?? domain,
			subject?.worldHashId ?? worldHashId, historical, current, domain);
	}

	/** Identity-only readback for explicit navigation and history admission; no property formatting. */
	public resolveSubject(current: ActorRuntimeTree, domain: ResourceDomain, worldHashId: number | undefined, historical: boolean): ActorNode | undefined {
		const subject = this.subjectValue;
		if (subject === undefined || this.retiredValue) { this.availableValue = false; this.updateTitle(); return; }
		const reuseCurrent = domain === subject.domain && worldHashId === subject.worldHashId && current.roots[0]?.hashId === subject.actorHashId;
		if (this.subjectDirty || reuseCurrent && this.subjectTree !== current || !reuseCurrent && this.subjectTree === current) {
			this.subjectDirty = false;
			if (reuseCurrent) {
				this.subjectTree = current;
			} else {
				const world = runtimeWorld(this.sources, this.guest, subject.domain);
				this.runtime.update(this.sources, this.guest, subject.domain,
					world?.hashId === subject.worldHashId ? findWorldActor(this.guest, world, subject.actorHashId) : undefined);
				this.subjectTree = this.runtime;
			}
		}
		const node = resolveActorTarget(this.subjectTree!.roots, subject, this.guest);
		this.availableValue = node !== undefined;
		if (node !== undefined) this.updateSubjectPath(this.subjectTree!);
		else if (!historical) this.retiredValue = true;
		this.updateTitle();
		return node;
	}

	private updateSubjectPath(tree: ActorRuntimeTree): void {
		if (this.pathSubject === this.subjectValue && this.pathTree === tree && this.pathRevision === tree.topologyRevision) return;
		const subject = this.subjectValue!, labels: string[] = [];
		let children = tree.roots;
		for (const identity of subject.path) {
			const node = children.find(node => node.hashId === identity.hashId && node.kind === identity.kind
				&& this.guest.matchesIdentity(node.key, identity.key))!;
			labels.push(node.label); children = node.children;
		}
		this.subjectPathValue = `${subject.domain === -1 ? 'SYSTEM' : `CART ${subject.domain}`} / ${labels.join(' / ')}`;
		this.pathSubject = subject; this.pathTree = tree; this.pathRevision = tree.topologyRevision;
	}

	private updateTitle(): void {
		if (this.titleSubject === this.subjectValue && this.titlePath === this.subjectPathValue && this.titleAvailable === this.availableValue) return;
		this.titleSubject = this.subjectValue; this.titlePath = this.subjectPathValue; this.titleAvailable = this.availableValue;
		this.titleValue = this.subjectValue === undefined ? 'DETAILS — SELECT AN INSTANCE'
			: this.subjectPathValue === '' ? 'DETAILS — UNAVAILABLE' : `DETAILS — ${this.subjectPathValue}${this.availableValue ? '' : ' — UNAVAILABLE'}`;
	}

	/** Consume the current tree's resolved selection, never enumerate a second copy of the runtime. */
	public refresh(node: ActorNode | undefined, selection: readonly ActorNodeIdentity[] | undefined,
		tree: ActorRuntimeTree, domain: ResourceDomain, worldHashId: number | undefined, historical: boolean,
		otherTree?: ActorRuntimeTree, otherDomain?: ResourceDomain): readonly ActorDetailsProperty[] | undefined {
		const properties = this.properties;
		let changed = false;
		const sameSelection = this.domain === domain && this.worldHashId === worldHashId && (this.selection === selection
			|| this.selection !== undefined && selection !== undefined && actorPathsEqual(this.selection, selection));
		this.selection = selection;
		if (this.dirty || !sameSelection) {
			properties.begin(this.dirty && sameSelection && node !== undefined);
			this.dirty = false;
			this.domain = domain; this.worldHashId = worldHashId;
			if (node === undefined) {
				if (selection === undefined) properties.text('SELECT AN INSTANCE', 'SELECT AN ACTOR NODE TO VIEW ITS LIVE DETAILS.');
				else properties.text('INSTANCE UNAVAILABLE', 'THE SELECTED INSTANCE IS NOT PRESENT AT THIS FRAME.', '', true);
				properties.finish();
			} else inspectActorNode(this.sources, this.guest, node, properties);
			changed = properties.changed;
		}
		changed = this.watches.refresh(tree, domain, historical, node, properties.items, otherTree, otherDomain) || changed;
		if (!changed) return;
		let index = 0;
		for (const pin of this.watches.pins) this.items[index++] = pin.item;
		for (const property of properties.items) this.items[index++] = property;
		this.items.length = index;
		return this.items;
	}
}
