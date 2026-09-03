import type {
	LuaDefinitionLocation,
	LuaSymbolEntry,
} from '../../toolchain/ts/lua/semantic_contracts';
import type { ResourceDomain, RuntimeResource } from './resource';
import type { EditorCommandId } from './commands';
import type { RectBounds } from '../../machine/ts/common/rect';
import type { LuaMemberCompletionContext } from '../../toolchain/ts/lua/semantic/completion';
import type { CodeEditorInputId } from './editor_context';
export type { RuntimeResource } from './resource';

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
	resource: RuntimeResource;
	pathLabel: string;
	row: number;
	start: number;
	end: number;
	snippet: string;
	path: string;
};

export type CodeEditorViewSnapshot = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
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
	catalogIndex: number;
};

export type ResourceCatalogEntry = {
	resource: RuntimeResource;
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
	| 'native_method'
	| 'native_property'
	| 'member';

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
		member: LuaMemberCompletionContext;
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

export type EditorDiagnosticSeverity = 'error' | 'warning';

export type EditorDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: EditorDiagnosticSeverity;
	contextId: CodeEditorInputId;
	sourceLabel?: string;
	path?: string;
};

export type VisualLineSegment = {
	row: number;
	startColumn: number;
	endColumn: number;
};

export type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

export type CrtOptionsSnapshot = {
	noiseIntensity: number;
	colorBleed: [number, number, number];
	blurIntensity: number;
	glowColor: [number, number, number];
};

export type ResourceBrowserItem = {
	line: string;
	contentStartColumn: number;
	resource: RuntimeResource;
	location?: LuaDefinitionLocation;
	callHierarchyNodeId?: string;
	callHierarchyExpandable?: boolean;
	callHierarchyExpanded?: boolean;
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
	mode: 'symbols' | 'references' | 'definitions';
	catalog: SymbolCatalogEntry[];
	locationCatalog: SymbolCatalogEntry[];
	catalogContext: { scope: 'local' | 'global'; domain: ResourceDomain; path: string };
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

export type DiagnosticsCacheEntry = {
	contextId: CodeEditorInputId;
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
	resources: RuntimeResource[];
	resourceIndex: number;
	currentLines: string[];
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
};
