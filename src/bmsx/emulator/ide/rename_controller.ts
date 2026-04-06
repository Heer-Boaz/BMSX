import { resolveReferenceLookup, type ReferenceLookupOptions } from './reference_navigation';
import { type ReferenceMatchInfo } from './reference_state';
import type { CodeTabContext, InlineInputOptions, TextField, SearchMatch } from './types';
import { applyInlineFieldEditing, createInlineTextField, setFieldText } from './inline_text_field';
import { isCtrlDown, isKeyJustPressed as isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './ide_input';
import * as constants from './constants';
import { consumeIdeKey } from './ide_input';
import type { LuaSourceRange } from '../../lua/syntax/lua_ast';
import { clamp } from '../../utils/clamp';
import { LuaLexer } from '../../lua/syntax/lualexer';
import { createLuaCodeTabContext, findCodeTabContext } from './editor_tabs';
import { redo, undo } from './cart_editor';
import { commitRename, findResourceDescriptorForChunk, focusEditorFromRename } from './search_bars';
import { getTextSnapshot, splitText, textFromLines } from './text/source_text';
import { syncSemanticWorkspacePath } from './semantic_workspace_sync';
import { ide_state } from './ide_state';
import { getOrCreateSemanticWorkspace } from './semantic_workspace_sync';

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

export type RenameStartOptions = ReferenceLookupOptions & {
};

export class RenameController {
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

	public constructor() {}

	public begin(options: RenameStartOptions): boolean {
		const lookup = resolveReferenceLookup(options);
		if (lookup.kind === 'error') {
			ide_state.showMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const firstMatch = info.matches[clamp(initialIndex, 0, info.matches.length - 1)];
		const activeLine = options.buffer.getLineContent(firstMatch.row);
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			ide_state.showMessage('Unable to determine identifier name', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		ide_state.referenceState.apply(info, initialIndex);
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
		ide_state.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		focusEditorFromRename();
	}

	public handleInput(): void {
		if (!this.active) {
			return;
		}
		const { ctrlDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };

		if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ')) {
			consumeIdeKey('KeyZ');
			if (shiftDown) {
				redo();
			} else {
				undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY')) {
			consumeIdeKey('KeyY');
			redo();
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
			allowSpace: false,
			characterFilter: this.identifierFilter,
			maxLength: null,
		};
		const changed = applyInlineFieldEditing(this.field, options);
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
		const nextName = textFromLines(this.field.lines).trim();
		if (nextName.length === 0) {
			ide_state.showMessage('Identifier cannot be empty', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		if (!LuaLexer.isIdentifierStart(nextName.charAt(0))) {
			ide_state.showMessage('Identifier must start with a letter or underscore', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		}
		for (let index = 1; index < nextName.length; index += 1) {
			if (!LuaLexer.isIdentifierPart(nextName.charAt(index))) {
				ide_state.showMessage('Identifier contains invalid characters', constants.COLOR_STATUS_WARNING, 1.8);
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
		const result = commitRename(payload);
		ide_state.showMessage(`Renamed ${result.updatedMatches} reference${result.updatedMatches === 1 ? '' : 's'} to ${nextName}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		ide_state.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		focusEditorFromRename();
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

export class CrossFileRenameManager {
	public constructor() { }

	public applyRenameToChunk(path: string, ranges: readonly LuaSourceRange[], newName: string, activePath: string): number {
		const context = this.ensureCodeTabContextForChunk(path);
		if (path === activePath) {
			return 0;
		}
		if (context.readOnly === true) {
			return 0;
		}
		const lines = this.getContextLinesForRename(context);
		const matches: SearchMatch[] = [];
		for (let index = 0; index < ranges.length; index += 1) {
			matches.push(convertRangeToSearchMatch(ranges[index]));
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
		const workspace = getOrCreateSemanticWorkspace();
		syncSemanticWorkspacePath({
			path,
			source: lines.join('\n'),
			lines,
			version: context.textVersion,
		}, workspace);
		return matches.length;
	}

	private getContextLinesForRename(context: CodeTabContext): string[] {
		return splitText(getTextSnapshot(context.buffer));
	}

	private applyLinesToContextSnapshot(context: CodeTabContext, lines: readonly string[]): void {
		const source = lines.join('\n');
		context.buffer.replace(0, context.buffer.length, source);
		context.textVersion = context.buffer.version;
		context.dirty = true;
		context.savePointDepth = -1;
		const lineCount = context.buffer.getLineCount();
		if (context.cursorRow >= lineCount) {
			context.cursorRow = lineCount - 1;
			context.cursorColumn = 0;
		}
		const cursorLength = context.buffer.getLineEndOffset(context.cursorRow) - context.buffer.getLineStartOffset(context.cursorRow);
		context.cursorColumn = clamp(context.cursorColumn, 0, cursorLength);
		context.scrollRow = clamp(context.scrollRow, 0, lineCount - 1);
		this.markContextTabDirty(context.id, context.dirty);
	}

	private ensureCodeTabContextForChunk(path: string): CodeTabContext {
		const existing = findCodeTabContext(path);
		if (existing) {
			return existing;
		}
		const descriptor = findResourceDescriptorForChunk(path)!;
		const contextId: string = `lua:${descriptor.path}`;
		let context = ide_state.codeTabContexts.get(contextId);
		if (!context) {
			context = createLuaCodeTabContext(descriptor);
			ide_state.codeTabContexts.set(context.id, context);
			this.markContextTabDirty(context.id, context.dirty);
		}
		return context;
	}

	private markContextTabDirty(contextId: string, dirty: boolean): void {
		const tab = ide_state.tabs.find(candidate => candidate.id === contextId);
		if (!tab) {
			return;
		}
		tab.dirty = dirty;
	}
}

export const crossFileRenameManager = new CrossFileRenameManager();
export const renameController = new RenameController();

export function convertRangeToSearchMatch(range: LuaSourceRange): SearchMatch {
	const row = range.start.line - 1;
	const start = range.start.column - 1;
	const end = range.end.column;
	return { row, start, end };
}
