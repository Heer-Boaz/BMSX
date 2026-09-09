import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { WorkbenchGraphEdge, WorkbenchGraphModel, WorkbenchGraphNode } from '../../ui/graph/model';
import type { QuickPickItem } from '../../services/quick_input/model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorTreeSourceMember } from './behavior_tree_model';

export type BehaviorGraphDetail = QuickPickItem & { readonly range: LuaSourceRange };

export type BehaviorGraphNode = WorkbenchGraphNode & {
	readonly source: BehaviorSourceNode;
	readonly member: BehaviorTreeSourceMember | null;
	readonly parent: BehaviorGraphNode | null;
	readonly children: BehaviorGraphNode[];
	readonly expandable: boolean;
	readonly details: readonly BehaviorGraphDetail[];
};

export type BehaviorGraphEdge = WorkbenchGraphEdge & {
	readonly child: BehaviorGraphNode;
	readonly source: BehaviorSourceNode;
	readonly range: LuaSourceRange;
};

export type BehaviorGraphProjection = {
	readonly font: WorkbenchGraphModel['font'];
	readonly nodes: readonly BehaviorGraphNode[];
	readonly nodesBySource: ReadonlyMap<BehaviorSourceRowKey, BehaviorGraphNode>;
	readonly links: readonly { child: BehaviorGraphNode; source: BehaviorSourceNode; range: LuaSourceRange }[];
};

export type BehaviorGraphModel = WorkbenchGraphModel<BehaviorGraphNode, BehaviorGraphEdge> & {
	readonly nodesBySource: ReadonlyMap<BehaviorSourceRowKey, BehaviorGraphNode>;
	readonly edgesBySource: ReadonlyMap<BehaviorSourceRowKey, BehaviorGraphEdge>;
};
