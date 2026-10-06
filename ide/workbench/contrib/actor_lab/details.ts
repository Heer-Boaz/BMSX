import type { RuntimeSourceState } from '../../../runtime/sources';
import type { GuestInvalidationReason, SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import { BehaviorRuntimeProperties } from '../behavior_lens/runtime_properties';
import { inspectActorNode } from './inspection';
import type { ActorNode } from './runtime';
import type { ActorNodeIdentity } from './target';

/** A selected runtime node is borrowed only during refresh; the pane owns its typed membership. */
export class ActorDetails {
	private readonly properties: BehaviorRuntimeProperties;
	private selection: readonly ActorNodeIdentity[] | undefined;
	private dirty = true;

	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {
		this.properties = new BehaviorRuntimeProperties(sources, guest);
	}

	public get items(): readonly BehaviorInspectionProperty[] { return this.properties.items; }

	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		if (reason !== 'execution') this.properties.invalidate();
		this.dirty = true;
	}

	/** Consume the current tree's resolved selection, never enumerate a second copy of the runtime. */
	public refresh(node: ActorNode | undefined, selection: readonly ActorNodeIdentity[] | undefined): readonly BehaviorInspectionProperty[] | undefined {
		if (!this.dirty && this.selection === selection) return undefined;
		this.dirty = false;
		this.selection = selection;
		const properties = this.properties;
		properties.begin();
		if (node === undefined) {
			if (selection === undefined) properties.text('SELECT AN INSTANCE', 'SELECT AN ACTOR NODE TO VIEW ITS LIVE DETAILS.');
			else properties.text('INSTANCE UNAVAILABLE', 'THE SELECTED INSTANCE IS NOT PRESENT AT THIS FRAME.', '', true);
			properties.finish();
		} else inspectActorNode(this.sources, this.guest, node, properties);
		return properties.changed ? properties.items : undefined;
	}
}
