import type { EditorFont } from '../../../editor/ui/view/font';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import { createBehaviorLensLayout, installBehaviorLensDocument } from './layout';
import type {
	WorkbenchListLayout,
	WorkbenchListState,
} from '../../ui/list_view';
import type {
	BehaviorSourceDocument,
	BehaviorSourceNode,
	BehaviorSourceRowKey,
} from './model';

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

export type BehaviorLensLayout = WorkbenchListLayout & {
	left: number;
	top: number;
	right: number;
	bottom: number;
	headerBottom: number;
	headerText: string;
	font: EditorFont | null;
	viewportWidth: number;
	viewportHeight: number;
	codeAreaTop: number;
	codeAreaBottom: number;
};

export type BehaviorLensStatusInfo = {
	info: string;
	detail: string;
};

/** Retained presentation state owned by its Behavior Lens input. */
export type BehaviorLensViewState = WorkbenchListState<BehaviorLensRow, BehaviorLensLayout> & {
	readonly actionBar: WorkbenchActionBarState;
	readonly resource: BehaviorSourceDocument['resource'];
	document: BehaviorSourceDocument;
	sourceVersion: number;
	definitionRowKey: BehaviorSourceRowKey | null;
	sourceRanges: Map<BehaviorSourceRowKey, TrackedTextRange>;
	readonly sourceNodes: BehaviorSourceNode[];
	readonly nodesByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceNode>;
	readonly parentRowKeyByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly sourceMatchRowKeys: Set<BehaviorSourceRowKey>;
	rowsDirty: boolean;
	textDirty: boolean;
	readonly status: BehaviorLensStatusInfo;
};

/** Input-owned source/view state; pixel layout is prepared only by the active pane. */
export function createBehaviorLensViewState(document: BehaviorSourceDocument, model: EditorTextModel): BehaviorLensViewState {
	const view: BehaviorLensViewState = {
		actionBar: createWorkbenchActionBar('behaviorLens.title'),
		resource: document.resource,
		document: { resource: document.resource, definitions: [] },
		sourceVersion: model.version,
		definitionRowKey: null,
		sourceRanges: new Map(),
		rows: [],
		sourceNodes: [],
		nodesByRowKey: new Map(),
		parentRowKeyByRowKey: new Map(),
		collapsedRowKeys: new Set(),
		sourceMatchRowKeys: new Set(),
		selectionIndex: -1,
		scroll: 0,
		hoverIndex: -1,
		rowsDirty: true,
		textDirty: true,
		layout: createBehaviorLensLayout(),
		status: { info: '', detail: '' },
	};
	installBehaviorLensDocument(view, document, model.buffer);
	return view;
}
