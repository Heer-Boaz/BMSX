import type {
	LuaHoverResult,
} from '../../emulator/types';
import type { FontVariant } from '../../render/shared/bmsx_font';
import type { ScrollbarKind, MessageState } from './types';
import type { InlineFieldMetrics } from '../ui/inline_text_field';
import { Scrollbar, ScrollbarController } from '../ui/scrollbar';
import type { InputController } from '../input/keyboard/editor_text_input';
import type { ProblemsPanelController } from '../contrib/problems/problems_panel';
import { ResourcePanelController } from '../contrib/resources/resource_panel_controller';
import type { RenameController } from '../contrib/rename/rename_controller';
import type { CompletionController } from '../contrib/suggest/completion_controller';
import { createMessageController } from '../ui/message_controller';
import { ReferenceState } from '../contrib/references/reference_state';
import { CHARACTER_CODES } from './character_map';
import type {
	Position,
	CodeHoverTooltip,
	EditorDiagnostic,
	DiagnosticsCacheEntry,
	CodeTabContext,
	TopBarButtonId,
	MenuId,
	ActionPromptState,
	CrtOptionsSnapshot,
	EditContext,
	SearchState,
	ResourceSearchState,
	SymbolSearchState,
	LineJumpState,
	CreateResourceState,
	EditorTabDescriptor,
	EditorContextMenuState,
} from './types';
import type { TextBuffer } from '../text/text_buffer';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import type { EditorUndoRecord } from '../text/editor_undo';
import type { CanonicalizationType, RectBounds } from '../../rompack/rompack';
import { CodeLayout } from '../ui/code_layout';
import type { DebuggerExecutionState } from '../contrib/debugger/ide_debugger';
import type { LuaDebuggerSessionMetrics } from '../../lua/luadebugger';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_KEY, ESCAPE_KEY, getActiveIdeThemeVariant } from './constants';
import { CaretNavigationState } from '../ui/caret';
import { EditorFont } from '../ui/view/editor_font';

type BuiltinIdentifierCache = {
	epoch: number;
	ids: ReadonlySet<string>;
	canonicalization: CanonicalizationType;
	caseInsensitive: boolean;
};

export function assignRowColumn<T extends { row: number; column: number }>(
	target: T | null,
	row: number,
	column: number,
	fallback: T,
): T {
	const next = target ?? fallback;
	next.row = row;
	next.column = column;
	return next;
}

