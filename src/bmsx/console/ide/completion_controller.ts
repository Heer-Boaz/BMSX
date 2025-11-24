import { BmsxConsoleApi } from '../api';
import { clamp } from '../../utils/clamp';;
import { getApiCompletionData, getKeywordCompletions, type LuaScopedSymbol } from './intellisense';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast';
import {
	CompletionContext,
	CompletionSession,
	CompletionTrigger,
	CursorScreenInfo,
	EditContext,
	LuaCompletionItem,
	LuaCompletionKind,
	ParameterHintState,
} from './types';
import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaDefinitionRange, ConsoleLuaSymbolEntry } from '../types';
import * as constants from './constants';
import { isAltDown, isCtrlDown, isKeyJustPressed as isKeyJustPressedGlobal, isKeyPressed as isKeyPressedGlobal, isMetaDown, isShiftDown } from './input_controller';
import { isWhitespace, isWordChar } from './text_utils';
import { isLuaCommentContext } from './text_utils_local';
import { consumeIdeKey } from './player_input_adapter';
import { ide_state } from './ide_state';

type MemberCompletionHostRequest = {
	objectName: string;
	operator: '.' | ':';
	prefix: string;
	asset_id: string | null;
	chunkName: string | null;
};

export type CompletionRenderApi = BmsxConsoleApi;

export interface CompletionHost {
	// Editor state accessors
	getPlayerIndex(): number;
	isCodeTabActive(): boolean;
	getLines(): string[];
	getCursorRow(): number;
	getCursorColumn(): number;
	setCursorPosition(row: number, column: number): void;
	setSelectionAnchor(row: number, column: number): void;
	// Text operations
	replaceSelectionWith(text: string): void;
	updateDesiredColumn(): void;
	resetBlink(): void;
	revealCursor(): void;
	// Geometry/metrics
	measureText(text: string): number;
	drawText(api: CompletionRenderApi, text: string, x: number, y: number, color: number): void;
	getCursorScreenInfo(): CursorScreenInfo | null;
	getLineHeight(): number;
	getSpaceAdvance(): number;
	shouldShowParameterHints(): boolean;
	// Symbol/source helpers
	getActiveCodeTabContext(): unknown | null;
	resolveHoverasset_id(context: unknown | null): string | null;
	resolveHoverChunkName(context: unknown | null): string | null;
	listLuaSymbols(asset_id: string | null, chunkName: string | null): ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbols(): ConsoleLuaSymbolEntry[];
	listLuaModuleSymbols(moduleName: string): ConsoleLuaSymbolEntry[];
	listBuiltinLuaFunctions(): ConsoleLuaBuiltinDescriptor[];
	getSemanticDefinitions(): readonly LuaDefinitionInfo[] | null;
	getLuaModuleAliases(chunkName: string | null): Map<string, string>;
	getMemberCompletionItems(request: MemberCompletionHostRequest): LuaCompletionItem[];
	// Utilities
	charAt(row: number, column: number): string;
	getTextVersion(): number;
	shouldFireRepeat(code: string, deltaSeconds: number): boolean;
	shouldAutoTriggerCompletions(): boolean;
}

type LocalCompletionCacheEntry = {
	parsedVersion: number;
	chunkName: string | null;
	symbols: LuaScopedSymbol[];
	moduleAliases: Map<string, string>;
};

export class CompletionController {
	private readonly host: CompletionHost;

	private completionSession: CompletionSession | null = null;
	private readonly localCompletionCache: Map<string, LocalCompletionCacheEntry> = new Map();
	private cachedGlobalCompletionItems: LuaCompletionItem[] | null = null;
	private sharedCompletionItems: LuaCompletionItem[] | null = null;
	private sharedCompletionMap: Map<string, LuaCompletionItem> | null = null;
	private pendingCompletionRequest: { context: CompletionContext; trigger: CompletionTrigger; elapsed: number } | null = null;
	private suppressNextAutoCompletion = false;
	private parameterHint: ParameterHintState | null = null;
	private parameterHintAnchor: { row: number; column: number } | null = null;
	private parameterHintTriggerPending = false;
	private parameterHintIdleElapsed = 0;
	private lastCursorPosition: { row: number; column: number } | null = null;
	private lastTextVersion = -1;
	private builtinDescriptors: ConsoleLuaBuiltinDescriptor[] | null = null;
	private readonly builtinDescriptorMap: Map<string, ConsoleLuaBuiltinDescriptor> = new Map();
	private completionPopupBounds: { left: number; top: number; right: number; bottom: number } | null = null;
	private enterCommitsCompletion = false;

	constructor(host: CompletionHost) {
		this.host = host;
	}

	// Public API for editor integration
	public closeSession(): void {
		this.completionSession = null;
		this.completionPopupBounds = null;
		this.cancelPendingCompletion();
	}

