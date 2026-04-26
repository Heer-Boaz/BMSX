import type {
	LuaHoverScope,
	LuaHoverValueState,
	LuaDefinitionLocation,
	LuaSymbolEntry,
} from '../../lua/semantic_contracts';
import type { ResourceDescriptor } from '../../rompack/resource';
import type { StackTraceFrame } from '../../lua/value';
import type { EditorCommandId } from '../editor/input/commands/dispatcher';
import { RectBounds } from '../../rompack/format';
import type { TextBuffer } from '../editor/text/text_buffer';
import type { EditorUndoRecord } from '../editor/text/undo';
export type { ResourceDescriptor } from '../../rompack/resource';

export type Position = { row: number; column: number };

export type MessageState = {
	text: string;
	color: number;
	timer: number;
	visible: boolean;
};

export type HighlightLine = {
	text: string;
	upperText: string;
	colors: number[];
	columnToDisplay: number[];
};

export type CachedHighlight = {
	src: string;
	hi: HighlightLine;
	displayToColumn: number[];
	advancePrefix: number[];
	textVersion: number;
	lineSignature: number;
	builtinEpoch: number;
	rowSignature: number;
};

export type SearchMatch = {
	row: number;
	start: number;
	end: number;
};

export type GlobalSearchMatch = {
	descriptor: ResourceDescriptor;
	pathLabel: string;
	row: number;
	start: number;
	end: number;
	snippet: string;
	path: string;
};

export type EditorSnapshot = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
	textVersion: number;
};

export type SymbolCatalogEntry = {
	symbol: LuaSymbolEntry;
	displayName: string;
	searchKey: string;
	line: number;
	kindLabel: string;
	sourceLabel: string;
};

export type SymbolSearchResult = {
	entry: SymbolCatalogEntry;
	matchIndex: number;
};

export type ResourceCatalogEntry = {
	descriptor: ResourceDescriptor;
	displayPath: string;
	searchKey: string;
	typeLabel: string;
	assetLabel: string;
};

export type ResourceSearchResult = {
	entry: ResourceCatalogEntry;
	matchIndex: number;
};

export type LuaCompletionKind =
	| 'keyword'
	| 'local'
	| 'global'
	| 'builtin'
	| 'api_method'
	| 'api_property'
	| 'native_method'
	| 'native_property'
	| 'module';

export type LuaCompletionItem = {
	label: string;
	insertText: string;
	sortKey: string;
	kind: LuaCompletionKind;
	detail: string;
	parameters?: readonly string[];
};

export type CompletionTrigger = 'manual' | 'typing' | 'punctuation';

export type CompletionContext =
	| {
		kind: 'global';
		prefix: string;
		row: number;
		replaceFromColumn: number;
		replaceToColumn: number;
	}
	| {
		kind: 'member';
		objectName: string;
		operator: '.' | ':';
		prefix: string;
		row: number;
		replaceFromColumn: number;
		replaceToColumn: number;
	}
	| {
		kind: 'local';
		prefix: string;
		row: number;
		replaceFromColumn: number;
		replaceToColumn: number;
	}
	;

export type CompletionSession = {
	context: CompletionContext;
	items: LuaCompletionItem[];
	filteredItems: LuaCompletionItem[];
	selectionIndex: number;
	displayOffset: number;
	anchorRow: number;
	anchorColumn: number;
	maxVisibleItems: number;
	filterCache: Map<string, LuaCompletionItem[]>;
	trigger: CompletionTrigger;
	navigationCaptured: boolean;
};

export type EditContext = {
	kind: 'insert' | 'delete' | 'replace';
	text: string;
};

export type CursorScreenInfo = {
	row: number;
	column: number;
	x: number;
	y: number;
	width: number;
	height: number;
	baseChar: string;
	baseColor: number;
};

export type ParameterHintState = {
	methodName: string;
	params: string[];
	signatureLabel: string;
	anchorRow: number;
	anchorColumn: number;
	argumentIndex: number;
	paramDescriptions?: readonly (string)[];
	methodDescription?: string;
	returnType?: string;
	returnDescription?: string;
};

