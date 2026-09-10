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
import type { BehaviorSourceSelection } from './source_selection';
import type { BehaviorSourceBookmark } from './source_bookmark';
import type { StateMachineSourceIndex } from './state_machine_index';
import type { AsyncGraphLayoutState } from '../../services/graph_layout/async_layout';
import type { StateGraphModel } from './state_graph_model';
import { emptyStateGraph } from './state_graph_projection';
import { createBehaviorLensEffectProperties, type BehaviorLensEffectProperties } from './action_effect_properties';

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
	dirty: boolean;
	initialPosition: boolean;
};

export type BehaviorLensStateGraph = {
	readonly kind: 'state-graph';
	readonly actionBar: WorkbenchActionBarState;
	readonly viewport: WorkbenchGraphViewport<StateGraphModel>;
	/** Reused non-interactive geometry while a source/font generation is not published. */
	emptyModel: StateGraphModel;
	/** The input publishes the session state during its normal update, never from a worker callback. */
	layoutState: AsyncGraphLayoutState<StateGraphModel>;
	dirty: boolean;
	initialPosition: boolean;
};

/** Source selection belongs to the input, never to a visible list's row number. */
export type BehaviorLensViewState = {
	readonly resource: BehaviorSourceDocument['resource'];
	document: BehaviorSourceDocument;
	sourceVersion: number;
	definitionRowKey: BehaviorSourceRowKey | null;
	selection: BehaviorSourceSelection | null;
	/** One edit-associated selection waiting for the next source projection, not history. */
	selectionBookmark: BehaviorSourceBookmark | undefined;
	stateMachines: StateMachineSourceIndex;
	sourceRanges: Map<BehaviorSourceRowKey, TrackedTextRange>;
	readonly sourceNodes: BehaviorSourceNode[];
	readonly nodesByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceNode>;
	readonly parentRowKeyByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly sourceMatchRowKeys: Set<BehaviorSourceRowKey>;
	presentation: BehaviorLensOutline | BehaviorLensGraph | BehaviorLensStateGraph | BehaviorLensEffectProperties;
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
		dirty: true, initialPosition: true };
}

export function createBehaviorLensStateGraph(): BehaviorLensStateGraph {
	const emptyModel = emptyStateGraph(editorViewState.font.renderFont());
	return { kind: 'state-graph', actionBar: createWorkbenchActionBar('behaviorLens.stateGraph.title'),
		viewport: new WorkbenchGraphViewport(emptyModel), emptyModel,
		layoutState: { kind: 'idle' }, dirty: true, initialPosition: true };
}

/** Input-owned source/view state; pixel layout is prepared only by the active pane. */
export function createBehaviorLensViewState(document: BehaviorSourceDocument, model: EditorTextModel, presentation: BehaviorLensViewState['presentation']['kind']): BehaviorLensViewState {
	const view: BehaviorLensViewState = {
		resource: document.resource,
		document: { resource: document.resource, syntaxComplete: document.syntaxComplete, definitions: [] },
		sourceVersion: model.version,
		definitionRowKey: null,
		selection: null,
		selectionBookmark: undefined,
		stateMachines: { bodies: new Map(), references: new Map(), initialTargets: new Map() },
		sourceRanges: new Map(),
		sourceNodes: [],
		nodesByRowKey: new Map(),
		parentRowKeyByRowKey: new Map(),
		collapsedRowKeys: new Set(),
		sourceMatchRowKeys: new Set(),
		presentation: presentation === 'graph' ? createBehaviorLensGraph() : presentation === 'state-graph' ? createBehaviorLensStateGraph()
			: presentation === 'properties' ? createBehaviorLensEffectProperties() : createBehaviorLensOutline(),
		layout: createBehaviorLensLayout(),
		headerDirty: true,
		status: { info: '', detail: '' },
	};
	installBehaviorLensDocument(view, document, model.buffer);
	return view;
}
