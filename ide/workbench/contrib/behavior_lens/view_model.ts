import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorDocumentContextId } from '../../../common/editor_context';
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

export type BehaviorLensLayout = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	headerBottom: number;
	contentLeft: number;
	contentTop: number;
	contentRight: number;
	contentBottom: number;
	rowHeight: number;
	visibleRowCount: number;
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

/** Retained presentation state owned by its Behavior Lens tab descriptor. */
export type BehaviorLensViewState = {
	readonly sourceContextId: EditorDocumentContextId;
	readonly resource: BehaviorSourceDocument['resource'];
	document: BehaviorSourceDocument;
	sourceVersion: number;
	sourceLine: number;
	sourceColumn: number;
	readonly rows: BehaviorLensRow[];
	readonly sourceNodes: BehaviorSourceNode[];
	readonly nodesByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceNode>;
	readonly parentRowKeyByRowKey: Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly sourceMatchRowKeys: Set<BehaviorSourceRowKey>;
	selectionIndex: number;
	scroll: number;
	hoverIndex: number;
	rowsDirty: boolean;
	textDirty: boolean;
	readonly layout: BehaviorLensLayout;
	readonly status: BehaviorLensStatusInfo;
	lastPointerClickTimeMs: number;
	lastPointerClickRowKey: BehaviorSourceRowKey | null;
};
