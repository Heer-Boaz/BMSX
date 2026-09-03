import { clamp } from '../../../../../machine/ts/common/clamp';
import { create_rect_bounds } from '../../../../../machine/ts/common/rect';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { editorViewState } from '../../../../editor/ui/view/state';
import {
	listGlobalLuaSymbols,
	buildMemberCompletionItems,
} from '../../../../editor/contrib/intellisense/engine';
import { listLuaBuiltinDescriptors } from '../../../../runtime/lua_builtins';
import { getKeywordCompletions } from '../../../../editor/contrib/suggest/keyword_completions';
import { isReservedMemoryMapName, semanticSymbolKindToLuaSymbolKind } from '../../../../../toolchain/ts/lua/semantic/common';
import {
	CompletionContext,
	CompletionSession,
	CompletionTrigger,
	EditContext,
	LuaCompletionItem,
	LuaCompletionKind,
} from '../../../../common/models';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../../../../../toolchain/ts/lua/semantic_contracts';
import { resourceIdentityKey } from '../../../../common/resource';
import * as constants from '../../../../common/constants';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../../input/keyboard/key_input';
import { isLuaCommentContext } from '../../../../common/text';
import { point_in_rect } from '../../../../../machine/ts/common/rect';
import { LuaLexer } from '../../../../../toolchain/ts/lua/syntax/lexer';
import { buildCanonicalCompletionItems, filterCompletionItems, resolveCompletionWordRange } from '../../../../editor/contrib/suggest/completion_model';
import { buildEditorSemanticFrontend } from '../../../../editor/contrib/intellisense/frontend';
import { assignRowColumn } from '../../../../common/state';
import * as TextEditing from '../../../../editor/editing/text_editing_and_selection';
import { isActiveLuaCodeTab, isReadOnlyCodeTab } from '../../../ui/code_tab/contexts';
import { prepareUndo } from '../../../../editor/editing/undo_controller';
import { updateDesiredColumn, revealCursor } from '../../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../../editor/render/caret';
import type { Decl } from '../../../../../toolchain/ts/lua/semantic/model';
import type { LuaSemanticFrontendFile } from '../../../../../toolchain/ts/lua/semantic/frontend';
import type { LuaSignatureHelp } from '../../../../../toolchain/ts/lua/semantic/signature_help';
import { clearSingleCursorSelection, setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import type { Runtime } from '../../../../../machine/ts/machine/runtime/runtime';
import type { PlayerInput } from '../../../../../hosts/common/input/player';
import { createResourceState, resourceSearchState } from '../../resources/widget_state';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { editorSearchState, lineJumpState } from '../find/widget_state';
import { symbolSearchState } from '../symbols/search/state';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../../runtime/fault_state';

type LocalCompletionCacheEntry = {
	parsedVersion: number;
	path: string;
	file: LuaSemanticFrontendFile;
};

const KEYWORD_COMPLETION_ITEMS: LuaCompletionItem[] = getKeywordCompletions();

export class CompletionController {
	public constructor(
		protected readonly bridge: RuntimeLuaTooling,
		protected readonly fault: RuntimeFaultState,
		protected readonly runtime: Runtime,
	) {}

	public get session(): CompletionSession | null { return this.completionSession; }
	public get hint(): LuaSignatureHelp | null { return this.parameterHint; }

	private readonly cursorPositionScratch = { row: 0, column: 0 };
	private readonly clampPositionScratch = { row: 0, column: 0 };
	private readonly inlineCompletionPreviewScratch = { row: 0, column: 0, suffix: '' };
	private readonly lastCursorPositionScratch = { row: 0, column: 0 };
	public readonly popupBoundsScratch = create_rect_bounds();

	protected isCompletionContextActive(): boolean {
		return isActiveLuaCodeTab();
	}

	protected isCompletionReady(): boolean {
		if (!isActiveLuaCodeTab()) {
			return false;
		}
		if (isReadOnlyCodeTab()) {
			return false;
		}
		if (editorSearchState.active || symbolSearchState.active || lineJumpState.active || resourceSearchState.active || createResourceState.active) {
			return false;
		}
		return true;
	}

	protected shouldAutoTrigger(): boolean {
		if (!this.isCompletionReady()) {
			return false;
		}
		const lastEditAt = activeCodeEditor.model.lastContentEditAtMs;
		if (lastEditAt < 0) {
			return false;
		}
		const now = editorRuntimeState.currentTimeMs;
		return now - lastEditAt <= constants.COMPLETION_TYPING_GRACE_MS;
	}

	protected getBuffer() {
		return activeCodeEditor.model.buffer;
	}

	protected getTextVersion(): number {
		return activeCodeEditor.model.version;
	}

	protected getActivePath(): string {
		return activeCodeEditor.model.resource.path;
	}

	protected getActiveDomain() {
		return activeCodeEditor.model.resource.domain;
	}

	protected getCharAt(row: number, column: number): string {
		return TextEditing.charAt(row, column);
	}

	protected prepareUndoRecord(): void {
		prepareUndo('completion', false);
	}

	protected replaceSelection(text: string): void {
		TextEditing.replaceSelectionWith(text);
	}

	protected clampBufferPosition(row: number, column: number): { row: number; column: number } {
		this.clampPositionScratch.row = row;
		this.clampPositionScratch.column = column;
		return editorViewState.layout.clampBufferPosition(activeCodeEditor.model.buffer, this.clampPositionScratch);
	}

	protected clearSelectionAnchor(): void {
		clearSingleCursorSelection(activeCodeEditor.view);
	}

	protected getCursorPosition(): { row: number; column: number } {
		this.cursorPositionScratch.row = activeCodeEditor.view.cursorRow;
		this.cursorPositionScratch.column = activeCodeEditor.view.cursorColumn;
		return this.cursorPositionScratch;
	}

	protected setCursorPosition(row: number, column: number): void {
		const buffer = this.getBuffer();
		const rowCount = buffer.getLineCount();
		const clampedRow = clamp(row, 0, rowCount - 1);
		const line = buffer.getLineContent(clampedRow);
		setSingleCursorPosition(activeCodeEditor.view, clampedRow, clamp(column, 0, line.length));
	}

	protected setSelectionAnchor(row: number, column: number): void {
		setSingleCursorSelectionAnchor(activeCodeEditor.view, row, column);
	}

	private setLastCursorPosition(row: number, column: number): void {
		this.lastCursorPosition = assignRowColumn(this.lastCursorPosition, row, column, this.lastCursorPositionScratch);
	}

	protected afterCompletionApplied(): void {
		updateDesiredColumn();
		resetBlink();
		revealCursor();
	}

	private completionSession: CompletionSession = null;
	private readonly localCompletionCache: Map<string, LocalCompletionCacheEntry> = new Map();
	private cachedGlobalSymbolEntries: readonly LuaSymbolEntry[] = null;
	private cachedGlobalCompletionItems: LuaCompletionItem[] = null;
	private cachedGlobalCompletionGeneration = 0;
	private sharedCompletionItems: LuaCompletionItem[] = null;
	private sharedCompletionVersion = -1;
	private pendingCompletionRequest: { context: CompletionContext; trigger: CompletionTrigger; elapsed: number } = null;
	private suppressNextAutoCompletion = false;
	private parameterHint: LuaSignatureHelp | null = null;
	private parameterHintTriggerPending = false;
	private parameterHintIdleElapsed = 0;
	private lastCursorPosition: { row: number; column: number } = null;
	private lastTextVersion = -1;
	private builtinDescriptors: readonly LuaBuiltinDescriptor[] | null = null;
	public popupBounds: { left: number; top: number; right: number; bottom: number } | null = null;
	public enterCommitsCompletion = false;

	// Public API for editor integration
	public closeSession(): void {
		this.completionSession = null;
		this.popupBounds = null;
		this.cancelPendingCompletion();
	}

	public listCompletionCandidates(): { context: CompletionContext; items: LuaCompletionItem[]; filteredItems: LuaCompletionItem[] } | null {
		const context = this.analyzeCompletionContext();
		if (!context) {
			return null;
		}
		const items = this.collectCompletionItems(context);
		if (items.length === 0) {
			return null;
		}
		const filteredItems = this.filterCompletionItemsForContext(items, context);
		return { context, items, filteredItems };
	}

	public applyCompletionItem(context: CompletionContext, item: LuaCompletionItem): void {
		const addParentheses = item.kind === 'native_method';
		this.applyCompletionItemForContext(context, item, addParentheses);
		this.closeSession();
	}

	public acceptSelectedCompletion(): boolean {
		if (!this.completionSession) {
			return false;
		}
		this.applySelectedCompletion();
		return true;
	}

	public getInlineCompletionPreview(): { row: number; column: number; suffix: string } {
		const session = this.completionSession;
		if (!session || session.trigger === 'manual') {
			return null;
		}
		if (session.filteredItems.length === 0) {
			return null;
		}
		let index = session.selectionIndex;
		if (index < 0 || index >= session.filteredItems.length) index = 0;
		const item = session.filteredItems[index];
		const addParentheses = item.kind === 'native_method';
		const insertion = addParentheses ? `${item.insertText}()` : item.insertText;
		const prefix = session.context.prefix;
		if (!insertion.startsWith(prefix)) {
			return null;
		}
		if (prefix.length >= insertion.length) {
			return null;
		}
		const preview = this.inlineCompletionPreviewScratch;
		preview.row = session.context.row;
		preview.column = session.context.replaceFromColumn + prefix.length;
		preview.suffix = insertion.slice(prefix.length);
		return preview;
	}

	public handlePointerWheel(direction: number, steps: number, pointer: { x: number; y: number }): boolean {
		const session = this.completionSession;
		if (!session || session.filteredItems.length === 0) {
			return false;
		}
		if (session.trigger !== 'manual') {
			return false;
		}
		if (pointer && !point_in_rect(pointer.x, pointer.y, this.popupBounds)) {
			return false;
		}
		const total = session.filteredItems.length;
		if (total === 0) {
			return pointer !== null || this.popupBounds !== null;
		}
		const unit = direction >= 0 ? 1 : -1;
		const stepCount = Math.max(1, steps);
		let moved = false;
		for (let i = 0; i < stepCount; i += 1) {
			let nextIndex = session.selectionIndex;
			if (nextIndex < 0) {
				nextIndex = unit > 0 ? 0 : total - 1;
			} else {
				const candidate = nextIndex + unit;
				if (candidate < 0) {
					if (nextIndex === 0) {
						continue;
					}
					nextIndex = 0;
				} else if (candidate >= total) {
					if (nextIndex === total - 1) {
						continue;
					}
					nextIndex = total - 1;
				} else {
					nextIndex = candidate;
				}
			}
			if (nextIndex !== session.selectionIndex) {
				session.selectionIndex = nextIndex;
				session.navigationCaptured = true;
				this.ensureCompletionSelectionVisible(session);
				moved = true;
			}
		}
		if (moved) {
			return true;
		}
		return pointer !== null;
	}

	public processPending(deltaSeconds: number): void {
		if (!this.isCompletionContextActive()) {
			this.closeSession();
			this.cancelPendingCompletion();
			this.parameterHint = null;
			return;
		}
		this.updateParameterHintIdle(deltaSeconds);
		const pending = this.pendingCompletionRequest;
		if (!pending) return;
		if (!this.isCompletionReady()) { this.cancelPendingCompletion(); return; }
		if (!this.shouldAutoTrigger()) { this.cancelPendingCompletion(); return; }
		if (this.completionSession) { this.cancelPendingCompletion(); return; }
		pending.elapsed += deltaSeconds;
		if (pending.elapsed < constants.COMPLETION_AUTO_TRIGGER_DELAY_SECONDS) return;
		const analyzed = this.analyzeCompletionContext();
		if (!analyzed) { this.cancelPendingCompletion(); return; }
		if (!this.completionContextsCompatible(pending.context, analyzed)) { this.cancelPendingCompletion(); return; }
		if (pending.trigger === 'typing' && analyzed.kind === 'global' && analyzed.prefix.length === 0) { this.cancelPendingCompletion(); return; }
		this.openCompletionSessionFromContext(analyzed, pending.trigger);
		this.pendingCompletionRequest = null;
		this.updateParameterHintIdle(deltaSeconds);
	}

	public onCursorMoved(): void {
		if (!this.isCompletionContextActive()) {
			this.closeSession();
			this.cancelPendingCompletion();
			this.parameterHint = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const parameterHintVisible = this.parameterHint !== null;
		this.cancelPendingCompletion();
		this.parameterHintTriggerPending = false;
		this.parameterHintIdleElapsed = 0;
		const session = this.completionSession;
		const cursor = this.getCursorPosition();
		if (session && session.trigger !== 'manual') {
			this.closeSession();
			if (parameterHintVisible) {
				this.refreshParameterHint();
			}
			return;
		}
		this.setLastCursorPosition(cursor.row, cursor.column);
		this.lastTextVersion = this.getTextVersion();
		if (session) {
			const context = this.analyzeCompletionContext();
			if (!context) this.closeSession();
			else this.refreshCompletionSessionFromContext(context);
		}
		if (parameterHintVisible) {
			this.refreshParameterHint();
		}
	}

	public updateAfterEdit(edit: EditContext): void {
		if (!this.isCompletionContextActive()) {
			this.closeSession();
			this.cancelPendingCompletion();
			this.parameterHint = null;
			return;
		}
		this.parameterHintIdleElapsed = 0;
		const cursor = this.getCursorPosition();
		this.setLastCursorPosition(cursor.row, cursor.column);
		this.lastTextVersion = this.getTextVersion();
		if (edit && edit.kind === 'insert') {
			if (edit.text.indexOf('(') !== -1 || edit.text.indexOf(',') !== -1) {
				this.parameterHintTriggerPending = true;
			}
		}
		if (this.suppressNextAutoCompletion) {
			this.suppressNextAutoCompletion = false;
			this.cancelPendingCompletion();
			this.refreshParameterHint();
			return;
		}
		this.updateCompletionSessionAfterMutation(edit);
		this.refreshParameterHint();
	}

	public handleKeybindings(playerInput: PlayerInput): boolean {
		if (!this.isCompletionContextActive()) {
			this.closeSession();
			this.cancelPendingCompletion();
			this.parameterHint = null;
			return false;
		}
		const { ctrlDown, altDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(playerInput), altDown: isAltDown(playerInput), metaDown: isMetaDown(playerInput), shiftDown: isShiftDown(playerInput) };
		if ((ctrlDown || metaDown) && !altDown && this.isCompletionReady() && isKeyJustPressed('Space', playerInput)) {
			consumeIdeKey('Space', playerInput);
			const session = this.completionSession;
			if (session) {
				if (session.trigger === 'manual') {
					this.closeSession();
				} else {
					const context = this.analyzeCompletionContext();
					if (context) this.openCompletionSessionFromContext(context, 'manual'); else this.closeSession();
				}
			} else {
				const context = this.analyzeCompletionContext();
				if (context) this.openCompletionSessionFromContext(context, 'manual'); else this.closeSession();
			}
			return true;
		}
		const session = this.completionSession;
		if (!session) return false;
		const manual = session.trigger === 'manual';
		if (isKeyJustPressed('Escape', playerInput)) {
			consumeIdeKey('Escape', playerInput);
			this.closeSession();
			return true;
		}
		if (!manual) {
			if (isKeyJustPressed('Tab', playerInput)) {
				consumeIdeKey('Tab', playerInput);
				if (shiftDown) {
					this.moveCompletionSelection(-1);
				} else {
					this.applySelectedCompletion();
				}
				return true;
			}
			return false;
		}
		if (this.handleNavigationKeys(playerInput, session, ctrlDown || metaDown)) {
			return true;
		}
		if (manual && this.enterCommitsCompletion) {
			const enterPressed = isKeyJustPressed('Enter', playerInput);
			const numpadEnterPressed = isKeyJustPressed('NumpadEnter', playerInput);
			if (enterPressed || numpadEnterPressed) {
				if (enterPressed) consumeIdeKey('Enter', playerInput); else consumeIdeKey('NumpadEnter', playerInput);
				this.applySelectedCompletion();
				return true;
			}
		}
		if (isKeyJustPressed('Tab', playerInput)) {
			consumeIdeKey('Tab', playerInput);
			if (shiftDown) {
				this.moveCompletionSelection(-1);
			} else {
				this.applySelectedCompletion();
			}
			return true;
		}
		return false;
	}

	// Internal helpers and logic
	private analyzeCompletionContext(): CompletionContext {
		if (!this.isCompletionReady()) return null;
		const buffer = this.getBuffer();
		const cursor = this.getCursorPosition();
		const lineCount = buffer.getLineCount();
		const row = clamp(cursor.row, 0, lineCount - 1);
		const line = buffer.getLineContent(row);
		const column = clamp(cursor.column, 0, line.length);
		const wordRange = resolveCompletionWordRange(line, column);
		const prefix = wordRange.prefix;
		const replaceFromColumn = wordRange.replaceFromColumn;
		const replaceToColumn = wordRange.replaceToColumn;
		if (isLuaCommentContext(buffer, row, replaceFromColumn)) {
			return null;
		}
		let operatorEndColumn = replaceFromColumn - 1;
		while (operatorEndColumn >= 0 && LuaLexer.isWhitespace(line.charAt(operatorEndColumn))) {
			operatorEndColumn -= 1;
		}
		const operatorEnd = line.charAt(operatorEndColumn);
		const hasNamedAccessOperator = operatorEnd === '.'
			|| operatorEnd === ':'
			|| (operatorEnd === '>' && line.charAt(operatorEndColumn - 1) === '-');
		if (!hasNamedAccessOperator) {
			return { kind: 'global', prefix, row, replaceFromColumn, replaceToColumn };
		}
		const semanticFile = this.ensureLocalCompletionCache().file;
		let member = semanticFile.findMemberCompletionContextAt(
			row + 1,
			replaceFromColumn + 1,
		);
		if (member === null && replaceFromColumn > operatorEndColumn + 1) {
			member = semanticFile.findMemberCompletionContextAt(row + 1, operatorEndColumn + 2);
		}
		if (member) {
			return {
				kind: 'member',
				member,
				prefix,
				row,
				replaceFromColumn,
				replaceToColumn,
			};
		}
		return null;
	}

	private getSharedCompletionEntries(): LuaCompletionItem[] {
		this.ensureBuiltinDescriptorCache();
		const globalItems = this.getGlobalCompletionItems();
		const version = this.cachedGlobalCompletionGeneration;
		if (!this.sharedCompletionItems || this.sharedCompletionVersion !== version) {
			const items: LuaCompletionItem[] = [];
			for (let i = 0; i < KEYWORD_COMPLETION_ITEMS.length; i += 1) {
				items.push(KEYWORD_COMPLETION_ITEMS[i]);
			}
			for (let i = 0; i < globalItems.length; i += 1) {
				items.push(globalItems[i]);
			}
			const builtinItems = this.getBuiltinCompletionItems();
			for (let i = 0; i < builtinItems.length; i += 1) {
				items.push(builtinItems[i]);
			}
			this.sharedCompletionItems = buildCanonicalCompletionItems(items);
			this.sharedCompletionVersion = version;
		}
		return this.sharedCompletionItems!;
	}

	private collectCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		if (context.kind === 'member') {
			const semanticItems = this.getSemanticMemberCompletionItems(context);
			const namePath = context.member.namePath;
			if (namePath === undefined || context.member.operator === '->') {
				return semanticItems;
			}
			const runtimeItems = buildMemberCompletionItems(
				this.bridge,
				this.fault,
				this.runtime,
				namePath,
				context.member.operator,
				activeCodeEditor.model.resource.domain,
				this.getActivePath(),
			);
			if (semanticItems.length === 0) {
				return runtimeItems;
			}
			if (runtimeItems.length === 0) {
				return semanticItems;
			}
			const merged = new Array<LuaCompletionItem>(semanticItems.length + runtimeItems.length);
			let index = 0;
			for (; index < semanticItems.length; index += 1) {
				merged[index] = semanticItems[index];
			}
			for (let runtimeIndex = 0; runtimeIndex < runtimeItems.length; runtimeIndex += 1) {
				merged[index + runtimeIndex] = runtimeItems[runtimeIndex];
			}
			return buildCanonicalCompletionItems(merged);
		}
		const sharedItems = this.getSharedCompletionEntries();
		const localItems = this.getLocalCompletionItems(context);
		if (localItems.length === 0) {
			return sharedItems;
		}
		const combined = new Array<LuaCompletionItem>(localItems.length + sharedItems.length);
		let index = 0;
		for (; index < localItems.length; index += 1) {
			combined[index] = localItems[index];
		}
		for (let i = 0; i < sharedItems.length; i += 1) {
			combined[index + i] = sharedItems[i];
		}
		return buildCanonicalCompletionItems(combined);
	}

	private getCompletionReplacementText(context: CompletionContext): string {
		const buffer = this.getBuffer();
		const row = clamp(context.row, 0, buffer.getLineCount() - 1);
		const line = buffer.getLineContent(row);
		const replaceStart = clamp(context.replaceFromColumn, 0, line.length);
		const replaceEnd = clamp(context.replaceToColumn, replaceStart, line.length);
		return line.slice(replaceStart, replaceEnd);
	}

	private filterCompletionItemsForContext(items: LuaCompletionItem[], context: CompletionContext): LuaCompletionItem[] {
		return filterCompletionItems(items, context.prefix, this.getCompletionReplacementText(context));
	}

	private getLocalCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		const cached = this.ensureLocalCompletionCache();
		const column = context.replaceToColumn;
		const filtered = cached.file.getVisibleDeclarationsAt(context.row + 1, column + 1);
		if (filtered.length === 0) {
			return [];
		}
		return this.buildLocalCompletionItems(filtered, cached.path);
	}

	private ensureLocalCompletionCache(): LocalCompletionCacheEntry {
		const key = resourceIdentityKey(activeCodeEditor.model.resource);
		const path = this.getActivePath();
		const currentVersion = this.getTextVersion();
		const cached = this.localCompletionCache.get(key);
		if (cached && cached.path === path && cached.parsedVersion === currentVersion) {
			return cached;
		}
		const frontend = buildEditorSemanticFrontend(
			this.bridge,
			activeCodeEditor.model.resource,
			this.getBuffer(),
		);
		const file = frontend.getFile(path);
		const updated: LocalCompletionCacheEntry = {
			parsedVersion: currentVersion,
			path,
			file,
		};
		this.localCompletionCache.set(key, updated);
		return updated;
	}

	private getGlobalCompletionItems(): LuaCompletionItem[] {
		const entries = listGlobalLuaSymbols(this.bridge, this.getActiveDomain());
		if (this.cachedGlobalCompletionItems && this.cachedGlobalSymbolEntries === entries) {
			return this.cachedGlobalCompletionItems;
		}
		const items = this.buildSymbolCompletionItems(entries, 'global');
		items.sort((a, b) => a.label.localeCompare(b.label));
		this.cachedGlobalSymbolEntries = entries;
		this.cachedGlobalCompletionItems = items;
		this.cachedGlobalCompletionGeneration += 1;
		this.sharedCompletionItems = null;
		this.sharedCompletionVersion = -1;
		return items;
	}

	private getBuiltinCompletionItems(): LuaCompletionItem[] {
		const items: LuaCompletionItem[] = [];
		const descriptors = this.builtinDescriptors;
		for (let index = 0; index < descriptors.length; index += 1) {
			const descriptor = descriptors[index];
			const label = descriptor.name;
			const insertText = isReservedMemoryMapName(label) ? `${label}[]` : label;
			const params = descriptor.params.slice();
			const baseDetail = descriptor.signature && descriptor.signature.length > 0 ? descriptor.signature : 'Lua builtin';
			const detail = descriptor.description && descriptor.description.length > 0 ? `${baseDetail} • ${descriptor.description}` : baseDetail;
			items.push({ label, insertText, sortKey: `builtin:${label}`, kind: 'builtin', detail, parameters: params });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private buildSymbolCompletionItems(entries: LuaSymbolEntry[], scope: 'local' | 'global'): LuaCompletionItem[] {
		if (entries.length === 0) return [];
		const items: LuaCompletionItem[] = [];
		for (let i = 0; i < entries.length; i += 1) {
			const entry = entries[i];
			const origin = (() => {
				if (entry.location.path) return entry.location.path;
				return '';
			})();
			const kindLabel = this.formatSymbolKind(entry.kind);
			const detail = origin.length > 0 ? `${kindLabel} • ${origin}` : kindLabel;
			const sortKey = `${scope}:${origin}:${entry.path}:${entry.name}:${entry.kind}`;
			const completionKind: LuaCompletionKind = scope === 'local' ? 'local' : 'global';
			items.push({ label: entry.name, insertText: entry.name, sortKey, kind: completionKind, detail });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private buildLocalCompletionItems(symbols: readonly Decl[], pathLabel: string): LuaCompletionItem[] {
		const items: LuaCompletionItem[] = [];
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			if (!this.isLocalCompletionDeclaration(symbol)) {
				continue;
			}
			const label = symbol.name;
			const kindLabel = this.formatSymbolKind(semanticSymbolKindToLuaSymbolKind(symbol.kind));
			const detailParts: string[] = [kindLabel];
			if (pathLabel && pathLabel.length > 0) {
				detailParts.push(pathLabel);
			}
			detailParts.push(`line ${symbol.range.start.line}`);
			const detail = detailParts.join(' • ');
			const sortKey = `local:${symbol.range.start.line.toString().padStart(6, '0')}:${label}`;
			items.push({ label, insertText: label, sortKey, kind: 'local', detail });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private getSemanticMemberCompletionItems(
		context: Extract<CompletionContext, { kind: 'member' }>,
	): LuaCompletionItem[] {
		const cached = this.ensureLocalCompletionCache();
		const symbols = cached.file.getMemberCompletionDeclarations(context.member);
		if (symbols.length === 0) {
			return [];
		}
		const items = new Array<LuaCompletionItem>(symbols.length);
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			const kind = semanticSymbolKindToLuaSymbolKind(symbol.kind);
			items[index] = {
				label: symbol.name,
				insertText: symbol.name,
				sortKey: `member:${symbol.name}:${symbol.file}:${symbol.range.start.line}:${symbol.range.start.column}`,
				kind: 'member',
				detail: `${this.formatSymbolKind(kind)} • ${symbol.file} • line ${symbol.range.start.line}`,
			};
		}
		return items;
	}

	private isLocalCompletionDeclaration(declaration: Decl): boolean {
		const kind = semanticSymbolKindToLuaSymbolKind(declaration.kind);
		switch (kind) {
			case 'variable':
			case 'constant':
			case 'function':
			case 'parameter':
				return true;
			default:
				return false;
		}
	}

	private isIdentifierTriggerPrefix(prefix: string): boolean {
		if (prefix.length === 0) {
			return false;
		}
		return LuaLexer.isIdentifierStart(prefix.charAt(0));
	}

	private formatSymbolKind(kind: LuaSymbolEntry['kind']): string {
		switch (kind) {
			case 'module': return 'module';
			case 'function': return 'function';
			case 'variable': return 'variable';
			case 'constant': return 'constant';
			case 'parameter': return 'parameter';
			case 'table_field': return 'table field';
			case 'assignment': return 'assignment';
			default: return kind;
		}
	}

	private ensureBuiltinDescriptorCache(): void {
		const descriptors = listLuaBuiltinDescriptors();
		if (this.builtinDescriptors === descriptors) return;
		this.builtinDescriptors = descriptors;
		this.sharedCompletionItems = null;
	}

	private determineAutoCompletionTrigger(context: CompletionContext, edit: EditContext): CompletionTrigger {
		if (!this.shouldAutoTrigger()) return null;
		if (!edit || edit.kind === 'delete') return null;
		if (edit.text.length === 0) return null;
		const lastChar = edit.text.charAt(edit.text.length - 1);
		if (context.kind === 'member') {
			if (lastChar === '.'
				|| lastChar === ':'
				|| (lastChar === '>' && context.member.operator === '->')) return 'punctuation';
			if (!LuaLexer.isIdentifierPart(lastChar)) return null;
			return context.prefix.length === 0 ? null : 'typing';
		}
		if (!LuaLexer.isIdentifierPart(lastChar)) return null;
		if (!this.isIdentifierTriggerPrefix(context.prefix)) return null;
		return 'typing';
	}

	private updateCompletionSessionAfterMutation(edit: EditContext): void {
		if (!this.isCompletionReady()) { this.closeSession(); return; }
		const analyzed = this.analyzeCompletionContext();
		if (this.completionSession) {
			this.cancelPendingCompletion();
			if (!analyzed) { this.closeSession(); return; }
			const cursor = this.getCursorPosition();
			const previousChar = this.getCharAt(cursor.row, cursor.column - 1);
			const atMemberOperator = analyzed.kind === 'member'
				&& (previousChar === '.'
					|| previousChar === ':'
					|| (previousChar === '>' && analyzed.member.operator === '->'));
			if (analyzed.prefix.length === 0 && !atMemberOperator && !LuaLexer.isIdentifierPart(previousChar)) { this.closeSession(); return; }
			this.refreshCompletionSessionFromContext(analyzed);
			return;
		}
		if (!edit || !analyzed) { this.cancelPendingCompletion(); return; }
		if (!this.shouldAutoTrigger()) { this.cancelPendingCompletion(); return; }
		const trigger = this.determineAutoCompletionTrigger(analyzed, edit);
		if (!trigger) { this.cancelPendingCompletion(); return; }
		this.pendingCompletionRequest = { context: analyzed, trigger, elapsed: 0 };
	}

	private openCompletionSessionFromContext(context: CompletionContext, trigger: CompletionTrigger): void {
		this.cancelPendingCompletion();
		const items = this.collectCompletionItems(context);
		if (items.length === 0) { this.completionSession = null; return; }
		const cursor = this.getCursorPosition();
		const session: CompletionSession = {
			context,
			items,
			filteredItems: [],
			selectionIndex: -1,
			displayOffset: 0,
			anchorRow: cursor.row,
			anchorColumn: cursor.column,
			maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
			filterCache: new Map(),
			trigger,
			navigationCaptured: trigger === 'manual',
		};
		this.completionSession = session;
		this.applyCompletionFilter(session);
	}

	private refreshCompletionSessionFromContext(context: CompletionContext): void {
		const session = this.completionSession;
		if (!session) return;
		const reuseItems = this.completionContextsCompatible(session.context, context);
		const items = reuseItems ? session.items : this.collectCompletionItems(context);
		if (items.length === 0) { this.closeSession(); return; }
		session.context = context;
		if (!reuseItems) {
			session.items = items;
			session.filterCache.clear();
		}
		const cursor = this.getCursorPosition();
		session.anchorRow = cursor.row;
		session.anchorColumn = cursor.column;
		this.applyCompletionFilter(session);
	}

	private applyCompletionFilter(session: CompletionSession): void {
		const prefix = session.context.prefix;
		const cacheKey = prefix;
		let filtered = session.filterCache.get(cacheKey);
		if (!filtered) {
			filtered = this.filterCompletionItemsForContext(session.items, session.context);
			session.filterCache.set(cacheKey, filtered);
		}
		if (filtered.length === 0) {
			session.filteredItems = [];
			session.selectionIndex = -1;
			session.displayOffset = 0;
			this.closeSession();
			return;
		}
		session.filteredItems = filtered;
		if (session.selectionIndex < 0 || session.selectionIndex >= session.filteredItems.length) session.selectionIndex = 0;
		this.ensureCompletionSelectionVisible(session);
	}

	private moveCompletionSelection(delta: number): void {
		const session = this.completionSession;
		if (!session) return;
		const total = session.filteredItems.length;
		if (total === 0) return;
		session.navigationCaptured = true;
		let index = session.selectionIndex;
		if (index < 0) index = delta > 0 ? 0 : total - 1; else { index += delta; index = ((index % total) + total) % total; }
		session.selectionIndex = index;
		this.ensureCompletionSelectionVisible(session);
	}

	private handleNavigationKeys(playerInput: PlayerInput, session: CompletionSession, allowHomeEnd: boolean): boolean {
		let moved = false;
		if (this.navigationActive(playerInput, 'ArrowDown')) {
			consumeIdeKey('ArrowDown', playerInput);
			this.moveCompletionSelection(1);
			moved = true;
		}
		if (this.navigationActive(playerInput, 'ArrowUp')) {
			consumeIdeKey('ArrowUp', playerInput);
			this.moveCompletionSelection(-1);
			moved = true;
		}
		if (this.navigationActive(playerInput, 'PageDown')) {
			consumeIdeKey('PageDown', playerInput);
			this.moveCompletionSelection(session.maxVisibleItems);
			moved = true;
		}
		if (this.navigationActive(playerInput, 'PageUp')) {
			consumeIdeKey('PageUp', playerInput);
			this.moveCompletionSelection(-session.maxVisibleItems);
			moved = true;
		}
		if (allowHomeEnd && this.navigationActive(playerInput, 'Home')) {
			consumeIdeKey('Home', playerInput);
			if (session.filteredItems.length > 0) {
				session.selectionIndex = 0;
				this.ensureCompletionSelectionVisible(session);
				session.navigationCaptured = true;
			}
			moved = true;
		}
		if (allowHomeEnd && this.navigationActive(playerInput, 'End')) {
			consumeIdeKey('End', playerInput);
			if (session.filteredItems.length > 0) {
				session.selectionIndex = session.filteredItems.length - 1;
				this.ensureCompletionSelectionVisible(session);
				session.navigationCaptured = true;
			}
			moved = true;
		}
		return moved;
	}

	private navigationActive(playerInput: PlayerInput, code: string): boolean {
		return shouldRepeatKeyFromPlayer(code, playerInput);
	}

	private ensureCompletionSelectionVisible(session: CompletionSession): void {
		if (session.selectionIndex < 0) { session.displayOffset = 0; return; }
		const visible = session.maxVisibleItems;
		let offset = session.displayOffset;
		if (session.selectionIndex < offset) offset = session.selectionIndex;
		const upperBound = offset + visible - 1;
		if (session.selectionIndex > upperBound) offset = session.selectionIndex - visible + 1;
		if (offset < 0) offset = 0;
		const maxOffset = session.filteredItems.length - visible;
		if (offset > maxOffset) offset = maxOffset;
		session.displayOffset = offset;
	}

	private completionContextsCompatible(expected: CompletionContext, actual: CompletionContext): boolean {
		if (expected.kind !== actual.kind) return false;
		if (expected.kind === 'member' && actual.kind === 'member') {
			if (expected.member.operator !== actual.member.operator) return false;
			if (expected.member.receiverKey !== actual.member.receiverKey) return false;
		}
		return true;
	}

	private applySelectedCompletion(): void {
		const session = this.completionSession;
		if (!session) return;
		if (session.filteredItems.length === 0) { this.closeSession(); return; }
		let index = session.selectionIndex;
		if (index < 0 || index >= session.filteredItems.length) index = 0;
		const item = session.filteredItems[index];
		const addParentheses = item.kind === 'native_method';
		const freshContext = this.analyzeCompletionContext();
		const effectiveContext = freshContext && this.completionContextsCompatible(session.context, freshContext) ? freshContext : session.context;
		this.applyCompletionItemForContext(effectiveContext, item, addParentheses);
		this.closeSession();
	}

	private applyCompletionItemForContext(context: CompletionContext, item: LuaCompletionItem, addParentheses: boolean): void {
		const buffer = this.getBuffer();
		const lineCount = buffer.getLineCount();
		const row = clamp(context.row, 0, lineCount - 1);
		const line = buffer.getLineContent(row);
		const replaceStart = clamp(context.replaceFromColumn, 0, line.length);
		const replaceEnd = clamp(context.replaceToColumn, replaceStart, line.length);
		this.setCursorPosition(row, replaceEnd);
		this.setSelectionAnchor(row, replaceStart);
		this.prepareUndoRecord();
		this.suppressNextAutoCompletion = true;
		let insertion = item.insertText;
		if (addParentheses) insertion = `${item.insertText}()`;
		this.replaceSelection(insertion);
		const targetColumn = addParentheses
			? replaceStart + item.insertText.length + 1
			: insertion.endsWith('[]')
				? replaceStart + insertion.length - 1
				: replaceStart + insertion.length;
		const clamped = this.clampBufferPosition(row, targetColumn);
		this.setCursorPosition(clamped.row, clamped.column);
		this.clearSelectionAnchor();
		this.afterCompletionApplied();
	}

	private cancelPendingCompletion(): void {
		this.pendingCompletionRequest = null;
	}

	private refreshParameterHint(): void {
		if (!this.isCompletionReady()) {
			this.parameterHint = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const info = this.resolveParameterHintContext();
		if (!info) {
			this.parameterHint = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		if (this.parameterHintTriggerPending) {
			this.parameterHintTriggerPending = false;
			this.parameterHint = info;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const current = this.parameterHint;
		if (current
			&& current.applicableRange.start.line === info.applicableRange.start.line
			&& current.applicableRange.start.column === info.applicableRange.start.column) {
			this.parameterHint = info;
			return;
		}
		this.parameterHint = null;
		this.parameterHintIdleElapsed = 0;
	}

	private updateParameterHintIdle(deltaSeconds: number): void {
		if (!this.isCompletionReady()) {
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const cursor = this.getCursorPosition();
		const currentRow = cursor.row;
		const currentColumn = cursor.column;
		const currentVersion = this.getTextVersion();
		const last = this.lastCursorPosition;
		if (!last || last.row !== currentRow || last.column !== currentColumn || this.lastTextVersion !== currentVersion) {
			this.setLastCursorPosition(currentRow, currentColumn);
			this.lastTextVersion = currentVersion;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		this.parameterHintIdleElapsed += deltaSeconds;
		if (this.parameterHintIdleElapsed >= constants.PARAMETER_HINT_IDLE_DELAY_SECONDS) {
			this.parameterHintTriggerPending = true;
			this.parameterHintIdleElapsed = 0;
			this.refreshParameterHint();
		}
	}

	private resolveParameterHintContext(): LuaSignatureHelp | null {
		if (!this.isCompletionReady()) return null;
		const cursor = this.getCursorPosition();
		const frontend = buildEditorSemanticFrontend(
			this.bridge,
			activeCodeEditor.model.resource,
			this.getBuffer(),
		);
		return frontend.provideSignatureHelp(
			this.getActivePath(),
			cursor.row + 1,
			cursor.column + 1,
		);
	}
}

export class EditorCompletionController extends CompletionController {
	private readonly unsubscribeCursorMoved: () => void;
	private readonly unsubscribeTextMutated: () => void;

	public constructor(bridge: RuntimeLuaTooling, fault: RuntimeFaultState, runtime: Runtime) {
		super(bridge, fault, runtime);
		this.unsubscribeCursorMoved = activeCodeEditor.onDidMoveCursor(() => this.onCursorMoved());
		this.unsubscribeTextMutated = editorTextModelService.onDidChangeContent((model, event) => {
			if (model === activeCodeEditor.model) {
				this.updateAfterEdit(event.editContext);
			}
		});
	}

	public dispose(): void {
		this.unsubscribeCursorMoved();
		this.unsubscribeTextMutated();
		this.closeSession();
	}
}
