import type {
	VMLuaHoverScope,
	VMLuaHoverValueState,
	VMLuaSymbolEntry,
	VMResourceDescriptor,
} from '../types';
import type { StackTraceFrame } from '../../lua/luavalue';
import { MENU_COMMANDS } from './ide_input';
import { RectBounds } from '../../rompack/rompack';
import type { TextBuffer } from './text_buffer';
import type { EditorUndoRecord } from './editor_undo';

export type IdeThemeVariant = string;

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
	rowSignature: number;
	srcHash: number;
};

export type SearchMatch = {
	row: number;
	start: number;
	end: number;
};

export type GlobalSearchMatch = {
	descriptor: VMResourceDescriptor;
	pathLabel: string;
	row: number;
	start: number;
	end: number;
	snippet: string;
	chunkName: string;
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
	symbol: VMLuaSymbolEntry;
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
	descriptor: VMResourceDescriptor;
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
	asset_id?: string;
	chunkName?: string;
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

export type TopBarButtonId = typeof MENU_COMMANDS[number];
export type MenuId = 'file' | 'run' | 'view' | 'debug';

export type DebugPanelKind = 'objects' | 'events' | 'registry';

export type EditorTabId = `resource:${string}` | `lua:${string}` | `debug:${string}`;
export type EditorTabKind = 'resource_view' | 'lua_editor';

export type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

export type EditorResolutionMode = 'offscreen' | 'viewport';

export type CodeHoverTooltip = {
	expression: string;
	contentLines: string[];
	valueType: string;
	scope: VMLuaHoverScope;
	state: VMLuaHoverValueState;
	asset_id: string;
	row: number;
	startColumn: number;
	endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	bubbleBounds: RectBounds;
};

export type ResourceViewerState = {
	descriptor: VMResourceDescriptor;
	lines: string[];
	error: string;
	title: string;
	scroll: number;
	image?: {
		asset_id: string;
		width: number;
		height: number;
		atlassed: boolean;
		atlasId?: number;
	};
};

export type EditorTabDescriptor = {
	id: EditorTabId | string;
	kind: EditorTabKind;
	title: string;
	closable: boolean;
	dirty: boolean;
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
	descriptor: VMResourceDescriptor;
};

export type CodeTabContext = {
	id: string;
	title: string;
	descriptor: VMResourceDescriptor;
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
	readOnly?: boolean;
	textVersion: number;
};

export type PendingActionPrompt = {
	action: 'hot-reload-and-resume' | 'reboot' | 'close' | 'theme-toggle';
};

export type VMEditorSerializedState = {
	active: boolean;
	activeTab: EditorTabKind;
	snapshot: EditorSnapshot;
	searchQuery: string;
	searchMatches: SearchMatch[];
	searchCurrentIndex: number;
	searchActive: boolean;
	searchVisible: boolean;
	lineJumpValue: string;
	lineJumpActive: boolean;
	lineJumpVisible: boolean;
	message: MessageState;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	saveGeneration: number;
	appliedGeneration: number;
};

export type PointerSnapshot = {
	viewportX: number;
	viewportY: number;
	insideViewport: boolean;
	valid: boolean;
	primaryPressed: boolean;
};

export type KeyPressRecord = {
	lastPressId: number;
	downLatched?: boolean;
};

export type TextField = {
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor?: Position;
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
	chunkName: string;
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
	descriptors: VMResourceDescriptor[];
	descriptorIndex: number;
	currentLines: string[];
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
};