export const captureKeys: string[] = [...new Set([
	EDITOR_TOGGLE_KEY,
	TERMINAL_TOGGLE_KEY,
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
	themeVariant: string;
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
	selectionAnchorScratch: Position;
	undoStack: EditorUndoRecord[];
	redoStack: EditorUndoRecord[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	savePointDepth: number;
	fontVariant: FontVariant;
	builtinIdentifierCache: BuiltinIdentifierCache | null;
	hoverTooltip: CodeHoverTooltip;
	lastInspectorResult: LuaHoverResult;
	inspectorRequestFailed: boolean;
	gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string };
	viewportWidth: number;
	viewportHeight: number;
	font: EditorFont;
	lineHeight: number;
	charAdvance: number;
	spaceAdvance: number;
	gutterWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	tabBarRowCount: number;
	baseBottomMargin: number;
	deferredMessageDuration: number;
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
	contextMenu: EditorContextMenuState;
	debuggerControls: DebuggerControlsState;
	breakpoints: Map<string, Set<number>>;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
	activeContextReadOnly: boolean;
	resourceViewerSpriteId: string;
	resourceViewerSpriteAsset: string;
	resourceViewerSpriteScale: number;
	actionPrompt: ActionPromptState;
	active: boolean;
	message: MessageState;
	showMessage: (text: string, color: number, durationSeconds: number) => void;
	updateMessage: (deltaSeconds: number) => void;
	showWarningBanner: (text: string, durationSeconds?: number) => void;
	warnNonMonospace: boolean;
	search: SearchState;
	resourceSearch: ResourceSearchState;
	symbolSearch: SymbolSearchState;
	lineJump: LineJumpState;
	createResource: CreateResourceState;
	inlineFieldMetricsRef: InlineFieldMetrics;
	scrollbars: Record<ScrollbarKind, Scrollbar>;
	scrollbarController: ScrollbarController;
	input: InputController;
	crtOptionsSnapshot: CrtOptionsSnapshot;
	pendingEditContext: EditContext;
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
	pendingResourceSelectionAssetId: string;
	resourcePanelResizing: boolean;
	resourcePanel: ResourcePanelController;
	renameController: RenameController;
	layout: CodeLayout;
	codeVerticalScrollbarVisible: boolean;
	codeHorizontalScrollbarVisible: boolean;
	maxLineLength: number;
	maxLineLengthRow: number;
	maxLineLengthDirty: boolean;
	cachedVisibleRowCount: number;
	cachedVisibleColumnCount: number;
	dimCrtInEditor: boolean;
	wordWrapEnabled: boolean;
	completion: CompletionController;
	customClipboard: string;
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
	selectionAnchorScratch: { row: 0, column: 0 },
	undoStack: [],
	redoStack: [],
	lastHistoryKey: null,
	lastHistoryTimestamp: 0,
	savePointDepth: 0,
	fontVariant: undefined!,
	builtinIdentifierCache: null,
	hoverTooltip: null,
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
		"hot-resume": { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
		problems: { left: 0, top: 0, right: 0, bottom: 0 },
		filter: { left: 0, top: 0, right: 0, bottom: 0 },
		wrap: { left: 0, top: 0, right: 0, bottom: 0 },
		debugContinue: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOver: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepInto: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOut: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	menuEntryBounds: {
		file: { left: 0, top: 0, right: 0, bottom: 0 },
		run: { left: 0, top: 0, right: 0, bottom: 0 },
		view: { left: 0, top: 0, right: 0, bottom: 0 },
		debug: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	menuDropdownBounds: null,
	openMenuId: null,
	contextMenu: {
		visible: false,
		anchorX: 0,
		anchorY: 0,
		token: null,
		entries: [],
		hoverIndex: -1,
		bounds: null,
		itemBounds: [],
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
	actionPrompt: null,
	active: false,
	message: undefined!,
	showMessage: undefined!,
	updateMessage: undefined!,
	showWarningBanner: undefined!,
	warnNonMonospace: false,
	search: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		matches: [],
		currentIndex: -1,
		job: null,
		displayOffset: 0,
		hoverIndex: -1,
		scope: 'local',
		globalMatches: [],
		globalJob: null,
	},
	resourceSearch: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		catalog: [],
		matches: [],
		selectionIndex: -1,
		displayOffset: 0,
		hoverIndex: -1,
	},
	symbolSearch: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		global: false,
		mode: 'symbols',
		catalog: [],
		referenceCatalog: [],
		catalogContext: null,
		matches: [],
		selectionIndex: -1,
		displayOffset: 0,
		hoverIndex: -1,
	},
	lineJump: {
		field: undefined!,
		active: false,
		visible: false,
		value: '',
	},
	createResource: {
		field: undefined!,
		active: false,
		visible: false,
		path: '',
		error: null,
		working: false,
		lastDirectory: '',
	},
	inlineFieldMetricsRef: undefined!,
	scrollbars: undefined!,
	scrollbarController: undefined!,
	input: undefined!,
	crtOptionsSnapshot: null,
	pendingEditContext: null,
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
	pendingResourceSelectionAssetId: null,
	resourcePanelResizing: false,
	resourcePanel: undefined!,
	renameController: undefined!,
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
	completion: undefined!,
	customClipboard: null,
};

// Initialize message controller
const messageController = createMessageController();

export const caretNavigation = new CaretNavigationState();

ide_state.message = messageController.message;
ide_state.showMessage = messageController.showMessage;
ide_state.updateMessage = messageController.updateMessage;
ide_state.showWarningBanner = messageController.showWarningBanner;
