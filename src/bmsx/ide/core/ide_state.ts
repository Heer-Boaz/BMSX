import type { InputController } from '../input/keyboard/editor_text_input';
import type { ProblemsPanelController } from '../contrib/problems/problems_panel';
import { ResourcePanelController } from '../contrib/resources/resource_panel_controller';
import type { RenameController } from '../contrib/rename/rename_controller';
import type { CompletionController } from '../contrib/suggest/completion_controller';
import { ReferenceState } from '../contrib/references/reference_state';
import { CHARACTER_CODES } from './character_map';
import type {
	CrtOptionsSnapshot,
	EditContext,
	SearchState,
	ResourceSearchState,
	SymbolSearchState,
	LineJumpState,
	CreateResourceState,
} from './types';
import type { CanonicalizationType } from '../../rompack/rompack';
import type { DebuggerExecutionState } from '../contrib/debugger/ide_debugger';
import type { LuaDebuggerSessionMetrics } from '../../lua/luadebugger';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_KEY, ESCAPE_KEY, getActiveIdeThemeVariant } from './constants';
import { CaretNavigationState } from '../ui/caret';

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

export const NAVIGATION_HISTORY_LIMIT = 64;

export const WORKSPACE_AUTOSAVE_INTERVAL_MS = 2500;

export type DebuggerControlsState = {
	executionState: DebuggerExecutionState;
	sessionMetrics: LuaDebuggerSessionMetrics;
};

export interface IdeState {
	initialized: boolean;
	playerIndex: number;
	themeVariant: string;
	caseInsensitive: boolean;
	canonicalization: CanonicalizationType;
	builtinIdentifierCache: BuiltinIdentifierCache | null;
	clockNow: () => number;
	problemsPanel: ProblemsPanelController;
	debuggerControls: DebuggerControlsState;
	breakpoints: Map<string, Set<number>>;
	resourceViewerSpriteId: string;
	resourceViewerSpriteAsset: string;
	resourceViewerSpriteScale: number;
	active: boolean;
	search: SearchState;
	resourceSearch: ResourceSearchState;
	symbolSearch: SymbolSearchState;
	lineJump: LineJumpState;
	createResource: CreateResourceState;
	input: InputController;
	crtOptionsSnapshot: CrtOptionsSnapshot;
	pendingEditContext: EditContext;
	lastReportedSemanticError: string;
	referenceState: ReferenceState;
	resourcePanel: ResourcePanelController;
	renameController: RenameController;
	completion: CompletionController;
}

export const ide_state: IdeState = {
	initialized: false,
	playerIndex: 0,
	themeVariant: getActiveIdeThemeVariant(),
	caseInsensitive: true,
	canonicalization: 'lower',
	builtinIdentifierCache: null,
	clockNow: undefined!,
	problemsPanel: undefined!,
	debuggerControls: {
		executionState: 'inactive',
		sessionMetrics: null,
	},
	breakpoints: new Map<string, Set<number>>(),
	resourceViewerSpriteId: null,
	resourceViewerSpriteAsset: null,
	resourceViewerSpriteScale: 1,
	active: false,
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
	input: undefined!,
	crtOptionsSnapshot: null,
	pendingEditContext: null,
	lastReportedSemanticError: null,
	referenceState: new ReferenceState(),
	resourcePanel: undefined!,
	renameController: undefined!,
	completion: undefined!,
};

export const caretNavigation = new CaretNavigationState();
