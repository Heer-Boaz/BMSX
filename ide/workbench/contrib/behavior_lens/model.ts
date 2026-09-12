import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ResourceIdentity } from '../../../common/resource';
import type { LuaFileSemanticRevision } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorTreeSourceDefinition } from './behavior_tree_model';
import type { StateMachineSourceDefinition } from './state_machine_model';
import type { ActionEffectSourceDefinition } from './action_effect_model';

export type BehaviorKind = 'behavior_tree' | 'state_machine' | 'action_effect';

export type BehaviorSourceNodeKind =
	| 'definition'
	| 'node'
	| 'state'
	| 'event'
	| 'service'
	| 'decorator'
	| 'property'
	| 'section'
	| 'dynamic';

export type BehaviorSourceResolution = 'complete' | 'partial' | 'unresolved';

/** Static authored occurrence of one behavior registration in a workspace generation. */
export type BehaviorRegistrationSource = {
	readonly resource: ResourceIdentity;
	readonly behaviorKind: BehaviorKind;
	readonly semanticId: string | null;
	readonly label: string;
	readonly rowKey: BehaviorSourceRowKey;
	readonly range: LuaSourceRange;
	/** Complete registration occurrence, distinct from the id's navigation range. */
	readonly occurrenceRange: LuaSourceRange;
};

/** Workbench-only identity for one authored source-tree occurrence. */
export type BehaviorSourceRowKey = string;

/**
 * One source-derived tree occurrence. rowKey is workbench view identity only;
 * it is deliberately not a cartlib or runtime node identifier.
 */
export type BehaviorSourceNode = {
	readonly rowKey: BehaviorSourceRowKey;
	readonly behaviorKind: BehaviorKind;
	readonly kind: BehaviorSourceNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly authoredRange: LuaSourceRange;
	readonly referenceRange: LuaSourceRange | null;
	/** Syntactic use in this parent occurrence, not the shared initializer. */
	readonly occurrenceRange: LuaSourceRange;
	readonly resolution: BehaviorSourceResolution;
	readonly children: readonly BehaviorSourceNode[];
};

export type BehaviorDynamicSourceNode = BehaviorSourceNode & { readonly kind: 'dynamic' };

export type BehaviorSourceDefinition = BehaviorTreeSourceDefinition | StateMachineSourceDefinition | ActionEffectSourceDefinition;

/** Immutable source topology for one authored Lua document generation. */
export type BehaviorSourceDocument = {
	readonly resource: ResourceIdentity;
	/** Displayed source owners, not a complete cross-generation query-dependency certificate. */
	readonly files: readonly LuaFileSemanticRevision[];
	readonly syntaxComplete: boolean;
	readonly definitions: readonly BehaviorSourceDefinition[];
};