	public setEnterCommitsEnabled(enabled: boolean): void {
		this.enterCommitsCompletion = enabled;
	}

	public handlePointerWheel(direction: number, steps: number, pointer: { x: number; y: number } | null): boolean {
		const session = this.completionSession;
		if (!session || session.filteredItems.length === 0) {
			return false;
		}
		if (pointer && !this.pointInCompletionPopup(pointer.x, pointer.y)) {
			return false;
		}
		const total = session.filteredItems.length;
		if (total === 0) {
			return pointer !== null;
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
		this.updateParameterHintIdle(deltaSeconds);
		const pending = this.pendingCompletionRequest;
		if (!pending) return;
		if (!this.host.isCodeTabActive()) { this.cancelPendingCompletion(); return; }
		if (!this.host.shouldAutoTriggerCompletions()) { this.cancelPendingCompletion(); return; }
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
		this.cancelPendingCompletion();
		this.parameterHint = null;
		this.parameterHintAnchor = null;
		this.parameterHintTriggerPending = false;
		this.parameterHintIdleElapsed = 0;
		this.lastCursorPosition = { row: this.host.getCursorRow(), column: this.host.getCursorColumn() };
		this.lastTextVersion = this.host.getTextVersion();
		if (this.completionSession) {
			const context = this.analyzeCompletionContext();
			if (!context) this.closeSession();
			else this.refreshCompletionSessionFromContext(context);
		}
		this.refreshParameterHint();
	}

	public updateAfterEdit(edit: EditContext | null): void {
		// Invalidate caches upon edit
		this.invalidateLocalCompletionCacheForActiveContext();
		this.cachedGlobalCompletionItems = null;
		this.sharedCompletionItems = null;
		this.sharedCompletionMap = null;
		this.parameterHintIdleElapsed = 0;
		this.lastCursorPosition = { row: this.host.getCursorRow(), column: this.host.getCursorColumn() };
		this.lastTextVersion = this.host.getTextVersion();
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

	public handleKeybindings(deltaSeconds: number): boolean {
		// Allow manual open via Ctrl/Cmd+Space
		const { ctrlDown, altDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };
		if ((ctrlDown || metaDown) && !altDown && this.completionSession === null && this.host.isCodeTabActive() && isKeyJustPressedGlobal('Space')) {
			consumeIdeKey('Space');
			const context = this.analyzeCompletionContext();
			if (context) this.openCompletionSessionFromContext(context, 'manual'); else this.closeSession();
			return true;
		}

		const session = this.completionSession;
		if (!session) return false;
		if (isKeyJustPressedGlobal('Escape')) {
			consumeIdeKey('Escape');
			this.closeSession();
			return true;
		}
		let handled = false;
		if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			this.moveCompletionSelection(1);
			handled = true;
		}
		if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			this.moveCompletionSelection(-1);
			handled = true;
		}
		if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			this.moveCompletionSelection(session.maxVisibleItems);
			handled = true;
		}
		if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			this.moveCompletionSelection(-session.maxVisibleItems);
			handled = true;
		}
		if (ctrlDown || metaDown) {
			if (ide_state.input.shouldRepeat('Home', deltaSeconds)) {
				consumeIdeKey('Home');
				if (session.filteredItems.length > 0) {
					session.selectionIndex = 0;
					this.ensureCompletionSelectionVisible(session);
				}
				handled = true;
			}
			if (ide_state.input.shouldRepeat('End', deltaSeconds)) {
				consumeIdeKey('End');
				if (session.filteredItems.length > 0) {
					session.selectionIndex = session.filteredItems.length - 1;
					this.ensureCompletionSelectionVisible(session);
				}
				handled = true;
			}
		}
		if (handled) return true;
		if (session.filteredItems.length > 0) {
			let suppressed = false;
			if (isKeyPressedGlobal('ArrowDown')) {
				consumeIdeKey('ArrowDown');
				suppressed = true;
			}
			if (isKeyPressedGlobal('ArrowUp')) {
				consumeIdeKey('ArrowUp');
				suppressed = true;
			}
			if (isKeyPressedGlobal('PageDown')) {
				consumeIdeKey('PageDown');
				suppressed = true;
			}
			if (isKeyPressedGlobal('PageUp')) {
				consumeIdeKey('PageUp');
				suppressed = true;
			}
			if (isKeyPressedGlobal('Home')) {
				consumeIdeKey('Home');
				suppressed = true;
			}
			if (isKeyPressedGlobal('End')) {
				consumeIdeKey('End');
				suppressed = true;
			}
			if (suppressed) {
				return true;
			}
		}
		if (this.enterCommitsCompletion) {
			const enterPressed = isKeyJustPressedGlobal('Enter');
			const numpadEnterPressed = isKeyJustPressedGlobal('NumpadEnter');
			if (enterPressed || numpadEnterPressed) {
				if (enterPressed) consumeIdeKey('Enter'); else consumeIdeKey('NumpadEnter');
				this.acceptSelectedCompletion();
				return true;
			}
		}
		if (isKeyJustPressedGlobal('Tab')) {
			consumeIdeKey('Tab');
			if (shiftDown) this.moveCompletionSelection(-1); else this.acceptSelectedCompletion();
			return true;
		}
		if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal('Space')) {
			consumeIdeKey('Space');
			const context = this.analyzeCompletionContext();
			if (context) this.openCompletionSessionFromContext(context, 'manual'); else this.closeSession();
			return true;
		}
		return false;
	}

	public drawCompletionPopup(api: CompletionRenderApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void {
		const session = this.completionSession;
		const cursorInfo = this.host.getCursorScreenInfo();
		this.completionPopupBounds = null;
		if (!session || !cursorInfo) return;
		if (session.filteredItems.length === 0) return;
		const startIndex = session.displayOffset;
		const endIndex = Math.min(session.filteredItems.length, startIndex + session.maxVisibleItems);
		const visibleCount = endIndex - startIndex;
		if (visibleCount <= 0) return;
		let maxLineWidth = constants.COMPLETION_POPUP_MIN_WIDTH;
		const detailSpacing = this.host.getSpaceAdvance();
		for (let i = 0; i < session.filteredItems.length; i += 1) {
			const item = session.filteredItems[i];
			const labelWidth = this.host.measureText(item.label);
			const detailText = item.detail ?? '';
			const detailWidth = detailText.length > 0 ? this.host.measureText(detailText) : 0;
			const totalWidth = detailWidth > 0 ? labelWidth + detailSpacing + detailWidth : labelWidth;
			if (totalWidth > maxLineWidth) maxLineWidth = totalWidth;
		}
		const popupWidth = Math.max(constants.COMPLETION_POPUP_MIN_WIDTH, Math.floor(maxLineWidth + constants.COMPLETION_POPUP_PADDING_X * 2));
		const popupHeight = Math.floor(constants.COMPLETION_POPUP_PADDING_Y * 2 + visibleCount * this.host.getLineHeight() + Math.max(0, visibleCount - 1) * constants.COMPLETION_POPUP_ITEM_SPACING);
		let popupLeft = Math.floor(cursorInfo.x);
		if (popupLeft + popupWidth > bounds.codeRight) popupLeft = bounds.codeRight - popupWidth;
		if (popupLeft < bounds.textLeft) popupLeft = bounds.textLeft;
		let popupTop = Math.floor(cursorInfo.y + cursorInfo.height + 2);
		if (popupTop + popupHeight > bounds.codeBottom) popupTop = Math.floor(cursorInfo.y - popupHeight - 2);
		if (popupTop < bounds.codeTop) {
			popupTop = bounds.codeTop;
			if (popupTop + popupHeight > bounds.codeBottom) popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
		}
		const popupRight = popupLeft + popupWidth;
		const popupBottom = popupTop + popupHeight;
		api.rectfill(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_COMPLETION_BACKGROUND);
		api.rect(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_COMPLETION_BORDER);
		this.completionPopupBounds = { left: popupLeft, top: popupTop, right: popupRight, bottom: popupBottom };
		for (let drawIndex = 0; drawIndex < visibleCount; drawIndex += 1) {
			const itemIndex = startIndex + drawIndex;
			const item = session.filteredItems[itemIndex];
			const lineTop = popupTop + constants.COMPLETION_POPUP_PADDING_Y + drawIndex * (this.host.getLineHeight() + constants.COMPLETION_POPUP_ITEM_SPACING);
			const isSelected = itemIndex === session.selectionIndex;
			const labelColor = isSelected ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_TEXT;
			const detailColor = isSelected ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_DETAIL;
			if (isSelected) {
				const highlightTop = lineTop - 1;
				const highlightBottom = highlightTop + this.host.getLineHeight() + 2;
				api.rectfill(popupLeft + 1, highlightTop, popupRight - 1, highlightBottom, constants.COLOR_COMPLETION_HIGHLIGHT);
			}
			let textX = popupLeft + constants.COMPLETION_POPUP_PADDING_X;
			const labelWidth = this.host.measureText(item.label);
			this.host.drawText(api, item.label, textX, lineTop, labelColor);
			textX += labelWidth + detailSpacing;
			const detailText = item.detail ?? '';
			if (detailText.length > 0) {
				this.host.drawText(api, detailText, textX, lineTop, detailColor);
			}
		}
	}

	public drawParameterHintOverlay(api: CompletionRenderApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void {
		const hint = this.parameterHint;
		const cursorInfo = this.host.getCursorScreenInfo();
		if (!hint || !cursorInfo) return;
		const params = hint.params;
		const baseColor = constants.COLOR_PARAMETER_HINT_TEXT;
		const segments: Array<{ text: string; color: number }> = [];
		segments.push({ text: `${hint.methodName}(`, color: baseColor });
		for (let i = 0; i < params.length; i += 1) {
			if (i > 0) segments.push({ text: ', ', color: baseColor });
			const color = i === hint.argumentIndex ? constants.COLOR_PARAMETER_HINT_ACTIVE : baseColor;
			segments.push({ text: params[i], color });
		}
		segments.push({ text: ')', color: baseColor });
		let firstLineWidth = 0;
		for (let i = 0; i < segments.length; i += 1) {
			const part = segments[i];
			if (part.text.length === 0) continue;
			firstLineWidth += this.host.measureText(part.text);
		}
		const methodDescription = hint.methodDescription && hint.methodDescription.length > 0 ? hint.methodDescription : null;
		const activeParamDescription = hint.paramDescriptions && hint.argumentIndex < hint.paramDescriptions.length
			? hint.paramDescriptions[hint.argumentIndex] ?? null
			: null;
		const descriptionLines: Array<{ text: string; color: number }> = [];
		if (methodDescription) {
			descriptionLines.push({ text: methodDescription, color: baseColor });
		}
		if (activeParamDescription && activeParamDescription.length > 0) {
			descriptionLines.push({ text: activeParamDescription, color: constants.COLOR_PARAMETER_HINT_ACTIVE });
		}
		let maxLineWidth = firstLineWidth;
		for (let i = 0; i < descriptionLines.length; i += 1) {
			const width = this.host.measureText(descriptionLines[i].text);
			if (width > maxLineWidth) {
				maxLineWidth = width;
			}
		}
		const lineHeight = this.host.getLineHeight();
		const lineSpacing = 2;
		const totalLines = 1 + descriptionLines.length;
		const popupWidth = maxLineWidth + constants.PARAMETER_HINT_PADDING_X * 2;
		const popupHeight = Math.floor(totalLines * lineHeight + constants.PARAMETER_HINT_PADDING_Y * 2 + Math.max(0, totalLines - 1) * lineSpacing);
		let popupLeft = cursorInfo.x;
		if (popupLeft + popupWidth > bounds.codeRight) popupLeft = bounds.codeRight - popupWidth;
		if (popupLeft < bounds.textLeft) popupLeft = bounds.textLeft;
		let popupTop = cursorInfo.y - popupHeight - 2;
		if (popupTop < bounds.codeTop) {
			popupTop = cursorInfo.y + cursorInfo.height + 2;
			if (popupTop + popupHeight > bounds.codeBottom) popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
		}
		const popupRight = popupLeft + popupWidth;
		const popupBottom = popupTop + popupHeight;
		api.rect(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_PARAMETER_HINT_BORDER);
		api.rectfill(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_PARAMETER_HINT_BACKGROUND);
		let textX = popupLeft + constants.PARAMETER_HINT_PADDING_X;
		let currentY = popupTop + constants.PARAMETER_HINT_PADDING_Y;
		for (let i = 0; i < segments.length; i += 1) {
			const part = segments[i];
			if (part.text.length === 0) continue;
			this.host.drawText(api, part.text, textX, currentY, part.color);
			textX += this.host.measureText(part.text);
		}
		for (let i = 0; i < descriptionLines.length; i += 1) {
			const line = descriptionLines[i];
			currentY += lineHeight + lineSpacing;
			this.host.drawText(api, line.text, popupLeft + constants.PARAMETER_HINT_PADDING_X, currentY, line.color);
		}
	}

	// Internal helpers and logic
	private analyzeCompletionContext(): CompletionContext | null {
		if (!this.host.isCodeTabActive()) return null;
		const lines = this.host.getLines();
		if (lines.length === 0) return null;
		const row = clamp(this.host.getCursorRow(), 0, lines.length - 1);
		const line = lines[row];
		const column = clamp(this.host.getCursorColumn(), 0, line.length);
		let start = column;
		while (start > 0 && isWordChar(line.charAt(start - 1))) start -= 1;
		const prefix = line.slice(start, column);
		const replaceFromColumn = start;
		const replaceToColumn = column;
		if (isLuaCommentContext(lines, row, replaceFromColumn)) {
			return null;
		}
		let probe = start - 1;
		while (probe >= 0 && isWhitespace(line.charAt(probe))) probe -= 1;
		if (probe >= 0) {
			const operator = line.charAt(probe);
			if (operator === '.' || operator === ':') {
				let objectEnd = probe;
				let objectProbe = objectEnd - 1;
				while (objectProbe >= 0 && isWhitespace(line.charAt(objectProbe))) objectProbe -= 1;
				if (objectProbe < 0) return null;
				let objectStart = objectProbe;
				while (objectStart >= 0 && isWordChar(line.charAt(objectStart))) objectStart -= 1;
				const objectName = line.slice(objectStart + 1, objectProbe + 1);
				if (objectName.length === 0) return null;
				return { kind: 'member', objectName, operator: operator as '.' | ':', prefix, row, replaceFromColumn, replaceToColumn };
			}
		}
		return { kind: 'global', prefix, row, replaceFromColumn, replaceToColumn };
	}

	private getSharedCompletionEntries(): { list: LuaCompletionItem[]; map: Map<string, LuaCompletionItem> } {
		if (!this.sharedCompletionItems || !this.sharedCompletionMap) {
			const map = new Map<string, LuaCompletionItem>();
			const register = (item: LuaCompletionItem): void => {
				if (!map.has(item.sortKey)) {
					map.set(item.sortKey, item);
				}
			};
			for (let i = 0; i < getKeywordCompletions().length; i += 1) {
				register(getKeywordCompletions()[i]);
			}
			const globalItems = this.getGlobalCompletionItems();
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
			const appendItems = (items: LuaCompletionItem[] | undefined | null): void => {
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
			const activeContext = this.host.getActiveCodeTabContext();
			const asset_id = this.host.resolveHoverasset_id(activeContext);
			const chunkName = this.host.resolveHoverChunkName(activeContext);
			const runtimeItems = this.host.getMemberCompletionItems({
				objectName: context.objectName,
				operator: context.operator,
				prefix: context.prefix,
				asset_id,
				chunkName,
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
		const filtered = this.filterLocalSymbolsAtPosition(cached.symbols, context.row, column);
		if (filtered.length === 0) {
			return [];
		}
		const activeCodeContext = this.host.getActiveCodeTabContext();
		const chunkName = cached.chunkName ?? this.host.resolveHoverChunkName(activeCodeContext);
		return this.buildLocalCompletionItems(filtered, chunkName ?? null);
	}

	private ensureLocalCompletionCache(): LocalCompletionCacheEntry | null {
		const key = this.activeCompletionCacheKey();
		if (!key) return null;
		const activeCodeContext = this.host.getActiveCodeTabContext();
		const chunkName = this.host.resolveHoverChunkName(activeCodeContext);
		const currentVersion = this.host.getTextVersion();
		let cached = this.localCompletionCache.get(key) ?? null;
		const needsParse = !cached || cached.chunkName !== chunkName || cached.parsedVersion !== currentVersion;
		if (needsParse) {
			const definitions = this.host.getSemanticDefinitions();
			const symbols = definitions && definitions.length > 0 ? this.convertDefinitionsToLocalSymbols(definitions) : [];
			const moduleAliases = this.host.getLuaModuleAliases(chunkName ?? null);
			cached = {
				parsedVersion: currentVersion,
				chunkName,
				symbols,
				moduleAliases: new Map(moduleAliases),
			};
			this.localCompletionCache.set(key, cached);
		}
		return cached ?? null;
	}

	private getGlobalCompletionItems(): LuaCompletionItem[] {
		if (this.cachedGlobalCompletionItems) return this.cachedGlobalCompletionItems;
		let entries: ConsoleLuaSymbolEntry[] = [];
		try { entries = this.host.listGlobalLuaSymbols(); } catch { this.cachedGlobalCompletionItems = []; return this.cachedGlobalCompletionItems; }
		const items = this.buildSymbolCompletionItems(entries, 'global');
		const apiItem: LuaCompletionItem = { label: 'api', insertText: 'api', sortKey: 'global:api', kind: 'global', detail: 'Console API root' };
		items.push(apiItem);
		items.sort((a, b) => a.label.localeCompare(b.label));
		this.cachedGlobalCompletionItems = items;
		return items;
	}

	private getBuiltinCompletionItems(): LuaCompletionItem[] {
		this.ensureBuiltinDescriptorCache();
		const items: LuaCompletionItem[] = [];
		for (const descriptor of this.builtinDescriptorMap.values()) {
			const label = descriptor.name;
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const baseDetail = descriptor.signature && descriptor.signature.length > 0 ? descriptor.signature : 'Lua builtin';
			const detail = descriptor.description && descriptor.description.length > 0 ? `${baseDetail} • ${descriptor.description}` : baseDetail;
			items.push({ label, insertText: label, sortKey: `builtin:${label.toLowerCase()}`, kind: 'builtin', detail, parameters: params });
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private buildSymbolCompletionItems(entries: ConsoleLuaSymbolEntry[], scope: 'local' | 'global' | 'module'): LuaCompletionItem[] {
		if (entries.length === 0) return [];
		const items: LuaCompletionItem[] = [];
		for (let i = 0; i < entries.length; i += 1) {
			const entry = entries[i];
			const origin = (() => {
				if (entry.location.path && entry.location.path.length > 0) return entry.location.path;
				if (entry.location.asset_id && entry.location.asset_id.length > 0) return entry.location.asset_id;
				if (entry.location.chunkName && entry.location.chunkName.length > 0) return entry.location.chunkName;
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

	private convertSourceRange(range: LuaSourceRange): ConsoleLuaDefinitionRange {
		return {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		};
	}

	private filterLocalSymbolsAtPosition(symbols: readonly LuaScopedSymbol[], row: number, column: number): LuaScopedSymbol[] {
		if (symbols.length === 0) return [];
		const row1Based = row + 1;
		const column1Based = column + 1;
		const selected = new Map<string, LuaScopedSymbol>();
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			if (!this.isLocalDefinitionKind(symbol.kind)) {
				continue;
			}
			if (!this.isPositionWithinRange(row1Based, column1Based, symbol.scopeRange)) {
				continue;
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

	private buildLocalCompletionItems(symbols: readonly LuaScopedSymbol[], chunkLabel: string | null): LuaCompletionItem[] {
		const items: LuaCompletionItem[] = [];
		for (let index = 0; index < symbols.length; index += 1) {
			const symbol = symbols[index];
			const label = symbol.name;
			const kindLabel = this.formatSymbolKind(symbol.kind as ConsoleLuaSymbolEntry['kind']);
			const detailParts: string[] = [kindLabel];
			if (chunkLabel && chunkLabel.length > 0) {
				detailParts.push(chunkLabel);
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
		const moduleName = cached.moduleAliases.get(context.objectName);
		if (!moduleName) {
			return [];
		}
		let symbols: ConsoleLuaSymbolEntry[] = [];
		try {
			symbols = this.host.listLuaModuleSymbols(moduleName);
		} catch {
			symbols = [];
		}
		if (!symbols || symbols.length === 0) {
			return [];
		}
		const items = this.buildSymbolCompletionItems(symbols, 'module');
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			const escaped = moduleName.replace(/'/g, "\\'");
			const detail = item.detail ? `${item.detail} • require('${escaped}')` : `module export • require('${escaped}')`;
			item.detail = detail;
		}
		return items;
	}

	private isLocalDefinitionKind(kind: LuaScopedSymbol['kind']): boolean {
		return kind === 'variable' || kind === 'function' || kind === 'parameter';
	}

	private isPositionWithinRange(row: number, column: number, range: ConsoleLuaDefinitionRange): boolean {
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

	private isDefinitionBeforePosition(range: ConsoleLuaDefinitionRange, row: number, column: number): boolean {
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

	private definitionOccursAfter(candidate: ConsoleLuaDefinitionRange, other: ConsoleLuaDefinitionRange): boolean {
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
		const code = prefix.charCodeAt(0);
		return this.isIdentifierStartChar(code);
	}

	private isIdentifierStartChar(code: number): boolean {
		return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
	}

	private pointInCompletionPopup(x: number, y: number): boolean {
		const bounds = this.completionPopupBounds;
		if (!bounds) {
			return false;
		}
		return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
	}

	private formatSymbolKind(kind: ConsoleLuaSymbolEntry['kind']): string {
		switch (kind) {
			case 'function': return 'function';
			case 'variable': return 'variable';
			case 'parameter': return 'parameter';
			case 'table_field': return 'table field';
			case 'assignment': return 'assignment';
			default: return kind;
		}
	}

	private ensureBuiltinDescriptorCache(force = false): void {
		if (!force && this.builtinDescriptors !== null) return;
		let descriptors: ConsoleLuaBuiltinDescriptor[];
		try { descriptors = this.host.listBuiltinLuaFunctions(); } catch { descriptors = []; }
		if (!Array.isArray(descriptors)) descriptors = [];
		this.builtinDescriptors = descriptors;
		this.builtinDescriptorMap.clear();
		this.sharedCompletionItems = null;
		this.sharedCompletionMap = null;
		const registerDescriptor = (descriptor: ConsoleLuaBuiltinDescriptor): void => {
			if (!descriptor || typeof descriptor.name !== 'string') return;
			const normalized = descriptor.name.trim();
			if (normalized.length === 0) return;
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const signature = descriptor.signature && descriptor.signature.length > 0 ? descriptor.signature : normalized;
			const optionalParams = Array.isArray(descriptor.optionalParams) ? descriptor.optionalParams.slice() : undefined;
			const entry: ConsoleLuaBuiltinDescriptor = {
				name: normalized,
				params,
				signature,
				optionalParams,
				parameterDescriptions: descriptor.parameterDescriptions ? descriptor.parameterDescriptions.slice() : undefined,
				description: descriptor.description ?? null,
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
					description: meta.description ?? null,
				});
			}
		}
	}

	private findBuiltinDescriptor(objectName: string | null, methodName: string): ConsoleLuaBuiltinDescriptor | null {
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
					description: composite.description ?? null,
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
				description: direct.description ?? null,
			};
		}
		return null;
	}

	private determineAutoCompletionTrigger(context: CompletionContext, edit: EditContext): CompletionTrigger | null {
		if (!this.host.shouldAutoTriggerCompletions()) return null;
		if (!edit || edit.kind === 'delete') return null;
		if (edit.text.length === 0) return null;
		const lastChar = edit.text.charAt(edit.text.length - 1);
		if (context.kind === 'member') {
			if (lastChar === '.' || lastChar === ':') return 'punctuation';
			if (!isWordChar(lastChar)) return null;
			return context.prefix.length === 0 ? null : 'typing';
		}
		if (!isWordChar(lastChar)) return null;
		if (!this.isIdentifierTriggerPrefix(context.prefix)) return null;
		return 'typing';
	}

	private updateCompletionSessionAfterMutation(edit: EditContext | null): void {
		if (!this.host.isCodeTabActive()) { this.closeSession(); return; }
		const analyzed = this.analyzeCompletionContext();
		if (this.completionSession) {
			this.cancelPendingCompletion();
			if (!analyzed) { this.closeSession(); return; }
			const previousChar = this.host.charAt(this.host.getCursorRow(), this.host.getCursorColumn() - 1);
			if (analyzed.prefix.length === 0 && previousChar !== '.' && previousChar !== ':' && !isWordChar(previousChar)) { this.closeSession(); return; }
			this.refreshCompletionSessionFromContext(analyzed);
			return;
		}
		if (!edit || !analyzed) { this.cancelPendingCompletion(); return; }
		if (!this.host.shouldAutoTriggerCompletions()) { this.cancelPendingCompletion(); return; }
		const trigger = this.determineAutoCompletionTrigger(analyzed, edit);
		if (!trigger) { this.cancelPendingCompletion(); return; }
		this.pendingCompletionRequest = { context: analyzed, trigger, elapsed: 0 };
	}

	private openCompletionSessionFromContext(context: CompletionContext, _trigger: CompletionTrigger): void {
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
					anchorRow: this.host.getCursorRow(),
					anchorColumn: this.host.getCursorColumn(),
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
				};
				break;
			case 'global':
				session = {
					context: { kind: 'global', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn },
					items,
					filteredItems: [],
					selectionIndex: -1,
					displayOffset: 0,
					anchorRow: this.host.getCursorRow(),
					anchorColumn: this.host.getCursorColumn(),
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
				};
				break;
			case 'local':
				session = {
					context: { kind: 'local', prefix: context.prefix, row: context.row, replaceFromColumn: context.replaceFromColumn, replaceToColumn: context.replaceToColumn },
					items,
					filteredItems: [],
					selectionIndex: -1,
					displayOffset: 0,
					anchorRow: this.host.getCursorRow(),
					anchorColumn: this.host.getCursorColumn(),
					maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
					filterCache: new Map(),
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
		session.anchorRow = this.host.getCursorRow();
		session.anchorColumn = this.host.getCursorColumn();
		this.applyCompletionFilter(session);
	}

	private applyCompletionFilter(session: CompletionSession): void {
		const prefix = session.context.prefix;
		const cacheKey = prefix.toLowerCase();
		let filtered = session.filterCache.get(cacheKey) ?? null;
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
			let score: number | null = null;
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
		let index = session.selectionIndex;
		if (index < 0) index = delta > 0 ? 0 : total - 1; else { index += delta; index = ((index % total) + total) % total; }
		session.selectionIndex = index;
		this.ensureCompletionSelectionVisible(session);
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
		const lines = this.host.getLines();
		const row = clamp(context.row, 0, Math.max(0, lines.length - 1));
		const line = lines[row] ?? '';
		const replaceStart = clamp(context.replaceFromColumn, 0, line.length);
		const replaceEnd = clamp(context.replaceToColumn, replaceStart, line.length);
		this.host.setCursorPosition(row, replaceEnd);
		this.host.setSelectionAnchor(row, replaceStart);
		this.suppressNextAutoCompletion = true;
		let insertion = item.insertText;
		if (addParentheses) insertion = `${item.insertText}()`;
		this.host.replaceSelectionWith(insertion);
		if (addParentheses) {
			this.host.setCursorPosition(row, replaceStart + item.insertText.length + 1);
		} else {
			this.host.setCursorPosition(row, replaceStart + insertion.length);
		}
		this.host.updateDesiredColumn();
		this.host.resetBlink();
		this.host.revealCursor();
	}

	private cancelPendingCompletion(): void {
		this.pendingCompletionRequest = null;
	}

	private refreshParameterHint(): void {
		if (!this.host.shouldShowParameterHints()) {
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
			this.parameterHintAnchor = { row: info.anchorRow, column: info.anchorColumn };
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
		if (!this.host.shouldShowParameterHints()) {
			this.parameterHintIdleElapsed = 0;
			return;
		}
		const currentRow = this.host.getCursorRow();
		const currentColumn = this.host.getCursorColumn();
		const currentVersion = this.host.getTextVersion();
		const last = this.lastCursorPosition;
		if (!last || last.row !== currentRow || last.column !== currentColumn || this.lastTextVersion !== currentVersion) {
			this.lastCursorPosition = { row: currentRow, column: currentColumn };
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

	private resolveParameterHintContext(): ParameterHintState | null {
		if (!this.host.isCodeTabActive()) return null;
		const lines = this.host.getLines();
		if (lines.length === 0) return null;
		const safeRow = clamp(this.host.getCursorRow(), 0, lines.length - 1);
		const line = lines[safeRow];
		if (line.length === 0) return null;
		const safeColumn = clamp(this.host.getCursorColumn(), 0, line.length);
		let depth = 0;
		let lastOpen = -1;
		for (let index = 0; index < safeColumn; index += 1) {
			const ch = line.charAt(index);
			if (ch === '(') { depth += 1; lastOpen = index; }
			else if (ch === ')') { if (depth > 0) { depth -= 1; if (depth === 0) lastOpen = -1; } }
		}
		if (depth <= 0 || lastOpen < 0) return null;
		if (isLuaCommentContext(lines, safeRow, lastOpen)) return null;
		const prefix = line.slice(0, lastOpen);
		let scan = prefix.length - 1;
		while (scan >= 0 && isWhitespace(prefix.charAt(scan))) scan -= 1;
		if (scan < 0) return null;
		let nameEnd = scan + 1;
		while (scan >= 0 && isWordChar(prefix.charAt(scan))) scan -= 1;
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
		while (operatorIndex >= 0 && isWhitespace(prefix.charAt(operatorIndex))) operatorIndex -= 1;
		let objectName: string | null = null;
		if (operatorIndex >= 0) {
			const candidateOperator = prefix.charAt(operatorIndex);
			if (candidateOperator === '.' || candidateOperator === ':') {
				let objectEnd = operatorIndex;
				let objectIndex = objectEnd - 1;
				while (objectIndex >= 0 && isWhitespace(prefix.charAt(objectIndex))) objectIndex -= 1;
				if (objectIndex >= 0) {
					let objectStart = objectIndex;
					while (objectStart >= 0 && isWordChar(prefix.charAt(objectStart))) objectStart -= 1;
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
					methodDescription: apiMeta.description ?? null,
				};
			}
		}
		const builtin = this.findBuiltinDescriptor(objectName, methodName);
		if (builtin) {
			const params = Array.isArray(builtin.params) ? builtin.params.slice() : [];
			let paramDescriptions = Array.isArray(builtin.parameterDescriptions) ? builtin.parameterDescriptions.slice() : undefined;
			let methodDescription = builtin.description ?? null;
			if ((!paramDescriptions || paramDescriptions.length === 0) || !methodDescription) {
				const apiMetaFallback = getApiCompletionData().signatures.get(normalizedMethodName);
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
					methodDescription: apiMetaGlobal.description ?? null,
				};
			}
		}
		return null;
	}

	private activeCompletionCacheKey(): string | null {
		const context = this.host.getActiveCodeTabContext();
		const asset_id = this.host.resolveHoverasset_id(context);
		const chunkName = this.host.resolveHoverChunkName(context);
		if (asset_id || chunkName) {
			const safeasset_id = asset_id ?? '';
			const safeChunk = chunkName ?? '';
			return `${safeasset_id}|${safeChunk}`;
		}
		let contextId = '';
		if (context && typeof context === 'object') {
			const candidate = (context as { id?: unknown }).id;
			if (candidate !== undefined && candidate !== null) {
				contextId = String(candidate);
			}
		}
		if (contextId.length > 0) {
			return `ctx:${contextId}`;
		}
		return `player:${this.host.getPlayerIndex()}`;
	}

	private invalidateLocalCompletionCacheForActiveContext(): void {
		const key = this.activeCompletionCacheKey();
		if (!key) return;
		const cached = this.localCompletionCache.get(key);
		if (cached) {
			cached.parsedVersion = -1;
			return;
		}
		this.localCompletionCache.delete(key);
	}
}
