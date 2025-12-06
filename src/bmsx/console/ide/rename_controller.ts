import { resolveReferenceLookup, type ReferenceLookupOptions, type ReferenceMatchInfo, ReferenceState } from './code_reference';
import type { CodeTabContext, InlineInputOptions, TextField, SearchMatch } from './types';
import { createInlineTextField, getFieldText, setFieldText } from './inline_text_field';
import { isCtrlDown, isKeyJustPressed as isKeyJustPressed, isMetaDown, isShiftDown } from './ide_input';
import * as constants from './constants';
import { consumeIdeKey } from './ide_input';
import type { LuaSourceRange } from '../../lua/ast';
import { clamp } from '../../utils/clamp';
import type { ConsoleResourceDescriptor } from '../types';
import type { LuaSemanticWorkspace } from './semantic_model';
import { ide_state } from './ide_state';
import { LuaLexer } from '../../lua/lexer';
import { findCodeTabContext } from './editor_tabs';
import { findResourceDescriptorForChunk } from './console_cart_editor';
import { BmsxConsoleRuntime } from '../runtime';

export type RenameCommitPayload = {
	matches: readonly SearchMatch[];
	newName: string;
	activeIndex: number;
	originalName: string;
	info: ReferenceMatchInfo;
};

export type RenameCommitResult = {
	updatedMatches: number;
};

export type RenameControllerHost = {
	processFieldEdit(field: TextField, options: InlineInputOptions): boolean;
	shouldFireRepeat(code: string, deltaSeconds: number): boolean;
	undo(): void;
	redo(): void;
	showMessage(text: string, color: number, duration: number): void;
	commitRename(payload: RenameCommitPayload): RenameCommitResult;
	onRenameSessionClosed(): void;
};

export type RenameStartOptions = ReferenceLookupOptions & {
	lines: readonly string[];
};

export class RenameController {
	private readonly host: RenameControllerHost;
	private readonly referenceState: ReferenceState;
	private readonly field: TextField = createInlineTextField();
	private active = false;
	private visible = false;
	private matches: SearchMatch[] = [];
	private info: ReferenceMatchInfo = null;
	private originalName = '';
	private activeIndex = -1;
	private expressionLabel: string = null;
	private readonly identifierFilter = (value: string): boolean => {
		if (value.length === 0) {
			return false;
		}
		return LuaLexer.isIdentifierPart(value.charAt(0));
	};

	public constructor(host: RenameControllerHost, referenceState: ReferenceState) {
		this.host = host;
		this.referenceState = referenceState;
	}

