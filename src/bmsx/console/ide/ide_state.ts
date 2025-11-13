import type {
	BmsxConsoleMetadata,
	ConsoleLuaBuiltinDescriptor,
	ConsoleLuaHoverRequest,
	ConsoleLuaHoverResult,
	ConsoleLuaMemberCompletion,
	ConsoleLuaMemberCompletionRequest,
	ConsoleLuaResourceCreationRequest,
	ConsoleLuaSymbolEntry,
	ConsoleResourceDescriptor,
} from '../types';
import type { ConsoleFontVariant } from '../font';
import type { ConsoleEditorFont } from '../editor_font';
import type { InlineTextField, ScrollbarKind, MessageState } from './types';
import type { InlineFieldMetrics } from './inline_text_field';
import { ConsoleScrollbar, ScrollbarController } from './scrollbar';
import type { InputController } from './input_controller';
import type { ProblemsPanelController } from './problems_panel';
import { ResourcePanelController } from './resource_panel_controller';
import type { RenameController } from './rename_controller';
import { LuaSemanticWorkspace } from './semantic_workspace';
import type { CompletionController } from './completion_controller';
import { createMessageController } from './console_cart_editor_messages';
import { ReferenceState } from './reference_navigation';
import { CHARACTER_CODES } from './character_map';
import type {
	Position,
	EditorSnapshot,
	CodeHoverTooltip,
	PointerSnapshot,
	RepeatEntry,
	RuntimeErrorOverlay,
	EditorDiagnostic,
	DiagnosticsCacheEntry,
	CodeTabContext,
	TopBarButtonId,
	PendingActionPrompt,
	TabDragState,
	CrtOptionsSnapshot,
	EditorResolutionMode,
	EditContext,
	CursorScreenInfo,
	SymbolCatalogEntry,
	SymbolSearchResult,
	ResourceCatalogEntry,
	ResourceSearchResult,
	SearchMatch,
	SearchComputationJob,
	GlobalSearchMatch,
	GlobalSearchJob,
	EditorTabDescriptor,
	ResourceBrowserItem,
	VisualLineSegment,
} from './types';
import type { RectBounds } from '../../rompack/rompack';
import type { ReferenceCatalogEntry } from './reference_sources';
import { ConsoleCodeLayout } from './code_layout';
import type { TimerHandle } from '../../platform';
import type { DebuggerExecutionState } from '../debugger_lifecycle';
import type { LuaDebuggerSessionMetrics } from '../../lua/debugger.ts';
import { EDITOR_TOGGLE_KEY, ESCAPE_KEY } from './constants';

export type NavigationHistoryEntry = {
	contextId: string;
	assetId: string | null;
	chunkName: string | null;
	path: string | null;
	row: number;
	column: number;
};

export const captureKeys: string[] = [...new Set([
	EDITOR_TOGGLE_KEY,
	ESCAPE_KEY,
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Backspace',
	'Delete',
	'Enter',
	'NumpadEnter',
	'End',
	'Home',
	'PageDown',
	'PageUp',
	'Space',
	'Tab',
	'F3',
	'F5',
	'F9',
	'F10',
	'F11',
	'F12',
	'NumpadDivide',
	...CHARACTER_CODES,
])];

export const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];

export const NAVIGATION_HISTORY_LIMIT = 64;

export const diagnosticsDebounceMs = 200;

export const WORKSPACE_AUTOSAVE_INTERVAL_MS = 2500;
export const workspaceDirtyCache = new Map<string, string>();

export type DebuggerControlsState = {
	executionState: DebuggerExecutionState;
	sessionMetrics: LuaDebuggerSessionMetrics | null;
};

