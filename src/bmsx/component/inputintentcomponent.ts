import { Component } from './basecomponent';
import { insavegame } from '../serializer/serializationhooks';

export type InputIntentEdgeAssignment =
	| IntentAssignment
	| ReadonlyArray<IntentAssignment>;

export type IntentAssignment = {
	/** Property path on the owner (dot notation allowed, e.g. `state.horizontal`). */
	path: string;
	/**
	 * Value assigned when the binding edge is triggered.
	 * If omitted the assignment defaults to `true` on press/hold and clears on release.
	 */
	value?: unknown;
	/** When true the property is deleted instead of assigned. */
	clear?: boolean;
	/** Consumes the bound action after the assignment runs. */
	consume?: boolean;
};

export interface InputIntentBinding {
	action: string;
	press?: InputIntentEdgeAssignment;
	hold?: InputIntentEdgeAssignment;
	release?: InputIntentEdgeAssignment;
}

@insavegame
export class InputIntentComponent extends Component {
	public static override get unique(): boolean { return true; }
	static { this.autoRegister(); }

	/** Player index driving this object. Falls back to the object's player_index. */
	public playerIndex = 1;

	/** Declarative list of intent bindings. */
	public bindings: InputIntentBinding[] = [];
}
