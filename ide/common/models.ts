import type { PointerButtons } from '../../hosts/common/input/pointer_event';
import type { KeyModifier } from '../../hosts/common/input/text';
import type { RuntimeResource } from './resource';
import type { LuaMemberCompletionContext } from '../../toolchain/ts/lua/semantic/completion';
import type { TextField } from '../editor/ui/inline/text_field_model';
import type { EditorTextModel } from '../editor/model/text_model';
export type { RuntimeResource } from './resource';

export type Position = { row: number; column: number };

/** Ordered presentation priority; authored decorations never change source syntax tokens. */
export enum CodeTextDecoration {
	None,
	InactiveSelection,
	Reference,
	ActiveReference,
	Search,
	ActiveSearch,
	Selection,
}

export type CodeTextDecorationStyle = {
	background: number;
	foreground: number;
	errorUnderline: number;
	warningUnderline: number;
	gotoUnderline: number;
};

export type EditorMessageKind = 'info' | 'success' | 'warning' | 'error';

export type MessageState = {
	text: string;
	kind: EditorMessageKind;
	timer: number;
	visible: boolean;
};

export type HighlightLine = {
	text: string;
	upperText: string;
	colors: number[];
	columnToDisplay: number[];
};

export type InlineLineRange = {
	readonly startColumn: number;
	readonly endColumn: number;
	readonly startDisplay: number;
	readonly endDisplay: number;
};

export type DisplayRange = { startDisplay: number; endDisplay: number };

/** Source UTF-16 positions, projected UTF-16 text and tab-expanded glyph offsets remain distinct. */
export type CodeLineView = {
	src: string;
	viewText: string;
	viewColumnToDisplay: number[];
	hi: HighlightLine;
	displayToColumn: number[];
	advancePrefix: number[];
	inline: InlineLineRange | null;
};

export type CachedHighlight = CodeLineView & {
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

export type LuaCompletionKind =
	| 'keyword'
	| 'local'
	| 'global'
	| 'builtin'
	| 'module'
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
		kind: 'module';
		prefix: string;
		row: number;
		replaceFromColumn: number;
		replaceToColumn: number;
	}
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
	readonly model: EditorTextModel;
	readonly version: number;
};

export type VisualLineSegment = {
	row: number;
	startColumn: number;
	endColumn: number;
	startDisplay: number;
	endDisplay: number;
};

export type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

export type CrtOptionsSnapshot = {
	noiseIntensity: number;
	colorBleed: [number, number, number];
	blurIntensity: number;
	glowColor: [number, number, number];
};

export type SearchState = {
	field: TextField;
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

export type LineJumpState = {
	field: TextField;
	visible: boolean;
	value: string;
};

export type EditorContextTokenKind = 'identifier' | 'keyword' | 'number' | 'string' | 'operator';

export type EditorContextToken = {
	kind: EditorContextTokenKind;
	text: string;
	expression: string | null;
	row: number;
	column: number;
	startColumn: number;
	endColumn: number;
};

export type PointerPosition = {
	viewportX: number;
	viewportY: number;
	insideViewport: boolean;
	valid: boolean;
};

export type PointerSnapshot = PointerPosition & PointerButtons;

/** Event-time editing context for pointer gestures. */
export type PointerInputSnapshot = PointerSnapshot & { modifiers: KeyModifier; spaceDown: boolean };

/** A wheel occurrence keeps its event-time target, modifiers and fractional movement. */
export type WheelInputSnapshot = PointerPosition & { modifiers: KeyModifier; deltaX: number; deltaY: number };

export type InlineInputOptions = {
	allowSpace: boolean;
	/** Reject an entire multiline paste instead of silently changing its contents. */
	singleLine?: boolean;
	characterFilter?: (value: string) => boolean;
	maxLength?: number;
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