export type EditorDiagnosticSeverity = 'error' | 'warning';

export type EditorDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: EditorDiagnosticSeverity;
	// Optional metadata to identify the originating tab/source
	contextId?: string;
	sourceLabel?: string;
	path?: string;
};

export type ApiCompletionMetadata = {
	params: string[];
	signature: string;
	kind: 'method' | 'getter';
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string)[];
	description?: string;
	returnType?: string;
	returnDescription?: string;
};

export type VisualLineSegment = {
	row: number;
	startColumn: number;
	endColumn: number;
};

export type CodeTabMode = 'lua' | 'aem';

export type EditorTabId = `resource:${string}` | `code:${string}`;
export type EditorTabKind = 'resource_view' | 'code_editor';
export type EditorRuntimeSyncState = 'synced' | 'restart_pending' | 'diverged';

export type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

export type CodeHoverTooltip = {
	expression: string;
	contentLines: string[];
	valueType: string;
	scope: LuaHoverScope;
	state: LuaHoverValueState;
	path: string;
	row: number;
	startColumn: number;
	endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	bubbleBounds: RectBounds;
};

export type ResourceViewerState = {
	descriptor: ResourceDescriptor;
	lines: string[];
	error: string;
	title: string;
	scroll: number;
	image?: {
		asset_id: string;
		width: number;
		height: number;
		textpagesed: boolean;
		textpageId?: number;
	};
};

export type EditorTabDescriptor = {
	id: EditorTabId | string;
	kind: EditorTabKind;
	title: string;
	closable: boolean;
	dirty: boolean;
	runtimeSyncState?: EditorRuntimeSyncState;
	runtimeSyncMessage?: string;
	resource?: ResourceViewerState;
};

export type TabDragState = {
	tabId: string;
	pointerOffset: number;
	startX: number;
	hasDragged: boolean;
};

export type CrtOptionsSnapshot = {
	noiseIntensity: number;
	colorBleed: [number, number, number];
	blurIntensity: number;
	glowColor: [number, number, number];
};

export type ResourceBrowserItem = {
	line: string;
	contentStartColumn: number;
	descriptor: ResourceDescriptor;
	location?: LuaDefinitionLocation;
	callHierarchyNodeId?: string;
	callHierarchyNodeKind?: 'root' | 'caller' | 'call';
	callHierarchyExpandable?: boolean;
	callHierarchyExpanded?: boolean;
};

