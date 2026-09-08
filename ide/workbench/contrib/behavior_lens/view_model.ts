import type { EditorFont } from '../../../editor/ui/view/font';
import type { WorkbenchActionBarState } from '../../ui/action_bar';
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
	sourceLine: number;
	sourceColumn: number;
	readonly sourceNodes: BehaviorSourceNode[];
	readonly nodesByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceNode>;
	readonly parentRowKeyByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly sourceMatchRowKeys: Set<BehaviorSourceRowKey>;
	rowsDirty: boolean;
	textDirty: boolean;
	readonly status: BehaviorLensStatusInfo;
	lastPointerClickTimeMs: number;
	lastPointerClickRowKey: BehaviorSourceRowKey | null;
};
