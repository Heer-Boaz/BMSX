import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ResourceIdentity } from '../../../common/resource';

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
	readonly semanticId: string;
	readonly range: LuaSourceRange;
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
	readonly resolution: BehaviorSourceResolution;
	readonly children: readonly BehaviorSourceNode[];
};

/** Immutable source topology for one authored Lua document generation. */
export type BehaviorSourceDocument = {
	readonly resource: ResourceIdentity;
	readonly definitions: readonly BehaviorSourceNode[];
};