	public begin(options: RenameStartOptions): boolean {
		const lookup = resolveReferenceLookup(options);
		if (lookup.kind === 'error') {
			this.host.showMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			this.host.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const firstMatch = info.matches[Math.max(0, Math.min(initialIndex, info.matches.length - 1))];
		const activeLine = options.lines[firstMatch.row] ?? '';
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			this.host.showMessage('Unable to determine identifier name', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		this.referenceState.apply(info, initialIndex);
		this.matches = info.matches.slice();
		this.info = info;
		this.originalName = currentName;
		this.activeIndex = initialIndex;
		this.expressionLabel = info.expression;
		this.resetInlineField(currentName);
		this.active = true;
		this.visible = true;
		return true;
	}

	public cancel(): void {
		if (!this.active) {
			return;
		}
		this.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		this.host.onRenameSessionClosed();
	}

	public handleInput(deltaSeconds: number): void {
		if (!this.active) {
			return;
		}
		const { ctrlDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };

		if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyZ', deltaSeconds)) {
			consumeIdeKey('KeyZ');
			if (shiftDown) {
				this.host.redo();
			} else {
				this.host.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyY', deltaSeconds)) {
			consumeIdeKey('KeyY');
			this.host.redo();
			return;
		}
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.cancel();
			return;
		}
		const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
		if (enterPressed) {
			if (isKeyJustPressed('Enter')) {
				consumeIdeKey('Enter');
			} else {
				consumeIdeKey('NumpadEnter');
			}
			this.commit();
			return;
		}
		const options: InlineInputOptions = {
			deltaSeconds,
			allowSpace: false,
			characterFilter: this.identifierFilter,
			maxLength: null,
		};
		const changed = this.host.processFieldEdit(this.field, options);
		if (!changed) {
			return;
		}
	}

	public getField(): TextField {
		return this.field;
	}

	public isActive(): boolean {
		return this.active;
	}

	public isVisible(): boolean {
		return this.visible;
	}

	public getMatchCount(): number {
		return this.matches.length;
	}

	public getExpressionLabel(): string {
		return this.expressionLabel;
	}

	public getOriginalName(): string {
		return this.originalName;
	}

	public getActiveIndex(): number {
		return this.activeIndex;
	}

	private commit(): void {
		if (!this.active || !this.info) {
			return;
		}
		const nextName = getFieldText(this.field).trim();
		if (nextName.length === 0) {
			this.host.showMessage('Identifier cannot be empty', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		if (!LuaLexer.isIdentifierStart(nextName.charAt(0))) {
			this.host.showMessage('Identifier must start with a letter or underscore', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		}
		for (let index = 1; index < nextName.length; index += 1) {
			if (!LuaLexer.isIdentifierPart(nextName.charAt(index))) {
				this.host.showMessage('Identifier contains invalid characters', constants.COLOR_STATUS_WARNING, 1.8);
				return;
			}
		}
		if (nextName === this.originalName) {
			this.cancel();
			return;
		}
		const payload: RenameCommitPayload = {
			matches: this.matches,
			newName: nextName,
			activeIndex: this.activeIndex,
			originalName: this.originalName,
			info: this.info,
		};
		const result = this.host.commitRename(payload);
		this.host.showMessage(`Renamed ${result.updatedMatches} reference${result.updatedMatches === 1 ? '' : 's'} to ${nextName}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		this.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		this.host.onRenameSessionClosed();
	}

	private resetInlineField(value: string): void {
		setFieldText(this.field, value, true);
		this.field.selectionAnchor = { row: 0, column: 0 };
		this.field.desiredColumn = this.field.cursorColumn;
		this.field.pointerSelecting = false;
		this.field.lastPointerClickTimeMs = 0;
		this.field.lastPointerClickColumn = -1;
	}
}

export type RenameLineEdit = {
	row: number;
	text: string;
};

export function planRenameLineEdits(lines: readonly string[], matches: readonly SearchMatch[], newName: string): RenameLineEdit[] {
	if (matches.length === 0) {
		return [];
	}
	const edits: RenameLineEdit[] = [];
	let currentRow = matches[0].row;
	let source = lines[currentRow] ?? '';
	let builder = '';
	let sliceStart = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row !== currentRow) {
			builder += source.slice(sliceStart);
			if (builder !== source) {
				edits.push({ row: currentRow, text: builder });
			}
			currentRow = match.row;
			source = lines[currentRow] ?? '';
			builder = '';
			sliceStart = 0;
		}
		builder += source.slice(sliceStart, match.start);
		builder += newName;
		sliceStart = match.end;
	}
	builder += source.slice(sliceStart);
	if (builder !== source) {
		edits.push({ row: currentRow, text: builder });
	}
	return edits;
}

export type CrossFileRenameDependencies = {
	createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext;
	createEntryTabContext(): CodeTabContext;
	getCodeTabContext(id: string): CodeTabContext;
	setCodeTabContext(context: CodeTabContext): void;
	listCodeTabContexts(): Iterable<CodeTabContext>;
	splitLines(source: string): string[];
	setTabDirty(tabId: string, dirty: boolean): void;
};

export class CrossFileRenameManager {
	public constructor(
		private readonly deps: CrossFileRenameDependencies,
		private readonly workspace: LuaSemanticWorkspace
	) { }

	public applyRenameToChunk(chunkName: string, ranges: readonly LuaSourceRange[], newName: string, activeChunkName: string): number {
		const context = this.ensureCodeTabContextForChunk(chunkName);
		if (!context) {
			return 0;
		}
		if (activeChunkName && chunkName === activeChunkName) {
			return 0;
		}
		const lines = this.getContextLinesForRename(context);
		const matches: SearchMatch[] = [];
		for (let index = 0; index < ranges.length; index += 1) {
			const match = convertRangeToSearchMatch(ranges[index], lines);
			if (match) {
				matches.push(match);
			}
		}
		if (matches.length === 0) {
			return 0;
		}
		matches.sort((a, b) => {
			if (a.row !== b.row) {
				return a.row - b.row;
			}
			return a.start - b.start;
		});
		const edits = planRenameLineEdits(lines, matches, newName);
		if (edits.length === 0) {
			return 0;
		}
		for (let index = 0; index < edits.length; index += 1) {
			const edit = edits[index];
			lines[edit.row] = edit.text;
		}
		this.applyLinesToContextSnapshot(context, lines);
		this.workspace.updateFile(chunkName, lines.join('\n'));
		return matches.length;
	}

	private getContextLinesForRename(context: CodeTabContext): string[] {
		if (context.snapshot) {
			return context.snapshot.lines.slice();
		}
		const descriptor = context.descriptor;
		const chunkName = descriptor.path ?? descriptor.asset_id;
		const source = BmsxConsoleRuntime.instance.resourceSourceForChunk(chunkName);
		context.lastSavedSource = source;
		return this.deps.splitLines(source);
	}

	private applyLinesToContextSnapshot(context: CodeTabContext, lines: readonly string[]): void {
		const snapshot = context.snapshot ?? {
			lines: [],
			cursorRow: 0,
			cursorColumn: 0,
			scrollRow: 0,
			scrollColumn: 0,
			selectionAnchor: null,
			dirty: true,
		};
		snapshot.lines = lines.slice();
		snapshot.dirty = true;
		if (snapshot.cursorRow >= snapshot.lines.length) {
			snapshot.cursorRow = Math.max(0, snapshot.lines.length - 1);
			snapshot.cursorColumn = 0;
		}
		const cursorLine = snapshot.lines[snapshot.cursorRow] ?? '';
		snapshot.cursorColumn = clamp(snapshot.cursorColumn, 0, cursorLine.length);
		snapshot.scrollRow = clamp(snapshot.scrollRow, 0, Math.max(0, snapshot.lines.length - 1));
		context.snapshot = snapshot;
		context.dirty = true;
		this.deps.setTabDirty(context.id, context.dirty);
	}

	private ensureCodeTabContextForChunk(chunkName: string): CodeTabContext {
		const existing = findCodeTabContext(chunkName);
		if (existing) {
			return existing;
		}
		const descriptor = findResourceDescriptorForChunk(chunkName);
		if (!descriptor) {
			return null;
		}
		const contextId: string = `lua:${descriptor.asset_id}`;
		let context = this.deps.getCodeTabContext(contextId) ;
		if (!context) {
			context = this.deps.createLuaCodeTabContext(descriptor);
			this.deps.setCodeTabContext(context);
		}
		return context;
	}
}

export function convertRangeToSearchMatch(range: LuaSourceRange, lines: readonly string[]): SearchMatch {
	if (!range) {
		return null;
	}
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	const startColumn = Math.max(0, range.start.column - 1);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = Math.min(line.length, endInclusive + 1);
	if (endExclusive <= startColumn) {
		return null;
	}
	return { row: rowIndex, start: startColumn, end: endExclusive };
}
