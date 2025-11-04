import type {
	BmsxConsoleMetadata,
	ConsoleLuaBuiltinDescriptor,
	ConsoleLuaHoverRequest,
	ConsoleLuaHoverResult,
	ConsoleLuaMemberCompletion,
	ConsoleLuaMemberCompletionRequest,
	ConsoleLuaHoverScope,
	ConsoleLuaHoverValueState,
	ConsoleLuaResourceCreationRequest,
	ConsoleLuaSymbolEntry,
	ConsoleResourceDescriptor,
	ConsoleViewport,
} from '../types';
import type { ConsoleFontVariant } from '../font';
import type { RectBounds } from '../../rompack/rompack';

export type ConsoleEditorOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	metadata: BmsxConsoleMetadata;
	loadSource: () => string;
	saveSource: (source: string) => Promise<void>;
	listResources: () => ConsoleResourceDescriptor[];
	loadLuaResource: (assetId: string) => string;
	saveLuaResource: (assetId: string, source: string) => Promise<void>;
	createLuaResource: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	inspectLuaExpression: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	listLuaObjectMembers: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
	listLuaModuleSymbols: (moduleName: string) => ConsoleLuaSymbolEntry[];
	primaryAssetId: string | null;
	listLuaSymbols: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbols: () => ConsoleLuaSymbolEntry[];
	listBuiltinLuaFunctions: () => ConsoleLuaBuiltinDescriptor[];
	fontVariant?: ConsoleFontVariant;
};

export type Position = { row: number; column: number };

export type MessageState = {
	text: string;
	color: number;
	timer: number;
	visible: boolean;
};

export type HighlightLine = {
	chars: string[];
	colors: number[];
	columnToDisplay: number[];
};

export type CachedHighlight = {
	src: string;
	hi: HighlightLine;
	displayToColumn: number[];
	advancePrefix: number[];
	rowSignature: number;
};

export type SearchMatch = {
	row: number;
	start: number;
	end: number;
};

export type EditorSnapshot = {
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position | null;
	dirty: boolean;
};

export type SymbolCatalogEntry = {
	symbol: ConsoleLuaSymbolEntry;
	displayName: string;
	searchKey: string;
	line: number;
	kindLabel: string;
	sourceLabel: string | null;
};

export type SymbolSearchResult = {
	entry: SymbolCatalogEntry;
	matchIndex: number;
};

export type ResourceCatalogEntry = {
	descriptor: ConsoleResourceDescriptor;
	displayPath: string;
	searchKey: string;
	typeLabel: string;
	assetLabel: string | null;
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
	detail: string | null;
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
    sourceLabel?: string | null;
    assetId?: string | null;
    chunkName?: string | null;
};

export type ApiCompletionMetadata = {
	params: string[];
	signature: string;
	kind: 'method' | 'getter';
};

export type VisualLineSegment = {
	row: number;
	startColumn: number;
	endColumn: number;
};

export type TopBarButtonId = 'resume' | 'reboot' | 'save' | 'resources' | 'problems' | 'filter' | 'resolution' | 'wrap';

export type EditorTabId = `resource:${string}` | `lua:${string}`;
export type EditorTabKind = 'resource_view' | 'lua_editor';

export type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

export type EditorResolutionMode = 'offscreen' | 'viewport';

export type CodeHoverTooltip = {
	expression: string;
	contentLines: string[];
	valueType: string;
	scope: ConsoleLuaHoverScope;
	state: ConsoleLuaHoverValueState;
	assetId: string | null;
	row: number;
	startColumn: number;
	endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	bubbleBounds: RectBounds | null;
};

export type ResourceViewerState = {
	descriptor: ConsoleResourceDescriptor;
	lines: string[];
	error: string | null;
	title: string;
	scroll: number;
	image?: {
		assetId: string;
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
	descriptor: ConsoleResourceDescriptor | null;
};

export type CodeTabContext = {
	id: string;
	title: string;
	descriptor: ConsoleResourceDescriptor | null;
	load: () => string;
	save: (source: string) => Promise<void>;
	snapshot: EditorSnapshot | null;
	lastSavedSource: string;
	saveGeneration: number;
	appliedGeneration: number;
	dirty: boolean;
	runtimeErrorOverlay: RuntimeErrorOverlay | null;
	executionStopRow: number | null;
};

export type PendingActionPrompt = {
	action: 'resume' | 'reboot' | 'close';
};

export type ConsoleRuntimeBridge = {
	getState(): unknown;
	setState(state: unknown): void;
	boot(reason?: string): void;
	reloadLuaProgram(source: string): Promise<void>;
	resumeFromSnapshot(state: unknown): void;
	setEditorOverlayResolution(mode: EditorResolutionMode): void;
	isLuaRuntimeFailed(): boolean;
};

export type ConsoleEditorSerializedState = {
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
	runtimeErrorOverlay: RuntimeErrorOverlay | null;
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
	lastPressId: number | null;
};

export type InlineTextField = {
	text: string;
	cursor: number;
	selectionAnchor: number | null;
	desiredColumn: number;
	pointerSelecting: boolean;
	lastPointerClickTimeMs: number;
	lastPointerClickColumn: number;
};

export type InlineInputOptions = {
	ctrlDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
	altDown: boolean;
	deltaSeconds: number;
	allowSpace: boolean;
	characterFilter?: (value: string) => boolean;
	maxLength?: number | null;
};

export type RuntimeErrorStackFrameOrigin = 'lua' | 'js';

export type RuntimeErrorStackFrame = {
	origin: RuntimeErrorStackFrameOrigin;
	functionName: string | null;
	source: string | null;
	line: number | null;
	column: number | null;
	raw: string;
	chunkAssetId?: string | null;
	chunkPath?: string | null;
};

export type RuntimeErrorOverlayLineRole = 'message' | 'header' | 'divider' | 'frame';

export type RuntimeErrorOverlayLineDescriptor = {
	text: string;
	role: RuntimeErrorOverlayLineRole;
	frame?: RuntimeErrorStackFrame;
};

export type RuntimeErrorOverlayLayout = {
    bounds: RectBounds;
    lineRects: ReadonlyArray<RectBounds>;
    // Visual line content produced by layout (word-wrapped)
    displayLines?: ReadonlyArray<string>;
    // Map from visual line index to descriptor index in 'lineDescriptors'
    displayLineMap?: ReadonlyArray<number>;
};

export type RuntimeErrorDetails = {
	message: string;
	luaStack: ReadonlyArray<RuntimeErrorStackFrame>;
	jsStack: ReadonlyArray<RuntimeErrorStackFrame>;
};

export type RuntimeErrorOverlay = {
	row: number;
	column: number;
	lines: string[];
	timer: number;
	messageLines: string[];
	lineDescriptors: RuntimeErrorOverlayLineDescriptor[];
	layout: RuntimeErrorOverlayLayout | null;
	details: RuntimeErrorDetails | null;
	expanded: boolean;
	hovered: boolean;
	hoverLine: number;
};

export type RepeatEntry = {
	cooldown: number;
};