export type CodeTabContext = {
	id: string;
	title: string;
	descriptor: ResourceDescriptor;
	mode: CodeTabMode;
	buffer: TextBuffer;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
	lastSavedSource: string;
	saveGeneration: number;
	appliedGeneration: number;
	undoStack: EditorUndoRecord[];
	redoStack: EditorUndoRecord[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	savePointDepth: number;
	dirty: boolean;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
	runtimeSyncState: EditorRuntimeSyncState;
	runtimeSyncMessage: string;
	readOnly?: boolean;
	textVersion: number;
};

export type SearchState = {
	field: TextField;
	active: boolean;
	visible: boolean;
	query: string;
	matches: SearchMatch[];
	currentIndex: number;
	job: SearchComputationJob;
	displayOffset: number;
	hoverIndex: number;
	scope: 'local' | 'global';
	globalMatches: GlobalSearchMatch[];
	globalJob: GlobalSearchJob;
};

export type ResourceSearchState = {
	field: TextField;
	active: boolean;
	visible: boolean;
	query: string;
	catalog: ResourceCatalogEntry[];
	matches: ResourceSearchResult[];
	selectionIndex: number;
	displayOffset: number;
	hoverIndex: number;
};

export type SymbolSearchState = {
	field: TextField;
	active: boolean;
	visible: boolean;
	query: string;
	global: boolean;
	mode: 'symbols' | 'references';
	catalog: SymbolCatalogEntry[];
	referenceCatalog: import('../editor/contrib/references/sources').ReferenceCatalogEntry[];
	catalogContext: { scope: 'local' | 'global'; path: string };
	matches: SymbolSearchResult[];
	selectionIndex: number;
	displayOffset: number;
	hoverIndex: number;
};

export type LineJumpState = {
	field: TextField;
	active: boolean;
	visible: boolean;
	value: string;
};

export type CreateResourceState = {
	field: TextField;
	active: boolean;
	visible: boolean;
	path: string;
	error: string;
	working: boolean;
	lastDirectory: string;
};

export type ActionPromptAction = 'hot-resume' | 'reboot' | 'close' | 'theme-toggle';

export type ActionPromptLayout = {
	bounds: RectBounds;
	saveAndContinue: RectBounds;
	continue: RectBounds;
	cancel: RectBounds;
};

export type ActionPromptState = {
	action: ActionPromptAction;
	layout: ActionPromptLayout | null;
};

export type EditorContextTokenKind = 'identifier' | 'keyword' | 'number' | 'string' | 'operator';

export type EditorContextMenuAction = Extract<EditorCommandId, 'goToDefinition' | 'referenceSearch' | 'callHierarchy' | 'rename'> | 'copy_token';

export type EditorContextToken = {
	kind: EditorContextTokenKind;
	text: string;
	expression: string | null;
	row: number;
	column: number;
	startColumn: number;
	endColumn: number;
};

export type EditorContextMenuEntry = {
	action: EditorContextMenuAction;
	label: string;
	enabled: boolean;
};

export type EditorContextMenuState = {
	visible: boolean;
	anchorX: number;
	anchorY: number;
	token: EditorContextToken | null;
	entries: readonly EditorContextMenuEntry[];
	hoverIndex: number;
	bounds: RectBounds;
	itemBounds: RectBounds[];
	itemCount: number;
};

export type PointerSnapshot = {
	viewportX: number;
	viewportY: number;
	insideViewport: boolean;
	valid: boolean;
	primaryPressed: boolean;
};

export type TextField = {
	text: string;
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor?: Position;
	selectionAnchorScratch: Position;
	desiredColumn?: number;
	pointerSelecting?: boolean;
	lastPointerClickTimeMs?: number;
	lastPointerClickColumn?: number;
};

export type InlineInputOptions = {
	allowSpace: boolean;
	characterFilter?: (value: string) => boolean;
	maxLength?: number;
};

export type RuntimeErrorOverlayLineRole = 'message' | 'header' | 'divider' | 'frame';

export type RuntimeErrorOverlayLineDescriptor = {
	text: string;
	role: RuntimeErrorOverlayLineRole;
	frame?: StackTraceFrame;
};

export type RuntimeErrorOverlayLayout = {
	bounds: RectBounds;
	lineRects: ReadonlyArray<RectBounds>;
	copyButtonRect: RectBounds;
	contentRightInset: number;
	// Visual line content produced by layout (word-wrapped)
	displayLines?: ReadonlyArray<string>;
	// Map from visual line index to descriptor index in 'lineDescriptors'
	displayLineMap?: ReadonlyArray<number>;
};

export type RuntimeErrorDetails = {
	message: string;
	luaStack: ReadonlyArray<StackTraceFrame>;
	jsStack: ReadonlyArray<StackTraceFrame>;
};

export type FaultSnapshot = {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	timestampMs?: number;
	fromDebugger: boolean;
};

export type RuntimeErrorOverlay = {
	row: number;
	column: number;
	message: string;
	lines: string[];
	timer: number;
	messageLines: string[];
	lineDescriptors: RuntimeErrorOverlayLineDescriptor[];
	layout: RuntimeErrorOverlayLayout;
	details: RuntimeErrorDetails;
	expanded: boolean;
	hovered: boolean;
	hoverLine: number;
	copyButtonHovered: boolean;
	hidden: boolean;
};

export type DiagnosticsCacheEntry = {
	contextId: string;
	path: string;
	diagnostics: EditorDiagnostic[];
	version: number;
	source: string;
};

export type SearchComputationJob = {
	query: string;
	nextRow: number;
	matches: SearchMatch[];
	firstMatchAfterCursor: number;
	cursorRow: number;
	cursorColumn: number;
};

export type GlobalSearchJob = {
	query: string;
	descriptors: ResourceDescriptor[];
	descriptorIndex: number;
	currentLines: string[];
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
};
