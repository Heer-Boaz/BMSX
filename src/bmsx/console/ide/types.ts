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
	IdeThemeVariant,
} from '../types';
import type { ConsoleFontVariant } from '../font';
import type { CanonicalizationType, RectBounds } from '../../rompack/rompack';
import type { StackTraceFrame } from '../../lua/runtime';
import { MENU_COMMANDS } from './ide_input';

export type { IdeThemeVariant } from '../types';

export type ConsoleEditorOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	metadata: BmsxConsoleMetadata;
	canonicalization?: CanonicalizationType;
	themeVariant?: IdeThemeVariant;
	loadSource: () => string;
	saveSource: (source: string) => Promise<void>;
	listResources: () => ConsoleResourceDescriptor[];
	loadLuaResource: (asset_id: string) => string;
	saveLuaResource: (asset_id: string, source: string) => Promise<void>;
	createLuaResource: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	inspectLuaExpression: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	listLuaObjectMembers: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
	listLuaModuleSymbols: (moduleName: string) => ConsoleLuaSymbolEntry[];
	entryAssetId: string | null;
	listLuaSymbols: (asset_id: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbols: () => ConsoleLuaSymbolEntry[];
	listBuiltinLuaFunctions: () => ConsoleLuaBuiltinDescriptor[];
	fontVariant?: ConsoleFontVariant;
	workspaceRootPath?: string | null;
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

export type GlobalSearchMatch = {
	descriptor: ConsoleResourceDescriptor | null;
	pathLabel: string;
	row: number;
	start: number;
	end: number;
	snippet: string;
	asset_id: string | null;
	chunkName: string | null;
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
	paramDescriptions?: readonly (string | null)[];
	methodDescription?: string | null;
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
	asset_id?: string | null;
	chunkName?: string | null;
};

export type ApiCompletionMetadata = {
	params: string[];
	signature: string;
	kind: 'method' | 'getter';
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string | null)[];
	description?: string | null;
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
	scope: ConsoleLuaHoverScope;
	state: ConsoleLuaHoverValueState;
	asset_id: string | null;
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
	readOnly?: boolean;
};

export type PendingActionPrompt = {
	action: 'hot-reload-and-resume' | 'reboot' | 'close' | 'theme-toggle';
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
	downLatched?: boolean;
};

export type TextField = {
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor?: Position | null;
	desiredColumn?: number;
	pointerSelecting?: boolean;
	lastPointerClickTimeMs?: number;
	lastPointerClickColumn?: number;
};

export type InlineInputOptions = {
	deltaSeconds: number;
	allowSpace: boolean;
	characterFilter?: (value: string) => boolean;
	maxLength?: number | null;
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
	layout: RuntimeErrorOverlayLayout | null;
	details: RuntimeErrorDetails | null;
	expanded: boolean;
	hovered: boolean;
	hoverLine: number;
	copyButtonHovered: boolean;
	hidden: boolean;
};

export type RepeatEntry = {
	cooldown: number;
};

export type DiagnosticsCacheEntry = {
	contextId: string;
	chunkName: string | null;
	diagnostics: EditorDiagnostic[];
};

export type SearchComputationJob = {
	query: string;
	version: number;
	nextRow: number;
	matches: SearchMatch[];
	firstMatchAfterCursor: number;
	cursorRow: number;
	cursorColumn: number;
};

export type GlobalSearchJob = {
	query: string;
	descriptors: ConsoleResourceDescriptor[];
	descriptorIndex: number;
	currentLines: string[] | null;
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
};