export interface IdeState {
	playerIndex: number;
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	caseInsensitive: boolean;
	preMutationSource: string | null;
	scrollRow: number;
	scrollColumn: number;
	dirty: boolean;
	desiredColumn: number;
	desiredDisplayOffset: number;
	selectionAnchor: Position | null;
	undoStack: EditorSnapshot[];
	redoStack: EditorSnapshot[];
	lastHistoryKey: string | null;
	lastHistoryTimestamp: number;
	metadata: BmsxConsoleMetadata;
	fontVariant: ConsoleFontVariant;
	loadSourceFn: () => string;
	saveSourceFn: (source: string) => Promise<void>;
	loadLuaResourceFn: (assetId: string) => string;
	saveLuaResourceFn: (assetId: string, source: string) => Promise<void>;
	createLuaResourceFn: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	listResourcesFn: () => ConsoleResourceDescriptor[];
	inspectLuaExpressionFn: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	listLuaObjectMembersFn: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
	listLuaModuleSymbolsFn: (moduleName: string) => ConsoleLuaSymbolEntry[];
	listLuaSymbolsFn: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
	listBuiltinLuaFunctionsFn: () => ConsoleLuaBuiltinDescriptor[];
	primaryAssetId: string | null;
	builtinIdentifierCache: { key: string; set: ReadonlySet<string> } | null;
	hoverTooltip: CodeHoverTooltip | null;
	lastPointerSnapshot: PointerSnapshot | null;
	lastInspectorResult: ConsoleLuaHoverResult | null;
	inspectorRequestFailed: boolean;
	gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string } | null;
	viewportWidth: number;
	viewportHeight: number;
	font: ConsoleEditorFont;
	lineHeight: number;
	charAdvance: number;
	spaceAdvance: number;
	gutterWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	tabBarRowCount: number;
	baseBottomMargin: number;
	repeatState: Map<string, RepeatEntry>;
	deferredMessageDuration: number | null;
	runtimeErrorOverlay: RuntimeErrorOverlay | null;
	executionStopRow: number | null;
	clockNow: () => number;
	problemsPanel: ProblemsPanelController;
	problemsPanelResizing: boolean;
	diagnostics: EditorDiagnostic[];
	diagnosticsByRow: Map<number, EditorDiagnostic[]>;
	diagnosticsDirty: boolean;
	diagnosticsCache: Map<string, DiagnosticsCacheEntry>;
	dirtyDiagnosticContexts: Set<string>;
	diagnosticsDueAtMs: number | null;
	diagnosticsComputationScheduled: boolean;
	codeTabContexts: Map<string, CodeTabContext>;
	activeCodeTabContextId: string | null;
	entryTabId: string | null;
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
	debuggerControls: DebuggerControlsState;
	breakpoints: Map<string, Set<number>>;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
	activeContextReadOnly: boolean;
	resourceViewerSpriteId: string | null;
	resourceViewerSpriteAsset: string | null;
	resourceViewerSpriteScale: number;
	actionPromptButtons: { saveAndContinue: RectBounds | null; continue: RectBounds; cancel: RectBounds };
	pendingActionPrompt: PendingActionPrompt | null;
	active: boolean;
	message: MessageState;
	showMessage: (text: string, color: number, durationSeconds: number) => void;
	updateMessage: (deltaSeconds: number) => void;
	showWarningBanner: (text: string, durationSeconds?: number) => void;
	blinkTimer: number;
	cursorVisible: boolean;
	warnNonMonospace: boolean;
	pointerSelecting: boolean;
	pointerPrimaryWasPressed: boolean;
	pointerAuxWasPressed: boolean;
	searchField: InlineTextField;
	symbolSearchField: InlineTextField;
	resourceSearchField: InlineTextField;
	lineJumpField: InlineTextField;
	createResourceField: InlineTextField;
	inlineFieldMetricsRef: InlineFieldMetrics;
	scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
	scrollbarController: ScrollbarController;
	input: InputController;
	toggleInputLatch: boolean;
	windowFocused: boolean;
	pendingWindowFocused: boolean;
	disposeVisibilityListener: (() => void) | null;
	disposeWindowEventListeners: (() => void) | null;
	lastPointerClickTimeMs: number;
	lastPointerClickRow: number;
	lastPointerClickColumn: number;
	tabHoverId: string | null;
	tabDragState: TabDragState | null;
	crtOptionsSnapshot: CrtOptionsSnapshot | null;
	resolutionMode: EditorResolutionMode;
	cursorRevealSuspended: boolean;
	searchActive: boolean;
	searchVisible: boolean;
	searchQuery: string;
	symbolSearchQuery: string;
	resourceSearchQuery: string;
	pendingEditContext: EditContext | null;
	cursorScreenInfo: CursorScreenInfo | null;
	lineJumpActive: boolean;
	symbolSearchActive: boolean;
	symbolSearchVisible: boolean;
	symbolSearchGlobal: boolean;
	symbolSearchMode: 'symbols' | 'references';
	resourceSearchActive: boolean;
	resourceSearchVisible: boolean;
	lineJumpVisible: boolean;
	lineJumpValue: string;
	createResourceActive: boolean;
	createResourceVisible: boolean;
	createResourcePath: string;
	createResourceError: string | null;
	createResourceWorking: boolean;
	lastCreateResourceDirectory: string | null;
	symbolCatalog: SymbolCatalogEntry[];
	referenceCatalog: ReferenceCatalogEntry[];
	symbolCatalogContext: { scope: 'local' | 'global'; assetId: string | null; chunkName: string | null } | null;
	symbolSearchMatches: SymbolSearchResult[];
	symbolSearchSelectionIndex: number;
	symbolSearchDisplayOffset: number;
	symbolSearchHoverIndex: number;
	resourceCatalog: ResourceCatalogEntry[];
	resourceSearchMatches: ResourceSearchResult[];
	resourceSearchSelectionIndex: number;
	resourceSearchDisplayOffset: number;
	resourceSearchHoverIndex: number;
	searchMatches: SearchMatch[];
	searchCurrentIndex: number;
	searchJob: SearchComputationJob | null;
	searchDisplayOffset: number;
	searchHoverIndex: number;
	searchScope: 'local' | 'global';
	globalSearchMatches: GlobalSearchMatch[];
	globalSearchJob: GlobalSearchJob | null;
	diagnosticsTaskPending: boolean;
	lastReportedSemanticError: string | null;
	referenceState: ReferenceState;
	textVersion: number;
	saveGeneration: number;
	appliedGeneration: number;
	lastSavedSource: string;
	tabs: EditorTabDescriptor[];
	activeTabId: string | null;
	resourceBrowserItems: ResourceBrowserItem[];
	resourceBrowserSelectionIndex: number;
	resourcePanelVisible: boolean;
	resourcePanelFocused: boolean;
	resourcePanelResourceCount: number;
	pendingResourceSelectionAssetId: string | null;
	resourcePanelWidthRatio: number | null;
	resourcePanelResizing: boolean;
	resourcePanel: ResourcePanelController;
	renameController: RenameController;
	semanticWorkspace: LuaSemanticWorkspace;
	layout: ConsoleCodeLayout;
	codeVerticalScrollbarVisible: boolean;
	codeHorizontalScrollbarVisible: boolean;
	cachedVisibleRowCount: number;
	cachedVisibleColumnCount: number;
	dimCrtInEditor: boolean;
	wordWrapEnabled: boolean;
	lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment | null } | null;
	completion: CompletionController;
	navigationHistory: {
		back: NavigationHistoryEntry[];
		forward: NavigationHistoryEntry[];
		current: NavigationHistoryEntry | null;
	};
	navigationCaptureSuspended: boolean;
	customClipboard: string | null;
	workspaceAutosaveEnabled: boolean;
	workspaceAutosaveSignature: string;
	workspaceAutosaveHandle: TimerHandle | { cancel(): void } | null;
	workspaceAutosaveRunning: boolean;
	workspaceAutosaveQueued: boolean;
	disposeWorkspaceExitListener: (() => void) | null;
	workspaceRestorePromise: Promise<void> | null;
	serverWorkspaceConnected: boolean;
}

