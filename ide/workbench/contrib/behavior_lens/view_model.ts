import type { TrackedTextRange } from '../../../editor/text/text_change';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { WorkbenchListState } from '../../ui/list_view';
import { WorkbenchGraphViewport } from '../../ui/graph/viewport';
import { createWorkbenchGraphModel } from '../../ui/graph/model';
import type { BehaviorGraphModel } from './graph_model';
import { createBehaviorLensLayout, installBehaviorLensDocument } from './layout';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';

export type BehaviorLensRow = {
	readonly node: BehaviorSourceNode;
	readonly depth: number;
	readonly parentRowKey: BehaviorSourceRowKey | null;
	readonly expandable: boolean;
	expanded: boolean;
	text: string;
	twistieLeft: number;
	twistieRight: number;
};

export type BehaviorLensLayout = FullWidthWorkbenchLayout & {
	headerBottom: number;
	headerText: string;
};

export type BehaviorLensOutline = WorkbenchListState<BehaviorLensRow> & {
	readonly kind: 'outline';
	readonly actionBar: WorkbenchActionBarState;
	rowsDirty: boolean;
	textDirty: boolean;
};

export type BehaviorLensGraph = {
	readonly kind: 'graph';
	readonly actionBar: WorkbenchActionBarState;
	readonly viewport: WorkbenchGraphViewport<BehaviorGraphModel>;
	selectionKind: 'node' | 'edge';
	dirty: boolean;
	initialPosition: boolean;
};

/** Source selection belongs to the input, never to a visible list's row number. */
export type BehaviorLensViewState = {
	readonly resource: BehaviorSourceDocument['resource'];
	document: BehaviorSourceDocument;
	sourceVersion: number;
	definitionRowKey: BehaviorSourceRowKey | null;
	selectedRowKey: BehaviorSourceRowKey | null;
	sourceRanges: Map<BehaviorSourceRowKey, TrackedTextRange>;
	readonly sourceNodes: BehaviorSourceNode[];
	readonly nodesByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceNode>;
	readonly parentRowKeyByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly sourceMatchRowKeys: Set<BehaviorSourceRowKey>;
	presentation: BehaviorLensOutline | BehaviorLensGraph;
	readonly layout: BehaviorLensLayout;
	headerDirty: boolean;
	readonly status: { info: string; detail: string };
};

export function createBehaviorLensOutline(): BehaviorLensOutline {
	return { kind: 'outline', actionBar: createWorkbenchActionBar('behaviorLens.title'),
		rows: [], selectionIndex: -1, scroll: 0, hoverIndex: -1, rowsDirty: true, textDirty: true,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0 } };
}

export function createBehaviorLensGraph(): BehaviorLensGraph {
	return { kind: 'graph', actionBar: createWorkbenchActionBar('behaviorLens.graph.title'),
		viewport: new WorkbenchGraphViewport<BehaviorGraphModel>({ ...createWorkbenchGraphModel(editorViewState.font.renderFont(), [], []),
			nodesBySource: new Map(), edgesBySource: new Map() }),
		selectionKind: 'node', dirty: true, initialPosition: true };
}

/** Input-owned source/view state; pixel layout is prepared only by the active pane. */
export function createBehaviorLensViewState(document: BehaviorSourceDocument, model: EditorTextModel, presentation: 'outline' | 'graph'): BehaviorLensViewState {
	const view: BehaviorLensViewState = {
		resource: document.resource,
		document: { resource: document.resource, definitions: [] },
		sourceVersion: model.version,
		definitionRowKey: null,
		selectedRowKey: null,
		sourceRanges: new Map(),
		sourceNodes: [],
		nodesByRowKey: new Map(),
		parentRowKeyByRowKey: new Map(),
		collapsedRowKeys: new Set(),
		sourceMatchRowKeys: new Set(),
		presentation: presentation === 'graph' ? createBehaviorLensGraph() : createBehaviorLensOutline(),
		layout: createBehaviorLensLayout(),
		headerDirty: true,
		status: { info: '', detail: '' },
	};
	installBehaviorLensDocument(view, document, model.buffer);
	return view;
}
