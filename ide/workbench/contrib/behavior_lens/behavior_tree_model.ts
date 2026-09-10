import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import type { BehaviorSourceArrayEntry, BehaviorSourceTableSection, SourceTableIssue } from './source';

/** A proven authored list position, independent of the member's content resolution. */
export type BehaviorTreeSourceMember = {
	readonly table: LuaTableConstructorExpression;
	readonly branch: BehaviorTreeSourceList;
	readonly index: number;
};

export type BehaviorTreeSourceChoice = BehaviorSourceNode & {
	readonly kind: 'section';
	readonly issues: SourceTableIssue;
	readonly weight: LuaTableField | null;
	readonly child: BehaviorTreeSourceNode;
};

export type BehaviorTreeSourceBranch = {
	readonly role: 'children';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceTableSection;
	readonly entries: readonly BehaviorSourceArrayEntry<BehaviorTreeSourceNode>[];
} | {
	readonly role: 'choices';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceTableSection;
	readonly entries: readonly BehaviorSourceArrayEntry<BehaviorTreeSourceChoice | BehaviorDynamicSourceNode>[];
} | {
	readonly role: 'main_task' | 'background_tree';
	readonly field: LuaTableField;
	readonly node: BehaviorTreeSourceNode;
};

export type BehaviorTreeSourceList = Extract<BehaviorTreeSourceBranch, { role: 'children' | 'choices' }>;

export type BehaviorTreeSourceAttachment = BehaviorSourceNode & {
	readonly kind: 'service' | 'decorator';
	readonly table: LuaTableConstructorExpression;
	readonly primary: LuaTableField | null;
};

export type BehaviorTreeSourceAttachmentGroup = {
	readonly role: 'services' | 'decorators';
	readonly field: LuaTableField;
	readonly source: BehaviorSourceTableSection;
	readonly entries: readonly BehaviorSourceArrayEntry<BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode>[];
};

/** The very same occurrence object that the outline displays, with typed relationships. */
export type BehaviorTreeSourceNode = BehaviorDynamicSourceNode | (BehaviorSourceNode & {
	readonly kind: 'node';
	readonly table: LuaTableConstructorExpression;
	/** Local constructor evidence, not aggregate warnings from descendants/attachments. */
	readonly issues: SourceTableIssue;
	readonly nodeType: string | null;
	readonly referenceLabel: string;
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