export const ide_state: IdeState = {
	playerIndex: 0,
	lines: [''],
	cursorRow: 0,
	cursorColumn: 0,
	caseInsensitive: true,
	preMutationSource: null,
	scrollRow: 0,
	scrollColumn: 0,
	dirty: false,
	desiredColumn: 0,
	desiredDisplayOffset: 0,
	selectionAnchor: null,
	undoStack: [],
	redoStack: [],
	lastHistoryKey: null,
	lastHistoryTimestamp: 0,
	metadata: undefined!,
	fontVariant: undefined!,
	loadSourceFn: undefined!,
	saveSourceFn: undefined!,
	loadLuaResourceFn: undefined!,
	saveLuaResourceFn: undefined!,
	createLuaResourceFn: undefined!,
	listResourcesFn: undefined!,
	inspectLuaExpressionFn: undefined!,
	listLuaObjectMembersFn: undefined!,
	listLuaModuleSymbolsFn: undefined!,
	listLuaSymbolsFn: undefined!,
	listGlobalLuaSymbolsFn: undefined!,
	listBuiltinLuaFunctionsFn: undefined!,
	primaryAssetId: null,
	builtinIdentifierCache: null,
	hoverTooltip: null,
	lastPointerSnapshot: null,
	lastInspectorResult: null,
	inspectorRequestFailed: false,
	gotoHoverHighlight: null,
	viewportWidth: 0,
	viewportHeight: 0,
	font: undefined!,
	lineHeight: 0,
	charAdvance: 0,
	spaceAdvance: 0,
	gutterWidth: 0,
	headerHeight: 0,
	tabBarHeight: 0,
	tabBarRowCount: 1,
	baseBottomMargin: 0,
	repeatState: new Map<string, RepeatEntry>(),
	deferredMessageDuration: null,
	runtimeErrorOverlay: null,
	executionStopRow: null,
	clockNow: undefined!,
	problemsPanel: undefined!,
	problemsPanelResizing: false,
	diagnostics: [],
	diagnosticsByRow: new Map<number, EditorDiagnostic[]>(),
	diagnosticsDirty: true,
	diagnosticsCache: new Map<string, DiagnosticsCacheEntry>(),
	dirtyDiagnosticContexts: new Set<string>(),
	diagnosticsDueAtMs: null,
	diagnosticsComputationScheduled: false,
	codeTabContexts: new Map<string, CodeTabContext>(),
	activeCodeTabContextId: null,
	entryTabId: null,
	topBarButtonBounds: {
		resume: { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
		problems: { left: 0, top: 0, right: 0, bottom: 0 },
		filter: { left: 0, top: 0, right: 0, bottom: 0 },
		resolution: { left: 0, top: 0, right: 0, bottom: 0 },
		wrap: { left: 0, top: 0, right: 0, bottom: 0 },
		debugContinue: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOver: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepInto: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOut: { left: 0, top: 0, right: 0, bottom: 0 },
		debugObjects: { left: 0, top: 0, right: 0, bottom: 0 },
		debugEvents: { left: 0, top: 0, right: 0, bottom: 0 },
		debugRegistry: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	debuggerControls: {
		executionState: 'inactive',
		sessionMetrics: null,
	},
	breakpoints: new Map<string, Set<number>>(),
	tabButtonBounds: new Map<string, RectBounds>(),
	tabCloseButtonBounds: new Map<string, RectBounds>(),
	activeContextReadOnly: false,
	resourceViewerSpriteId: null,
	resourceViewerSpriteAsset: null,
	resourceViewerSpriteScale: 1,
	actionPromptButtons: {
		saveAndContinue: null,
		continue: { left: 0, top: 0, right: 0, bottom: 0 },
		cancel: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	pendingActionPrompt: null,
	active: false,
	message: undefined!,
	showMessage: undefined!,
	updateMessage: undefined!,
	showWarningBanner: undefined!,
	blinkTimer: 0,
	cursorVisible: true,
	warnNonMonospace: false,
	pointerSelecting: false,
	pointerPrimaryWasPressed: false,
	pointerAuxWasPressed: false,
	searchField: undefined!,
	symbolSearchField: undefined!,
	resourceSearchField: undefined!,
	lineJumpField: undefined!,
	createResourceField: undefined!,
	inlineFieldMetricsRef: undefined!,
	scrollbars: undefined!,
	scrollbarController: undefined!,
	input: undefined!,
	toggleInputLatch: false,
	windowFocused: true,
	pendingWindowFocused: true,
	disposeVisibilityListener: null,
	disposeWindowEventListeners: null,
	lastPointerClickTimeMs: 0,
	lastPointerClickRow: -1,
	lastPointerClickColumn: -1,
	tabHoverId: null,
	tabDragState: null,
	crtOptionsSnapshot: null,
	resolutionMode: 'viewport',
	cursorRevealSuspended: false,
	searchActive: false,
	searchVisible: false,
	searchQuery: '',
	symbolSearchQuery: '',
	resourceSearchQuery: '',
	pendingEditContext: null,
	cursorScreenInfo: null,
	lineJumpActive: false,
	symbolSearchActive: false,
	symbolSearchVisible: false,
	symbolSearchGlobal: false,
	symbolSearchMode: 'symbols',
	resourceSearchActive: false,
	resourceSearchVisible: false,
	lineJumpVisible: false,
	lineJumpValue: '',
	createResourceActive: false,
	createResourceVisible: false,
	createResourcePath: '',
	createResourceError: null,
	createResourceWorking: false,
	lastCreateResourceDirectory: null,
	symbolCatalog: [],
	referenceCatalog: [],
	symbolCatalogContext: null,
	symbolSearchMatches: [],
	symbolSearchSelectionIndex: -1,
	symbolSearchDisplayOffset: 0,
	symbolSearchHoverIndex: -1,
	resourceCatalog: [],
	resourceSearchMatches: [],
	resourceSearchSelectionIndex: -1,
	resourceSearchDisplayOffset: 0,
	resourceSearchHoverIndex: -1,
	searchMatches: [],
	searchCurrentIndex: -1,
	searchJob: null,
	searchDisplayOffset: 0,
	searchHoverIndex: -1,
	searchScope: 'local',
	globalSearchMatches: [],
	globalSearchJob: null,
	diagnosticsTaskPending: false,
	lastReportedSemanticError: null,
	referenceState: new ReferenceState(),
	textVersion: 0,
	saveGeneration: 0,
	appliedGeneration: 0,
	lastSavedSource: '',
	tabs: [],
	activeTabId: null,
	resourceBrowserItems: [],
	resourceBrowserSelectionIndex: -1,
	resourcePanelVisible: false,
	resourcePanelFocused: false,
	resourcePanelResourceCount: 0,
	pendingResourceSelectionAssetId: null,
	resourcePanelWidthRatio: null,
	resourcePanelResizing: false,
	resourcePanel: undefined!,
	renameController: undefined!,
	semanticWorkspace: new LuaSemanticWorkspace(),
	layout: undefined!,
	codeVerticalScrollbarVisible: false,
	codeHorizontalScrollbarVisible: false,
	cachedVisibleRowCount: 1,
	cachedVisibleColumnCount: 1,
	dimCrtInEditor: false,
	wordWrapEnabled: true,
	lastPointerRowResolution: null,
	completion: undefined!,
	navigationHistory: {
		back: [] as NavigationHistoryEntry[],
		forward: [] as NavigationHistoryEntry[],
		current: null as NavigationHistoryEntry | null,
	},
	navigationCaptureSuspended: false,
	customClipboard: null,
	workspaceAutosaveEnabled: false,
	workspaceAutosaveSignature: null,
	workspaceAutosaveHandle: null,
	workspaceAutosaveRunning: false,
	workspaceAutosaveQueued: false,
	disposeWorkspaceExitListener: null,
	workspaceRestorePromise: null,
	serverWorkspaceConnected: false,
};

// Initialize message controller
const messageController = createMessageController({
	isActive: () => ide_state.active,
	getDeferredDuration: () => ide_state.deferredMessageDuration,
	setDeferredDuration: (value) => { ide_state.deferredMessageDuration = value; },
});

ide_state.message = messageController.message;
ide_state.showMessage = messageController.showMessage;
ide_state.updateMessage = messageController.updateMessage;
ide_state.showWarningBanner = messageController.showWarningBanner;
