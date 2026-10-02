import type { HostRewind } from '../../../../hosts/common/rewind';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { findActionEffectInstance, inspectActionEffectInstance, type ActionEffectInstance } from './action_effect_runtime';
import { inspectBehaviorTreeInstance } from './behavior_tree_runtime';
import type { BehaviorInspectionProperty } from './inspection';
import { findStateMachineState, inspectStateMachineState, type StateMachineInstance } from './state_machine_runtime';
import { BehaviorRuntimeProperties } from './runtime_properties';
import { findRuntimeComponent } from './runtime_components';

/** Table identities within one heap, not borrowed picker results or authored definition ids. */
export type BehaviorRuntimeSelection = { readonly componentHashId: number } & (
	{ readonly kind: 'action_effect'; readonly effectHashId: number }
	| { readonly kind: 'state_machine'; readonly machineHashId: number; readonly stateHashId: number }
	| { readonly kind: 'behavior_tree' }
);

type ResolvedBehavior = { kind: 'action_effect'; choice: ActionEffectInstance }
	| { kind: 'state_machine'; machine: StateMachineInstance; state: Table }
	| { kind: 'behavior_tree'; component: Table };

/** One visible inspection lifetime. Guest reads end before returning a property document. */
export class BehaviorRuntimeInspection {
	public running = false;
	private dirty = true;
	private retired: 'missing' | 'heap-replaced' | undefined;
	private readonly unbindInvalidation: () => void;
	private readonly unbindHistoryResume: () => void;
	private readonly properties: BehaviorRuntimeProperties;

	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession,
		private readonly rewind: HostRewind, private readonly domain: ResourceDomain, private selection: BehaviorRuntimeSelection | undefined) {
		this.properties = new BehaviorRuntimeProperties(sources, guest);
		this.unbindInvalidation = guest.onDidInvalidate(reason => {
			if (reason === 'heap-replaced') this.retire(reason);
			if (reason !== 'execution') this.properties.invalidate();
			this.dirty = true;
		});
		this.unbindHistoryResume = guest.onWillResumeHistory(() => {
			if (this.resolve() === undefined) this.retire('missing');
		});
	}

	public dispose(): void { this.running = false; this.selection = undefined; this.unbindInvalidation(); this.unbindHistoryResume(); }

	public refresh(): readonly BehaviorInspectionProperty[] | undefined {
		if (!this.dirty || this.rewind.seeking) return undefined;
		this.dirty = false;
		const properties = this.properties;
		properties.begin();
		const resolved = this.resolve();
		if (resolved === undefined) {
			if (this.retired === undefined) this.retire('missing');
			properties.text('INSTANCE UNAVAILABLE', this.retired === 'heap-replaced' ? 'THE GUEST HEAP WAS REPLACED.' : 'THE SELECTED INSTANCE IS NOT IN THIS FRAME.',
				'SELECT A RUNTIME INSTANCE AGAIN. NO OTHER INSTANCE WAS SUBSTITUTED.', true);
		} else switch (resolved.kind) {
			case 'action_effect': inspectActionEffectInstance(this.sources, this.guest, resolved.choice, properties); break;
			case 'state_machine': inspectStateMachineState(this.sources, this.guest, resolved.machine, resolved.state, properties); break;
			case 'behavior_tree': inspectBehaviorTreeInstance(this.sources, this.guest, resolved.component, properties); break;
		}
		const items = properties.finish();
		return properties.changed ? items : undefined;
	}

	private retire(reason: 'missing' | 'heap-replaced'): void {
		this.selection = undefined; this.retired = reason; this.running = false;
	}

	private resolve(): ResolvedBehavior | undefined {
		const selection = this.selection;
		if (selection === undefined) return undefined;
		switch (selection.kind) {
			case 'action_effect': {
				const choice = findActionEffectInstance(this.sources, this.guest, this.domain, selection.componentHashId, selection.effectHashId);
				if (choice !== undefined) return { kind: selection.kind, choice };
				break;
			}
			case 'state_machine': {
				const state = findStateMachineState(this.sources, this.guest, this.domain, selection.componentHashId, selection.machineHashId, selection.stateHashId);
				if (state !== undefined) return { kind: selection.kind, ...state };
				break;
			}
			case 'behavior_tree': {
				const component = findRuntimeComponent(this.sources, this.guest, this.domain, 'cartlib/behaviour_tree/bt_component', selection.componentHashId);
				if (component !== undefined) return { kind: selection.kind, component };
				break;
			}
		}
	}
}
