import type { LuaExpression, LuaFunctionExpression, LuaReturnStatement,
	LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorSourceTableSection, ResolvedSourceTable, SourceTableIssue } from './source';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode, BehaviorSourceRowKey } from './model';

/** Authored consumer candidate; its trigger expression need not have a statically known key. */
export type StateMachineSourceSlot = {
	readonly kind: 'event' | 'input' | 'timeline-finished' | 'update' | 'enter';
	readonly source: BehaviorSourceNode;
	readonly field: LuaTableField;
	readonly value: LuaExpression;
	/** The handler producer resolves a transition table once, alongside its outline. */
	readonly spec: ResolvedSourceTable | null;
	readonly bindingComplete: boolean;
};

export type StateMachineSourceStates = {
	readonly source: BehaviorSourceNode;
	readonly field: LuaTableField;
} & ({
	readonly kind: 'resolved';
	readonly issues: SourceTableIssue;
	readonly entries: readonly {
		readonly name: string | null;
		readonly field: LuaTableField;
		readonly node: StateMachineSourceState | BehaviorDynamicSourceNode;
	}[];
} | { readonly kind: 'dynamic' });

export type StateMachineSourceBody = {
	readonly table: LuaTableConstructorExpression;
	readonly issues: SourceTableIssue;
	readonly initial: LuaTableField | null;
	readonly concurrent: LuaTableField | null;
	readonly guards: {
		readonly source: BehaviorSourceTableSection;
		readonly field: LuaTableField;
		readonly canEnter: LuaTableField | null;
		readonly canExit: LuaTableField | null;
	} | null;
	readonly states: StateMachineSourceStates | null;
	readonly slots: readonly StateMachineSourceSlot[];
};

export type StateMachineSourceState = BehaviorSourceNode & {
	readonly kind: 'state';
	readonly body: StateMachineSourceBody;
};

/** Source occurrence scopes, retained from the cold relation-binding pass. */
export type StateMachineScope = {
	readonly kind: 'scope';
	readonly rowKey: BehaviorSourceRowKey;
	readonly body: StateMachineSourceBody;
	readonly parent: StateMachineScope | null;
	readonly name: string | undefined;
	readonly depth: number;
	readonly children: Map<string, StateMachineScope | null>;
	readonly addressComplete: boolean;
	readonly membersComplete: boolean;
	readonly bindingsComplete: boolean;
	readonly concurrent: boolean | undefined;
};

export type StateMachineSourceUnknown = {
	readonly kind: 'unresolved';
	readonly reason: 'dynamic-value' | 'unknown-callback' | 'partial-source' | 'implicit-initial'
		| 'unknown-states' | 'missing-state' | 'above-root' | 'empty-path' | 'unterminated-quoted-segment'
		| 'invalid-value';
};

/** Binding steps, not an assertion that runtime guards permit a transition. */
export type StateMachineSourcePath = {
	readonly kind: 'path';
	readonly text: string;
	readonly absolute: boolean;
	readonly up: number;
	readonly target: BehaviorSourceRowKey;
	readonly steps: readonly {
		readonly scope: BehaviorSourceRowKey;
		readonly target: BehaviorSourceRowKey;
		readonly concurrent: boolean | undefined;
	}[];
};

export type StateMachineSourceOutcome = {
	readonly proof: { readonly kind: 'direct'; readonly expression: LuaExpression }
		| { readonly kind: 'return'; readonly binding: LuaExpression; readonly callback: LuaFunctionExpression; readonly statement: LuaReturnStatement };
	/** Resolved authored value, even when a consumer's path binding is incomplete. */
	readonly value: LuaExpression | undefined;
	readonly target: StateMachineSourcePath | StateMachineSourceUnknown | {
		/** No returned path, not a claim that the callback has no imperative effects. */
		readonly kind: 'no-path';
		readonly reason: 'no-op' | 'nil' | 'false' | 'no-return';
	};
};

/** Possible returned paths, not an evaluated control-flow graph or a runtime dispatch guarantee. */
export type StateMachineSourceTransition = {
	readonly origin: StateMachineScope;
	readonly slot: StateMachineSourceSlot;
	readonly outcomes: readonly StateMachineSourceOutcome[];
};

export type StateMachineSourceEntry = {
	readonly kind: 'initial' | 'concurrent';
	/** Declaring scope; a concurrent entry's origin is its parent, not this owner. */
	readonly owner: BehaviorSourceRowKey;
	readonly origin: BehaviorSourceRowKey;
	readonly field: LuaTableField | null;
	readonly target: { readonly kind: 'state'; readonly rowKey: BehaviorSourceRowKey } | StateMachineSourceUnknown;
};

export type StateMachineSourceDefinition = BehaviorSourceNode & {
	readonly kind: 'definition';
	readonly behaviorKind: 'state_machine';
	readonly body: StateMachineSourceBody | null;
	readonly scopes: readonly StateMachineScope[];
	readonly entries: readonly StateMachineSourceEntry[];
	readonly transitions: readonly StateMachineSourceTransition[];
};
