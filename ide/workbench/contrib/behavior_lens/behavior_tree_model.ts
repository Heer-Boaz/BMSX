import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';

/** One syntactic list entry; explicit/computed keys are not inferred list indices. */
export type BehaviorTreeSourceEntry<T extends BehaviorSourceNode> = {
	readonly field: LuaTableField;
	readonly index: number | null;
	readonly node: T;
};

export type BehaviorTreeSourceChoice = BehaviorSourceNode & {
	readonly kind: 'section';
	readonly weight: LuaTableField | null;
	readonly child: BehaviorTreeSourceNode;
};

export type BehaviorTreeSourceBranch = {
	readonly role: 'children';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceNode;
	readonly entries: readonly BehaviorTreeSourceEntry<BehaviorTreeSourceNode>[];
} | {
	readonly role: 'choices';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceNode;
	readonly entries: readonly BehaviorTreeSourceEntry<BehaviorTreeSourceChoice | BehaviorDynamicSourceNode>[];
} | {
	readonly role: 'main_task' | 'background_tree';
	readonly field: LuaTableField;
	readonly node: BehaviorTreeSourceNode;
};

export type BehaviorTreeSourceAttachment = BehaviorSourceNode & {
	readonly kind: 'service' | 'decorator';
	readonly table: LuaTableConstructorExpression;
	readonly primary: LuaTableField | null;
};

export type BehaviorTreeSourceAttachmentGroup = {
	readonly role: 'services' | 'decorators';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceNode;
	readonly entries: readonly BehaviorTreeSourceEntry<BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode>[];
};

/** The very same occurrence object that the outline displays, with typed relationships. */
export type BehaviorTreeSourceNode = BehaviorDynamicSourceNode | (BehaviorSourceNode & {
	readonly kind: 'node';
	readonly table: LuaTableConstructorExpression;
	readonly nodeType: string | null;
	readonly branches: readonly BehaviorTreeSourceBranch[];
	readonly attachments: readonly BehaviorTreeSourceAttachmentGroup[];
});

export type BehaviorTreeSourceBody = {
	readonly root: BehaviorTreeSourceNode | null;
	readonly blackboard: BehaviorSourceNode | null;
	readonly children: readonly BehaviorSourceNode[];
};

export type BehaviorTreeSourceDefinition = BehaviorSourceNode & BehaviorTreeSourceBody & {
	readonly kind: 'definition';
	readonly behaviorKind: 'behavior_tree';
};
