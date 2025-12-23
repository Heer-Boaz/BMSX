import type {
	VMLuaHoverResult,
} from '../types';
import type { VMFontVariant } from '../font';
import type { TextField, ScrollbarKind, MessageState, IdeThemeVariant } from './types';
import type { InlineFieldMetrics } from './inline_text_field';
import { VMScrollbar, ScrollbarController } from './scrollbar';
import type { InputController } from './ide_input';
import type { ProblemsPanelController } from './problems_panel';
import { ResourcePanelController } from './resource_panel_controller';
import type { RenameController } from './rename_controller';
import { type LuaSemanticWorkspace } from './semantic_model';
import type { CompletionController } from './completion_controller';
import { createMessageController } from './message_controller';
import { ReferenceState } from './code_reference';
import { CHARACTER_CODES } from './character_map';
import type {
	Position,
	CodeHoverTooltip,
	PointerSnapshot,
	RuntimeErrorOverlay,
	EditorDiagnostic,
	DiagnosticsCacheEntry,
	CodeTabContext,
	TopBarButtonId,
	MenuId,
	PendingActionPrompt,
	TabDragState,
	CrtOptionsSnapshot,
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
import type { TextBuffer } from './text_buffer';
import { PieceTreeBuffer } from './piece_tree_buffer';
import type { EditorUndoRecord } from './editor_undo';
import type { CanonicalizationType, RectBounds } from '../../rompack/rompack';
import type { ReferenceCatalogEntry } from './code_reference';
import { VMCodeLayout } from './code_layout';
import type { TimerHandle, SubscriptionHandle } from '../../platform';
import type { DebuggerExecutionState } from './ide_debugger';
import type { LuaDebuggerSessionMetrics } from '../../lua/luadebugger';
import { VM_TOGGLE_KEY, EDITOR_TOGGLE_KEY, ESCAPE_KEY, getActiveIdeThemeVariant } from './constants';
import { CaretNavigationState } from './caret';
import { VMEditorFont } from '../editor_font';

type BuiltinIdentifierCache = {
	epoch: number;
	ids: ReadonlySet<string>;
	canonicalization: CanonicalizationType;
	caseInsensitive: boolean;
};

export type NavigationHistoryEntry = {
	contextId: string;
	path: string;
	row: number;
	column: number;
};

export const captureKeys: string[] = [...new Set([
	EDITOR_TOGGLE_KEY,
	VM_TOGGLE_KEY,
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

export type DebuggerControlsState = {
	executionState: DebuggerExecutionState;
	sessionMetrics: LuaDebuggerSessionMetrics;
};

export interface IdeState {
	initialized: boolean;
	playerIndex: number;
	themeVariant: IdeThemeVariant;
	buffer: TextBuffer;
	cursorRow: number;
	cursorColumn: number;
	caseInsensitive: boolean;
	canonicalization: CanonicalizationType;
	preMutationSource: string;
	scrollRow: number;
	scrollColumn: number;
	dirty: boolean;
	desiredColumn: number;
	desiredDisplayOffset: number;
	selectionAnchor: Position;
	undoStack: EditorUndoRecord[];
	redoStack: EditorUndoRecord[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	savePointDepth: number;
	fontVariant: VMFontVariant;
	builtinIdentifierCache: BuiltinIdentifierCache | null;
	hoverTooltip: CodeHoverTooltip;
	lastPointerSnapshot: PointerSnapshot;
	lastInspectorResult: VMLuaHoverResult;
	inspectorRequestFailed: boolean;
	gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string };
	viewportWidth: number;
	viewportHeight: number;
	font: VMEditorFont;
	lineHeight: number;
	charAdvance: number;
	spaceAdvance: number;
	gutterWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	tabBarRowCount: number;
	baseBottomMargin: number;
	deferredMessageDuration: number;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
	clockNow: () => number;
	problemsPanel: ProblemsPanelController;
	problemsPanelResizing: boolean;
	diagnostics: EditorDiagnostic[];
	diagnosticsByRow: Map<number, EditorDiagnostic[]>;
	diagnosticsDirty: boolean;
	diagnosticsCache: Map<string, DiagnosticsCacheEntry>;
	dirtyDiagnosticContexts: Set<string>;
	diagnosticsDueAtMs: number;
	diagnosticsComputationScheduled: boolean;
	codeTabContexts: Map<string, CodeTabContext>;
	activeCodeTabContextId: string;
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
	menuEntryBounds: Record<MenuId, RectBounds>;
	menuDropdownBounds: RectBounds;
	openMenuId: MenuId;
	debuggerControls: DebuggerControlsState;
	breakpoints: Map<string, Set<number>>;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
	activeContextReadOnly: boolean;
	resourceViewerSpriteId: string;
	resourceViewerSpriteAsset: string;
	resourceViewerSpriteScale: number;
	actionPromptButtons: { saveAndContinue: RectBounds; continue: RectBounds; cancel: RectBounds };
	pendingActionPrompt: PendingActionPrompt;
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
	searchField: TextField;
	symbolSearchField: TextField;
	resourceSearchField: TextField;
	lineJumpField: TextField;
	createResourceField: TextField;
	inlineFieldMetricsRef: InlineFieldMetrics;
	scrollbars: Record<ScrollbarKind, VMScrollbar>;
	scrollbarController: ScrollbarController;
	input: InputController;
	lastPointerClickTimeMs: number;
	lastPointerClickRow: number;
	lastPointerClickColumn: number;
	tabHoverId: string;
	tabDragState: TabDragState;
	crtOptionsSnapshot: CrtOptionsSnapshot;
	cursorRevealSuspended: boolean;
	searchActive: boolean;
	searchVisible: boolean;
	searchQuery: string;
	symbolSearchQuery: string;
	resourceSearchQuery: string;
	pendingEditContext: EditContext;
	cursorScreenInfo: CursorScreenInfo;
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
	createResourceError: string;
	createResourceWorking: boolean;
	lastCreateResourceDirectory: string;
	symbolCatalog: SymbolCatalogEntry[];
	referenceCatalog: ReferenceCatalogEntry[];
	symbolCatalogContext: { scope: 'local' | 'global'; path: string };
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
	searchJob: SearchComputationJob;
	searchDisplayOffset: number;
	searchHoverIndex: number;
	searchScope: 'local' | 'global';
	globalSearchMatches: GlobalSearchMatch[];
	globalSearchJob: GlobalSearchJob;
	diagnosticsTaskPending: boolean;
	lastReportedSemanticError: string;
	referenceState: ReferenceState;
	textVersion: number;
	lastContentEditAtMs: number;
	saveGeneration: number;
	appliedGeneration: number;
	lastSavedSource: string;
	tabs: EditorTabDescriptor[];
	activeTabId: string;
	resourceBrowserItems: ResourceBrowserItem[];
	resourceBrowserSelectionIndex: number;
	resourcePanelVisible: boolean;
	resourcePanelFocused: boolean;
	resourcePanelResourceCount: number;
	pendingResourceSelectionAssetId: string;
	resourcePanelWidthRatio: number;
	resourcePanelResizing: boolean;
	resourcePanel: ResourcePanelController;
	renameController: RenameController;
	semanticWorkspace: LuaSemanticWorkspace;
	layout: VMCodeLayout;
	codeVerticalScrollbarVisible: boolean;
	codeHorizontalScrollbarVisible: boolean;
	maxLineLength: number;
	maxLineLengthRow: number;
	maxLineLengthDirty: boolean;
	cachedVisibleRowCount: number;
	cachedVisibleColumnCount: number;
	dimCrtInEditor: boolean;
	wordWrapEnabled: boolean;
	lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment };
	completion: CompletionController;
	navigationHistory: {
		back: NavigationHistoryEntry[];
		forward: NavigationHistoryEntry[];
		current: NavigationHistoryEntry;
	};
	navigationCaptureSuspended: boolean;
	customClipboard: string;
	workspaceAutosaveEnabled: boolean;
	workspaceAutosaveSignature: string;
	workspaceAutosaveHandle: TimerHandle | { cancel(): void };
	workspaceAutosaveRunning: boolean;
	workspaceAutosaveQueued: boolean;
	disposeWorkspaceExitListener: SubscriptionHandle;
	serverWorkspaceConnected: boolean;
}

export const ide_state: IdeState = {
	initialized: false,
	playerIndex: 0,
	themeVariant: getActiveIdeThemeVariant(),
	buffer: new PieceTreeBuffer(''),
	cursorRow: 0,
	cursorColumn: 0,
	caseInsensitive: true,
	canonicalization: 'lower',
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
	savePointDepth: 0,
	fontVariant: undefined!,
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
	topBarButtonBounds: {
		"hot-reload-and-resume": { left: 0, top: 0, right: 0, bottom: 0 },
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
	menuEntryBounds: {
		file: { left: 0, top: 0, right: 0, bottom: 0 },
		run: { left: 0, top: 0, right: 0, bottom: 0 },
		view: { left: 0, top: 0, right: 0, bottom: 0 },
		debug: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	menuDropdownBounds: null,
	openMenuId: null,
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
	lastPointerClickTimeMs: 0,
	lastPointerClickRow: -1,
	lastPointerClickColumn: -1,
	tabHoverId: null,
	tabDragState: null,
	crtOptionsSnapshot: null,
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
	lastContentEditAtMs: null,
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
	semanticWorkspace: undefined!,
	layout: undefined!,
	codeVerticalScrollbarVisible: false,
	codeHorizontalScrollbarVisible: false,
	maxLineLength: 0,
	maxLineLengthRow: 0,
	maxLineLengthDirty: true,
	cachedVisibleRowCount: 1,
	cachedVisibleColumnCount: 1,
	dimCrtInEditor: true,
	wordWrapEnabled: true,
	lastPointerRowResolution: null,
	completion: undefined!,
	navigationHistory: {
		back: [] as NavigationHistoryEntry[],
		forward: [] as NavigationHistoryEntry[],
		current: null as NavigationHistoryEntry,
	},
	navigationCaptureSuspended: false,
	customClipboard: null,
	workspaceAutosaveEnabled: false,
	workspaceAutosaveSignature: null,
	workspaceAutosaveHandle: null,
	workspaceAutosaveRunning: false,
	workspaceAutosaveQueued: false,
	disposeWorkspaceExitListener: null,
	serverWorkspaceConnected: false,
};

// Initialize message controller
const messageController = createMessageController();

export const caretNavigation = new CaretNavigationState();

ide_state.message = messageController.message;
ide_state.showMessage = messageController.showMessage;
ide_state.updateMessage = messageController.updateMessage;
ide_state.showWarningBanner = messageController.showWarningBanner;
