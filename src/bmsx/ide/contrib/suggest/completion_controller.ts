import { clamp } from '../../../utils/clamp';
import { editorDocumentState } from '../../editing/editor_document_state';
import {
	getApiCompletionData,
	getKeywordCompletions,
	intellisenseUiReady,
	isReservedMemoryMapName,
	listGlobalLuaSymbols,
	listLuaBuiltinFunctions,
	listLuaModuleSymbols,
	buildMemberCompletionItems,
	type LuaScopedSymbol,
	shouldAutoTriggerCompletions,
} from '../intellisense/intellisense';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../../lua/syntax/lua_ast';
import {
	CompletionContext,
	CompletionSession,
	CompletionTrigger,
	EditContext,
	LuaCompletionItem,
	LuaCompletionKind,
	ParameterHintState,
} from '../../core/types';
import type { LuaBuiltinDescriptor, LuaDefinitionRange, LuaSymbolEntry } from '../../../emulator/types';
import * as constants from '../../core/constants';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { isLuaCommentContext } from '../../core/text_utils';
import { point_in_rect } from '../../../utils/rect_operations';
import { LuaLexer } from '../../../lua/syntax/lualexer';
import { assignRowColumn, ide_state } from '../../core/ide_state';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { getActiveCodeTabContext, isActiveLuaCodeTab } from '../../ui/editor_tabs';
import { prepareUndo } from '../../editing/undo_controller';
import { updateDesiredColumn, revealCursor } from '../../ui/caret';
import { resetBlink } from '../../render/render_caret';
import { ModuleAliasEntry } from '../intellisense/semantic_model';
import { getActiveSemanticDefinitions, getLuaModuleAliases } from '../problems/diagnostics_controller';
import { clearSingleCursorSelection, setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../editing/cursor_state';

type LocalCompletionCacheEntry = {
	parsedVersion: number;
	path: string;
	symbols: LuaScopedSymbol[];
	moduleAliases: Map<string, ModuleAliasEntry>;
};

const KEYWORD_COMPLETION_ITEMS: LuaCompletionItem[] = getKeywordCompletions();

export class CompletionController {
	public constructor() {}

	public get session(): CompletionSession | null { return this.completionSession; }
	public get hint(): ParameterHintState | null { return this.parameterHint; }

	private readonly cursorPositionScratch = { row: 0, column: 0 };
	private readonly clampPositionScratch = { row: 0, column: 0 };
	private readonly inlineCompletionPreviewScratch = { row: 0, column: 0, suffix: '' };
	private readonly lastCursorPositionScratch = { row: 0, column: 0 };
	private readonly parameterHintAnchorScratch = { row: 0, column: 0 };

	protected isCompletionContextActive(): boolean {
		return isActiveLuaCodeTab();
	}

	protected isCompletionReady(): boolean {
		return intellisenseUiReady();
	}

	protected shouldAutoTrigger(): boolean {
		return shouldAutoTriggerCompletions();
	}

	protected getBuffer() {
		return editorDocumentState.buffer;
	}

	protected getTextVersion(): number {
		return editorDocumentState.textVersion;
	}

	protected getActivePath(): string {
		return getActiveCodeTabContext().descriptor.path;
	}

	protected getSemanticDefinitions(): readonly LuaDefinitionInfo[] {
		return getActiveSemanticDefinitions();
	}

	protected getModuleAliases(path: string): Map<string, ModuleAliasEntry> {
		return getLuaModuleAliases(path);
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
		return ide_state.layout.clampBufferPosition(editorDocumentState.buffer, this.clampPositionScratch);
	}

	protected clearSelectionAnchor(): void {
		clearSingleCursorSelection(editorDocumentState);
	}

	protected getCursorPosition(): { row: number; column: number } {
		this.cursorPositionScratch.row = editorDocumentState.cursorRow;
		this.cursorPositionScratch.column = editorDocumentState.cursorColumn;
		return this.cursorPositionScratch;
	}

	protected setCursorPosition(row: number, column: number): void {
		const buffer = this.getBuffer();
		const rowCount = buffer.getLineCount();
		const clampedRow = clamp(row, 0, Math.max(0, rowCount - 1));
		const line = buffer.getLineContent(clampedRow);
		setSingleCursorPosition(editorDocumentState, clampedRow, clamp(column, 0, line.length));
	}

	protected setSelectionAnchor(row: number, column: number): void {
		setSingleCursorSelectionAnchor(editorDocumentState, row, column);
	}

	private setLastCursorPosition(row: number, column: number): void {
		this.lastCursorPosition = assignRowColumn(this.lastCursorPosition, row, column, this.lastCursorPositionScratch);
	}

	private setParameterHintAnchor(row: number, column: number): void {
		this.parameterHintAnchor = assignRowColumn(this.parameterHintAnchor, row, column, this.parameterHintAnchorScratch);
	}

	protected afterCompletionApplied(): void {
		updateDesiredColumn();
		resetBlink();
		revealCursor();
	}

	private completionSession: CompletionSession = null;
	private readonly localCompletionCache: Map<string, LocalCompletionCacheEntry> = new Map();
	private cachedGlobalCompletionItems: LuaCompletionItem[] = null;
	private cachedGlobalCompletionVersion = -1;
	private sharedCompletionItems: LuaCompletionItem[] = null;
	private sharedCompletionMap: Map<string, LuaCompletionItem> = null;
	private sharedCompletionVersion = -1;
	private pendingCompletionRequest: { context: CompletionContext; trigger: CompletionTrigger; elapsed: number } = null;
	private suppressNextAutoCompletion = false;
	private parameterHint: ParameterHintState = null;
	private parameterHintAnchor: { row: number; column: number } = null;
	private parameterHintTriggerPending = false;
	private parameterHintIdleElapsed = 0;
	private lastCursorPosition: { row: number; column: number } = null;
	private lastTextVersion = -1;
	private builtinDescriptors: LuaBuiltinDescriptor[] = null;
	private readonly builtinDescriptorMap: Map<string, LuaBuiltinDescriptor> = new Map();
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
		const filteredItems = this.filterCompletionItems(items, context.prefix);
		return { context, items, filteredItems };
	}

	public applyCompletionItem(context: CompletionContext, item: LuaCompletionItem): void {
		const addParentheses = item.kind === 'api_method' || item.kind === 'native_method';
		this.applyCompletionItemForContext(context, item, addParentheses);
		this.closeSession();
	}

	public tryAcceptSelectedCompletion(): boolean {
		if (!this.completionSession) {
			return false;
		}
		this.acceptSelectedCompletion();
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
		const addParentheses = item.kind === 'api_method' || item.kind === 'native_method';
		const insertion = addParentheses ? `${item.insertText}()` : item.insertText;
		const prefix = session.context.prefix;
		if (!insertion.toLowerCase().startsWith(prefix.toLowerCase())) {
			return null;
		}
		if (prefix.length >= insertion.length) {
			return null;
		}
		const preview = this.inlineCompletionPreviewScratch;
		preview.row = session.context.row;
		preview.column = session.context.replaceToColumn;
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
			this.parameterHintAnchor = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		this.cancelPendingCompletion();
		this.parameterHint = null;
		this.parameterHintAnchor = null;
		this.parameterHintTriggerPending = false;
		this.parameterHintIdleElapsed = 0;
		const session = this.completionSession;
		const cursor = this.getCursorPosition();
		if (session && session.trigger !== 'manual') {
			this.closeSession();
			this.refreshParameterHint();
			return;
		}
		this.setLastCursorPosition(cursor.row, cursor.column);
		this.lastTextVersion = this.getTextVersion();
		if (session) {
			const context = this.analyzeCompletionContext();
			if (!context) this.closeSession();
			else this.refreshCompletionSessionFromContext(context);
		}
		this.refreshParameterHint();
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

	public handleKeybindings(): boolean {
		if (!this.isCompletionContextActive()) {
			this.closeSession();
			this.cancelPendingCompletion();
			this.parameterHint = null;
			return false;
		}
		const { ctrlDown, altDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };
		if ((ctrlDown || metaDown) && !altDown && this.isCompletionReady() && isKeyJustPressed('Space')) {
			consumeIdeKey('Space');
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
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.closeSession();
			return true;
		}
		if (!manual) {
			if (isKeyJustPressed('Tab')) {
				consumeIdeKey('Tab');
				if (shiftDown) {
					this.moveCompletionSelection(-1);
				} else {
					this.acceptSelectedCompletion();
				}
				return true;
			}
			return false;
		}
		if (this.handleNavigationKeys(session, ctrlDown || metaDown)) {
			return true;
		}
		if (manual && this.enterCommitsCompletion) {
			const enterPressed = isKeyJustPressed('Enter');
			const numpadEnterPressed = isKeyJustPressed('NumpadEnter');
			if (enterPressed || numpadEnterPressed) {
				if (enterPressed) consumeIdeKey('Enter'); else consumeIdeKey('NumpadEnter');
				this.acceptSelectedCompletion();
				return true;
			}
		}
		if (isKeyJustPressed('Tab')) {
			consumeIdeKey('Tab');
			if (shiftDown) {
				this.moveCompletionSelection(-1);
			} else {
				this.acceptSelectedCompletion();
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
		const row = clamp(cursor.row, 0, Math.max(0, lineCount - 1));
		const line = buffer.getLineContent(row);
		const column = clamp(cursor.column, 0, line.length);
		let start = column;
		while (start > 0 && LuaLexer.isIdentifierPart(line.charAt(start - 1))) start -= 1;
		const prefix = line.slice(start, column);
		const replaceFromColumn = start;
		const replaceToColumn = column;
		if (isLuaCommentContext(buffer, row, replaceFromColumn)) {
			return null;
		}
		let probe = start - 1;
		while (probe >= 0 && LuaLexer.isWhitespace(line.charAt(probe))) probe -= 1;
		if (probe >= 0) {
			const operator = line.charAt(probe);
			if (operator === '.' || operator === ':') {
				const objectName = this.readMemberObjectExpression(line, probe - 1);
				if (objectName === null) return null;
				return { kind: 'member', objectName, operator: operator as '.' | ':', prefix, row, replaceFromColumn, replaceToColumn };
			}
		}
		return { kind: 'global', prefix, row, replaceFromColumn, replaceToColumn };
	}

	private readMemberObjectExpression(line: string, fromIndex: number): string | null {
		let scan = fromIndex;
		while (scan >= 0 && LuaLexer.isWhitespace(line.charAt(scan))) scan -= 1;
		if (scan < 0) {
			return null;
		}
		const segments: string[] = [];
		const separators: Array<'.' | ':'> = [];
		while (scan >= 0) {
			const segmentEnd = scan;
			while (scan >= 0 && LuaLexer.isIdentifierPart(line.charAt(scan))) {
				scan -= 1;
			}
			const segmentStart = scan + 1;
			if (segmentStart > segmentEnd) {
				return null;
			}
			const segment = line.slice(segmentStart, segmentEnd + 1);
			if (!LuaLexer.isIdentifierStart(segment.charAt(0))) {
				return null;
			}
			segments.unshift(segment);
			while (scan >= 0 && LuaLexer.isWhitespace(line.charAt(scan))) scan -= 1;
			if (scan < 0) {
				break;
			}
			const separator = line.charAt(scan);
			if (separator !== '.' && separator !== ':') {
				break;
			}
			separators.unshift(separator as '.' | ':');
			scan -= 1;
			while (scan >= 0 && LuaLexer.isWhitespace(line.charAt(scan))) scan -= 1;
			if (scan < 0) {
				return null;
			}
		}
		if (segments.length === 0) {
			return null;
		}
		let expression = segments[0];
		for (let index = 0; index < separators.length; index += 1) {
			expression += `${separators[index]}${segments[index + 1]}`;
		}
		return expression;
	}

	private getSharedCompletionEntries(): { list: LuaCompletionItem[]; map: Map<string, LuaCompletionItem> } {
		const globalItems = this.getGlobalCompletionItems();
		const version = this.cachedGlobalCompletionVersion;
		if (!this.sharedCompletionItems || !this.sharedCompletionMap || this.sharedCompletionVersion !== version) {
			const map = new Map<string, LuaCompletionItem>();
			const register = (item: LuaCompletionItem): void => {
				if (!map.has(item.sortKey)) {
					map.set(item.sortKey, item);
				}
			};
			for (let i = 0; i < KEYWORD_COMPLETION_ITEMS.length; i += 1) {
				register(KEYWORD_COMPLETION_ITEMS[i]);
			}
			for (let i = 0; i < globalItems.length; i += 1) {
				register(globalItems[i]);
			}
			const builtinItems = this.getBuiltinCompletionItems();
			for (let i = 0; i < builtinItems.length; i += 1) {
				register(builtinItems[i]);
			}
			const sharedList = Array.from(map.values());
			sharedList.sort((a, b) => a.label.localeCompare(b.label));
			this.sharedCompletionItems = sharedList;
			this.sharedCompletionMap = map;
			this.sharedCompletionVersion = version;
		}
		return { list: this.sharedCompletionItems!, map: this.sharedCompletionMap! };
	}

	private collectCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		if (context.kind === 'member') {
			if (context.objectName.toLowerCase() === 'api') {
				return getApiCompletionData().items.slice();
			}
			const merged: LuaCompletionItem[] = [];
			const seen = new Map<string, LuaCompletionItem>();
			const appendItems = (items: LuaCompletionItem[]): void => {
				if (!items || items.length === 0) {
					return;
				}
				for (let i = 0; i < items.length; i += 1) {
					const item = items[i];
					if (!seen.has(item.sortKey)) {
						seen.set(item.sortKey, item);
						merged.push(item);
					}
				}
			};
			appendItems(this.getModuleMemberCompletionItems(context));
			const path = this.getActivePath();
			const runtimeItems = buildMemberCompletionItems({
				objectName: context.objectName,
				operator: context.operator,
				prefix: context.prefix,
				path,
			});
			appendItems(runtimeItems);
			if (merged.length > 0) {
				return merged;
			}
			return [];
		}
		const shared = this.getSharedCompletionEntries();
		const localItems = this.getLocalCompletionItems(context);
		if (localItems.length === 0) {
			return shared.list;
		}
		const combined = shared.list.slice();
		for (let i = 0; i < localItems.length; i += 1) {
			const item = localItems[i];
			if (!shared.map.has(item.sortKey)) {
				combined.push(item);
			}
		}
		return combined;
	}

	private getLocalCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		const cached = this.ensureLocalCompletionCache();
		if (!cached) return [];
		const column = context.replaceToColumn;
		const buffer = this.getBuffer();
		const lineCount = buffer.getLineCount();
		const lastLine = buffer.getLineContent(Math.max(0, lineCount - 1));
		const filtered = this.filterLocalSymbolsAtPosition(cached.symbols, lineCount, lastLine.length, context.row, column);
		if (filtered.length === 0) {
			return [];
		}
		const path = cached.path || this.getActivePath();
		return this.buildLocalCompletionItems(filtered, path);
	}

	private ensureLocalCompletionCache(): LocalCompletionCacheEntry {
		const key = this.getActivePath();
		if (!key) return null;
		const path = this.getActivePath();
		const currentVersion = this.getTextVersion();
		const cached = this.localCompletionCache.get(key);
		if (cached && cached.path === path && cached.parsedVersion === currentVersion) {
			return cached;
		}
		const definitions = this.getSemanticDefinitions();
		if (!definitions) {
			return cached;
		}
		const symbols = definitions.length > 0 ? this.convertDefinitionsToLocalSymbols(definitions) : [];
		const moduleAliases = this.getModuleAliases(path);
		const updated: LocalCompletionCacheEntry = {
			parsedVersion: currentVersion,
			path,
			symbols,
			moduleAliases: new Map(moduleAliases),
		};
		this.localCompletionCache.set(key, updated);
		return updated;
	}

	private getGlobalCompletionItems(): LuaCompletionItem[] {
		const version = this.getTextVersion();
		if (this.cachedGlobalCompletionItems && this.cachedGlobalCompletionVersion === version) {
			return this.cachedGlobalCompletionItems;
		}
		const entries = listGlobalLuaSymbols();
		const items = this.buildSymbolCompletionItems(entries, 'global');
		const apiItem: LuaCompletionItem = { label: 'api', insertText: 'api', sortKey: 'global:api', kind: 'global', detail: 'Runtime API root' };
		items.push(apiItem);
		items.sort((a, b) => a.label.localeCompare(b.label));
		this.cachedGlobalCompletionItems = items;
		this.cachedGlobalCompletionVersion = version;
		this.sharedCompletionItems = null;
		this.sharedCompletionMap = null;
		this.sharedCompletionVersion = -1;
		return items;
	}

	private getBuiltinCompletionItems(): LuaCompletionItem[] {
		this.ensureBuiltinDescriptorCache();
		const items: LuaCompletionItem[] = [];
		for (const descriptor of this.builtinDescriptorMap.values()) {
			const label = descriptor.name;
			const insertText = isReservedMemoryMapName(label) ? `${label}[]` : label;
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const baseDetail = descriptor.signature && descriptor.signature.length > 0 ? descriptor.signature : 'Lua builtin';
			const detail = descriptor.description && descriptor.description.length > 0 ? `${baseDetail} • ${descriptor.description}` : baseDetail;
			items.push({ label, insertText, sortKey: `builtin:${label.toLowerCase()}`, kind: 'builtin', detail, parameters: params });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private buildSymbolCompletionItems(entries: LuaSymbolEntry[], scope: 'local' | 'global' | 'module'): LuaCompletionItem[] {
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
			const completionKind: LuaCompletionKind = scope === 'local' ? 'local' : scope === 'module' ? 'module' : 'global';
			items.push({ label: entry.name, insertText: entry.name, sortKey, kind: completionKind, detail });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private convertDefinitionsToLocalSymbols(definitions: readonly LuaDefinitionInfo[]): LuaScopedSymbol[] {
		if (!definitions || definitions.length === 0) {
			return [];
		}
		const scopedSymbols: LuaScopedSymbol[] = [];
		for (let index = 0; index < definitions.length; index += 1) {
			const definition = definitions[index];
			const name = definition.name;
			if (!name || name.length === 0) {
				continue;
			}
			const path = definition.namePath.length > 0 ? definition.namePath.join('.') : name;
			scopedSymbols.push({
				name,
				path,
				kind: definition.kind,
				definitionRange: this.convertSourceRange(definition.definition),
				scopeRange: this.convertSourceRange(definition.scope),
			});
		}
		return scopedSymbols;
	}

	private convertSourceRange(range: LuaSourceRange): LuaDefinitionRange {
		return {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		};
	}

	private filterLocalSymbolsAtPosition(symbols: readonly LuaScopedSymbol[], lineCount: number, lastLineLength: number, row: number, column: number): LuaScopedSymbol[] {
		if (symbols.length === 0) return [];
		const row1Based = row + 1;
		const column1Based = column + 1;
		let semanticEndLine = 0;
		for (let index = 0; index < symbols.length; index += 1) {
			const scopeEndLine = symbols[index].scopeRange.endLine;
			if (scopeEndLine > semanticEndLine) {
				semanticEndLine = scopeEndLine;
			}
		}
		const documentEndLine = lineCount;
		const scopeEndExtendsToDocument = semanticEndLine < documentEndLine;
		const documentEndColumn = lastLineLength + 1;
		const selected = new Map<string, LuaScopedSymbol>();
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			if (!this.isLocalDefinitionKind(symbol.kind)) {
				continue;
			}
			const scopeRange = symbol.scopeRange;
			if (!scopeEndExtendsToDocument || scopeRange.endLine !== semanticEndLine) {
				if (!this.isPositionWithinRange(row1Based, column1Based, scopeRange)) {
					continue;
				}
			} else {
				if (row1Based < scopeRange.startLine || row1Based > documentEndLine) {
					continue;
				}
				if (row1Based === scopeRange.startLine && column1Based < scopeRange.startColumn) {
					continue;
				}
				if (row1Based === documentEndLine && column1Based > documentEndColumn) {
					continue;
				}
			}
			if (!this.isDefinitionBeforePosition(symbol.definitionRange, row1Based, column1Based)) {
				continue;
			}
			const existing = selected.get(symbol.name);
			if (!existing || this.definitionOccursAfter(symbol.definitionRange, existing.definitionRange)) {
				selected.set(symbol.name, symbol);
			}
		}
		return Array.from(selected.values());
	}

	private buildLocalCompletionItems(symbols: readonly LuaScopedSymbol[], pathLabel: string): LuaCompletionItem[] {
		const items: LuaCompletionItem[] = [];
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			const label = symbol.name;
			const kindLabel = this.formatSymbolKind(symbol.kind as LuaSymbolEntry['kind']);
			const detailParts: string[] = [kindLabel];
			if (pathLabel && pathLabel.length > 0) {
				detailParts.push(pathLabel);
			}
			detailParts.push(`line ${symbol.definitionRange.startLine}`);
			const detail = detailParts.join(' • ');
			const sortKey = `local:${symbol.definitionRange.startLine.toString().padStart(6, '0')}:${label}`;
			items.push({ label, insertText: label, sortKey, kind: 'local', detail });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private getModuleMemberCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		if (context.kind !== 'member') {
			return [];
		}
		const cached = this.ensureLocalCompletionCache();
		if (!cached || cached.moduleAliases.size === 0) {
			return [];
		}
		const moduleAlias = cached.moduleAliases.get(context.objectName);
		if (!moduleAlias) {
			return [];
		}
		let symbols: LuaSymbolEntry[] = [];
		try {
			symbols = listLuaModuleSymbols(moduleAlias.module);
		} catch {
			symbols = [];
		}
		symbols = this.filterModuleAliasSymbols(symbols, moduleAlias);
		if (!symbols || symbols.length === 0) {
			return [];
		}
		const items = this.buildSymbolCompletionItems(symbols, 'module');
		const aliasSource = this.formatModuleAliasSource(moduleAlias);
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			const detail = item.detail ? `${item.detail} • ${aliasSource}` : `module export • ${aliasSource}`;
			item.detail = detail;
		}
		return items;
	}

	private filterModuleAliasSymbols(symbols: LuaSymbolEntry[], moduleAlias: ModuleAliasEntry): LuaSymbolEntry[] {
		const memberPath = moduleAlias.memberPath ?? [];
		if (memberPath.length === 0) {
			return symbols;
		}
		const prefix = memberPath.join('.');
		const directPrefix = `${prefix}.`;
		const filtered: LuaSymbolEntry[] = [];
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index]!;
			if (this.symbolMatchesModuleAliasPath(symbol.path, prefix, directPrefix)) {
				filtered.push(symbol);
			}
		}
		return filtered;
	}

	private symbolMatchesModuleAliasPath(path: string, prefix: string, directPrefix: string): boolean {
		if (path.length <= prefix.length) {
			return false;
		}
		if (path.startsWith(directPrefix)) {
			return true;
		}
		const firstSeparator = path.indexOf('.');
		if (firstSeparator === -1 || firstSeparator + 1 >= path.length) {
			return false;
		}
		const nestedPath = path.slice(firstSeparator + 1);
		if (nestedPath.length <= prefix.length) {
			return false;
		}
		return nestedPath.startsWith(directPrefix);
	}

	private formatModuleAliasSource(moduleAlias: ModuleAliasEntry): string {
		const escaped = moduleAlias.module.replace(/'/g, "\\'");
		const memberPath = moduleAlias.memberPath ?? [];
		if (memberPath.length === 0) {
			return `require('${escaped}')`;
		}
		return `require('${escaped}').${memberPath.join('.')}`;
	}

	private isLocalDefinitionKind(kind: LuaScopedSymbol['kind']): boolean {
		return kind === 'variable' || kind === 'constant' || kind === 'function' || kind === 'parameter';
	}

	private isPositionWithinRange(row: number, column: number, range: LuaDefinitionRange): boolean {
		if (row < range.startLine || row > range.endLine) {
			return false;
		}
		if (row === range.startLine && column < range.startColumn) {
			return false;
		}
		if (row === range.endLine && column > range.endColumn) {
			return false;
		}
		return true;
	}

	private isDefinitionBeforePosition(range: LuaDefinitionRange, row: number, column: number): boolean {
		if (row < range.startLine) {
			return false;
		}
		if (row > range.endLine) {
			return true;
		}
		if (row === range.endLine) {
			return column > range.endColumn;
		}
		if (row === range.startLine) {
			return column > range.endColumn;
		}
		return true;
	}

	private definitionOccursAfter(candidate: LuaDefinitionRange, other: LuaDefinitionRange): boolean {
		if (candidate.startLine !== other.startLine) {
			return candidate.startLine > other.startLine;
		}
		if (candidate.startColumn !== other.startColumn) {
			return candidate.startColumn > other.startColumn;
		}
		if (candidate.endLine !== other.endLine) {
			return candidate.endLine > other.endLine;
		}
		return candidate.endColumn > other.endColumn;
	}

	private isIdentifierTriggerPrefix(prefix: string): boolean {
		if (prefix.length === 0) {
			return false;
		}
		return LuaLexer.isIdentifierStart(prefix.charAt(0));
	}

	private formatSymbolKind(kind: LuaSymbolEntry['kind']): string {
		switch (kind) {
			case 'function': return 'function';
			case 'variable': return 'variable';
			case 'constant': return 'constant';
			case 'parameter': return 'parameter';
			case 'table_field': return 'table field';
			case 'assignment': return 'assignment';
			default: return kind;
		}
	}

	private ensureBuiltinDescriptorCache(force = false): void {
		if (!force && this.builtinDescriptors !== null) return;
		let descriptors: LuaBuiltinDescriptor[];
		try { descriptors = listLuaBuiltinFunctions(); } catch { descriptors = []; }
		if (!Array.isArray(descriptors)) descriptors = [];
		this.builtinDescriptors = descriptors;
		this.builtinDescriptorMap.clear();
		this.sharedCompletionItems = null;
		this.sharedCompletionMap = null;
		const registerDescriptor = (descriptor: LuaBuiltinDescriptor): void => {
			if (!descriptor || typeof descriptor.name !== 'string') return;
			const normalized = descriptor.name.trim();
			if (normalized.length === 0) return;
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const signature = descriptor.signature && descriptor.signature.length > 0 ? descriptor.signature : normalized;
			const optionalParams = Array.isArray(descriptor.optionalParams) ? descriptor.optionalParams.slice() : undefined;
			const entry: LuaBuiltinDescriptor = {
				name: normalized,
				params,
				signature,
				optionalParams,
				parameterDescriptions: descriptor.parameterDescriptions ? descriptor.parameterDescriptions.slice() : undefined,
				description: descriptor.description ,
			};
			this.builtinDescriptorMap.set(normalized.toLowerCase(), entry);
		};
		for (let i = 0; i < descriptors.length; i += 1) registerDescriptor(descriptors[i]);

		// Also expose API methods as global built-ins if not already present,
		// since the runtime registers them globally too.
		for (const [name, meta] of getApiCompletionData().signatures) {
			const key = name.toLowerCase();
			if (!this.builtinDescriptorMap.has(key)) {
				const optionalParams = meta.optionalParams ?? [];
				const optionalSet = optionalParams.length > 0 ? new Set(optionalParams) : null;
				const params = Array.isArray(meta.params)
					? meta.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param))
					: [];
				const signature = meta.signature && meta.signature.length > 0 ? meta.signature : name;
				this.builtinDescriptorMap.set(key, {
					name,
					params,
					signature,
					optionalParams,
					parameterDescriptions: meta.parameterDescriptions ? meta.parameterDescriptions.slice() : undefined,
					description: meta.description ,
				});
			}
		}
	}

	private findBuiltinDescriptor(objectName: string, methodName: string): LuaBuiltinDescriptor {
		this.ensureBuiltinDescriptorCache();
		const methodKey = methodName.toLowerCase();
		if (objectName) {
			const compositeKey = `${objectName.toLowerCase()}.${methodKey}`;
			const composite = this.builtinDescriptorMap.get(compositeKey);
			if (composite) {
				return {
					name: composite.name,
					params: composite.params.slice(),
					signature: composite.signature,
					optionalParams: composite.optionalParams ? composite.optionalParams.slice() : undefined,
					description: composite.description ,
				};
			}
		}
		const direct = this.builtinDescriptorMap.get(methodKey);
		if (direct) {
			return {
				name: direct.name,
				params: direct.params.slice(),
				signature: direct.signature,
				optionalParams: direct.optionalParams ? direct.optionalParams.slice() : undefined,
				description: direct.description ,
			};
		}
		return null;
	}

	private determineAutoCompletionTrigger(context: CompletionContext, edit: EditContext): CompletionTrigger {
		if (!this.shouldAutoTrigger()) return null;
		if (!edit || edit.kind === 'delete') return null;
		if (edit.text.length === 0) return null;
		const lastChar = edit.text.charAt(edit.text.length - 1);
		if (context.kind === 'member') {
			if (lastChar === '.' || lastChar === ':') return 'punctuation';
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
			if (analyzed.prefix.length === 0 && previousChar !== '.' && previousChar !== ':' && !LuaLexer.isIdentifierPart(previousChar)) { this.closeSession(); return; }
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
		let session: CompletionSession;
		switch (context.kind) {
			case 'member':
				session = {
					context: { kind: 'member', objectName: context.objectName, operator: context.operator, prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn },
					items,
					filteredItems: [],
					selectionIndex: -1,
					displayOffset: 0,
					anchorRow: this.getCursorPosition().row,
					anchorColumn: this.getCursorPosition().column,
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
					trigger,
					navigationCaptured: trigger === 'manual',
				};
				break;
			case 'global':
				session = {
					context: { kind: 'global', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn },
					items,
					filteredItems: [],
					selectionIndex: -1,
					displayOffset: 0,
					anchorRow: this.getCursorPosition().row,
					anchorColumn: this.getCursorPosition().column,
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
					trigger,
					navigationCaptured: trigger === 'manual',
				};
				break;
			case 'local':
				session = {
					context: { kind: 'local', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn },
					items,
					filteredItems: [],
					selectionIndex: -1,
					displayOffset: 0,
					anchorRow: this.getCursorPosition().row,
					anchorColumn: this.getCursorPosition().column,
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
					trigger,
					navigationCaptured: trigger === 'manual',
				};
				break;
		}
		this.completionSession = session;
		this.applyCompletionFilter(session);
	}

	private refreshCompletionSessionFromContext(context: CompletionContext): void {
		const session = this.completionSession;
		if (!session) return;
		const items = this.collectCompletionItems(context);
		if (items.length === 0) { this.closeSession(); return; }
		switch (context.kind) {
			case 'member':
				session.context = { kind: 'member', objectName: context.objectName, operator: context.operator, prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn };
				break;
			case 'global':
				session.context = { kind: 'global', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn };
				break;
			case 'local':
				session.context = { kind: 'local', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn };
				break;
		}
		session.items = items;
		session.filterCache.clear();
		const cursor = this.getCursorPosition();
		session.anchorRow = cursor.row;
		session.anchorColumn = cursor.column;
		this.applyCompletionFilter(session);
	}

	private applyCompletionFilter(session: CompletionSession): void {
		const prefix = session.context.prefix;
		const cacheKey = prefix.toLowerCase();
		let filtered = session.filterCache.get(cacheKey);
		if (!filtered) {
			filtered = this.filterCompletionItems(session.items, prefix);
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

	private filterCompletionItems(items: LuaCompletionItem[], prefix: string): LuaCompletionItem[] {
		const lower = prefix.toLowerCase();
		const matches: Array<{ item: LuaCompletionItem; score: number; exact: boolean }> = [];
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			const labelLower = item.label.toLowerCase();
			let score: number = null;
			let exact = false;
			if (labelLower.startsWith(lower)) { score = 0; exact = labelLower === lower; }
			else if (lower.length > 0) {
				const index = labelLower.indexOf(lower);
				if (index !== -1) score = index + 10;
			}
			if (score === null) continue;
			matches.push({ item, score, exact });
		}
		if (lower.length === 0) return items.slice();
		if (matches.length === 0) return [];
		matches.sort((a, b) => {
			if (a.exact !== b.exact) return a.exact ? -1 : 1;
			if (a.score !== b.score) return a.score - b.score;
			return a.item.label.localeCompare(b.item.label);
		});
		const filtered: LuaCompletionItem[] = [];
		for (let i = 0; i < matches.length; i += 1) filtered.push(matches[i].item);
		return filtered;
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

	private handleNavigationKeys(session: CompletionSession, allowHomeEnd: boolean): boolean {
		let moved = false;
		if (this.navigationActive('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			this.moveCompletionSelection(1);
			moved = true;
		}
		if (this.navigationActive('ArrowUp')) {
			consumeIdeKey('ArrowUp');
			this.moveCompletionSelection(-1);
			moved = true;
		}
		if (this.navigationActive('PageDown')) {
			consumeIdeKey('PageDown');
			this.moveCompletionSelection(session.maxVisibleItems);
			moved = true;
		}
		if (this.navigationActive('PageUp')) {
			consumeIdeKey('PageUp');
			this.moveCompletionSelection(-session.maxVisibleItems);
			moved = true;
		}
		if (allowHomeEnd && this.navigationActive('Home')) {
			consumeIdeKey('Home');
			if (session.filteredItems.length > 0) {
				session.selectionIndex = 0;
				this.ensureCompletionSelectionVisible(session);
				session.navigationCaptured = true;
			}
			moved = true;
		}
		if (allowHomeEnd && this.navigationActive('End')) {
			consumeIdeKey('End');
			if (session.filteredItems.length > 0) {
				session.selectionIndex = session.filteredItems.length - 1;
				this.ensureCompletionSelectionVisible(session);
				session.navigationCaptured = true;
			}
			moved = true;
		}
		return moved;
	}

	private navigationActive(code: string): boolean {
		return shouldRepeatKeyFromPlayer(code);
	}

	private ensureCompletionSelectionVisible(session: CompletionSession): void {
		if (session.selectionIndex < 0) { session.displayOffset = 0; return; }
		const visible = session.maxVisibleItems;
		let offset = session.displayOffset;
		if (session.selectionIndex < offset) offset = session.selectionIndex;
		const upperBound = offset + visible - 1;
		if (session.selectionIndex > upperBound) offset = session.selectionIndex - visible + 1;
		if (offset < 0) offset = 0;
		const maxOffset = Math.max(0, session.filteredItems.length - visible);
		if (offset > maxOffset) offset = maxOffset;
		session.displayOffset = offset;
	}

	private completionContextsCompatible(expected: CompletionContext, actual: CompletionContext): boolean {
		if (expected.kind !== actual.kind) return false;
		if (expected.kind === 'member' && actual.kind === 'member') {
			if (expected.operator !== actual.operator) return false;
			if (expected.objectName.toLowerCase() !== actual.objectName.toLowerCase()) return false;
		}
		return true;
	}

	private acceptSelectedCompletion(): void {
		const session = this.completionSession;
		if (!session) return;
		if (session.filteredItems.length === 0) { this.closeSession(); return; }
		let index = session.selectionIndex;
		if (index < 0 || index >= session.filteredItems.length) index = 0;
		const item = session.filteredItems[index];
		const addParentheses = item.kind === 'api_method' || item.kind === 'native_method';
		const freshContext = this.analyzeCompletionContext();
		const effectiveContext = freshContext && this.completionContextsCompatible(session.context, freshContext) ? freshContext : session.context;
		this.applyCompletionItemForContext(effectiveContext, item, addParentheses);
		this.closeSession();
	}

	private applyCompletionItemForContext(context: CompletionContext, item: LuaCompletionItem, addParentheses: boolean): void {
		const buffer = this.getBuffer();
		const lineCount = buffer.getLineCount();
		const row = clamp(context.row, 0, Math.max(0, lineCount - 1));
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
			this.parameterHintAnchor = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const info = this.resolveParameterHintContext();
		if (!info) {
			this.parameterHint = null;
			this.parameterHintAnchor = null;
			this.parameterHintTriggerPending = false;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		if (this.parameterHintTriggerPending) {
			this.parameterHintTriggerPending = false;
			this.setParameterHintAnchor(info.anchorRow, info.anchorColumn);
			this.parameterHint = info;
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const anchor = this.parameterHintAnchor;
		if (anchor && anchor.row === info.anchorRow && anchor.column === info.anchorColumn) {
			this.parameterHint = info;
			return;
		}
		this.parameterHint = null;
		this.parameterHintAnchor = null;
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

	private resolveParameterHintContext(): ParameterHintState {
		if (!this.isCompletionReady()) return null;
		const buffer = this.getBuffer();
		const cursor = this.getCursorPosition();
		const lineCount = buffer.getLineCount();
		const safeRow = clamp(cursor.row, 0, Math.max(0, lineCount - 1));
		const line = buffer.getLineContent(safeRow);
		if (line.length === 0) return null;
		const safeColumn = clamp(cursor.column, 0, line.length);
		let depth = 0;
		let lastOpen = -1;
		for (let index = 0; index < safeColumn; index += 1) {
			const ch = line.charAt(index);
			if (ch === '(') { depth += 1; lastOpen = index; }
			else if (ch === ')') { if (depth > 0) { depth -= 1; if (depth === 0) lastOpen = -1; } }
		}
		if (depth <= 0 || lastOpen < 0) return null;
		if (isLuaCommentContext(buffer, safeRow, lastOpen)) return null;
		const prefix = line.slice(0, lastOpen);
		let scan = prefix.length - 1;
		while (scan >= 0 && LuaLexer.isWhitespace(prefix.charAt(scan))) scan -= 1;
		if (scan < 0) return null;
		let nameEnd = scan + 1;
		while (scan >= 0 && LuaLexer.isIdentifierPart(prefix.charAt(scan))) scan -= 1;
		const methodName = prefix.slice(scan + 1, nameEnd);
		if (methodName.length === 0) return null;
		const inner = line.slice(lastOpen + 1, safeColumn);
		let argumentIndex = 0;
		let nested = 0;
		for (let i = 0; i < inner.length; i += 1) {
			const ch = inner.charAt(i);
			if (ch === '(') nested += 1;
			else if (ch === ')') { if (nested > 0) nested -= 1; }
			else if (ch === ',' && nested === 0) argumentIndex += 1;
		}
		let operatorIndex = scan;
		while (operatorIndex >= 0 && LuaLexer.isWhitespace(prefix.charAt(operatorIndex))) operatorIndex -= 1;
		let objectName: string = null;
		if (operatorIndex >= 0) {
			const candidateOperator = prefix.charAt(operatorIndex);
			if (candidateOperator === '.' || candidateOperator === ':') {
				let objectEnd = operatorIndex;
				let objectIndex = objectEnd - 1;
				while (objectIndex >= 0 && LuaLexer.isWhitespace(prefix.charAt(objectIndex))) objectIndex -= 1;
				if (objectIndex >= 0) {
					let objectStart = objectIndex;
					while (objectStart >= 0 && LuaLexer.isIdentifierPart(prefix.charAt(objectStart))) objectStart -= 1;
					objectName = prefix.slice(objectStart + 1, objectIndex + 1);
				}
			}
		}

		const isApiObject = objectName !== null && objectName.toLowerCase() === 'api';
		const normalizedMethodName = methodName.toLowerCase();
		if (isApiObject) {
			const apiMeta = getApiCompletionData().signatures.get(normalizedMethodName);
			if (apiMeta) {
				const optionalSet = apiMeta.optionalParams && apiMeta.optionalParams.length > 0 ? new Set(apiMeta.optionalParams) : null;
				const params = apiMeta.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param));
				const paramDescriptions = apiMeta.parameterDescriptions ? apiMeta.parameterDescriptions.slice() : undefined;
				return {
					methodName,
					params,
					signatureLabel: apiMeta.signature,
					anchorRow: safeRow,
					anchorColumn: lastOpen,
					argumentIndex: Math.min(argumentIndex, Math.max(0, params.length - 1)),
					paramDescriptions,
					methodDescription: apiMeta.description ,
					returnType: apiMeta.returnType,
					returnDescription: apiMeta.returnDescription,
				};
			}
		}
		const builtin = this.findBuiltinDescriptor(objectName, methodName);
		if (builtin) {
			const params = Array.isArray(builtin.params) ? builtin.params.slice() : [];
			let paramDescriptions = Array.isArray(builtin.parameterDescriptions) ? builtin.parameterDescriptions.slice() : undefined;
			let methodDescription = builtin.description ;
			const apiMetaFallback = getApiCompletionData().signatures.get(normalizedMethodName);
			if ((!paramDescriptions || paramDescriptions.length === 0) || !methodDescription) {
				if (apiMetaFallback) {
					if (!paramDescriptions || paramDescriptions.length === 0) {
						paramDescriptions = apiMetaFallback.parameterDescriptions ? apiMetaFallback.parameterDescriptions.slice() : undefined;
					}
					if (!methodDescription && apiMetaFallback.description) {
						methodDescription = apiMetaFallback.description;
					}
				}
			}
			return {
				methodName: builtin.name,
				params,
				signatureLabel: builtin.signature,
				anchorRow: safeRow,
				anchorColumn: lastOpen,
				argumentIndex: Math.min(argumentIndex, Math.max(0, params.length - 1)),
				paramDescriptions,
				methodDescription,
				returnType: apiMetaFallback?.returnType,
				returnDescription: apiMetaFallback?.returnDescription,
			};
		}
		if (!objectName || isApiObject) {
			const apiMetaGlobal = getApiCompletionData().signatures.get(normalizedMethodName);
			if (apiMetaGlobal) {
				const optionalSet = apiMetaGlobal.optionalParams && apiMetaGlobal.optionalParams.length > 0 ? new Set(apiMetaGlobal.optionalParams) : null;
				const params = apiMetaGlobal.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param));
				const paramDescriptions = apiMetaGlobal.parameterDescriptions ? apiMetaGlobal.parameterDescriptions.slice() : undefined;
				return {
					methodName,
					params,
					signatureLabel: apiMetaGlobal.signature,
					anchorRow: safeRow,
					anchorColumn: lastOpen,
					argumentIndex: Math.min(argumentIndex, Math.max(0, params.length - 1)),
					paramDescriptions,
					methodDescription: apiMetaGlobal.description ,
					returnType: apiMetaGlobal.returnType,
					returnDescription: apiMetaGlobal.returnDescription,
				};
			}
		}
		return null;
	}
}
