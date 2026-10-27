import { KeyModifier } from '../../../hosts/common/input/text';
import { copyPointerSnapshot } from '../../input/pointer/frame';
import { CodeEditorTextInput } from '../input/native_text';
import { RuntimeErrorOverlayPointer } from '../contrib/runtime_error/pointer';
import { advanceToggleBlink, resetBlinkState } from './view/caret/blink';
import { CODE_AREA_RIGHT_MARGIN, CURSOR_BLINK_INTERVAL, SCROLLBAR_WIDTH } from '../../common/constants';
import type { HostClock } from '../../../hosts/common/clock';
import { create_rect_bounds, copy_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { clamp } from '../../../machine/ts/common/clamp';
import { inputFocus, InputFocusScope } from '../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../input/pointer/capture';
import type { EditContext, PointerSnapshot, PointerInputSnapshot, VisualLineSegment } from '../../common/models';
import { TAB_SPACES } from '../../common/constants';
import type { InlineFieldMetrics } from './inline/text_field';
import type { EditorTextModel } from '../model/text_model';
import { Scrollbar } from '../../workbench/ui/scrollbar';
import { ScrollbarController } from '../../workbench/ui/scrollbar_controller';
import { ensureVisualLines } from '../common/text/layout';
import { ReferenceState } from '../contrib/references/state';
import type { RuntimeErrorOverlay } from '../contrib/runtime_error/model';
import type { GotoHoverHighlight } from '../contrib/intellisense/ui_state';
import type { CodeHoverTooltip } from '../contrib/hover/state';
import { CodeLayout } from './code/layout';
import type { CodeDocumentProjection } from './code/document_projection';
import type { EditorFont } from './view/font';
import type { CodeEditorViewState, InlineEditState, VisualCursor } from './code_editor_state';
import { computeWrapWidth, getCodeAreaBounds, measureGutterWidth } from './view/view';
import { handleCodeAreaSelectionPointer } from '../../input/pointer/code/selection';
import { CodeRowDecorations } from '../render/code_area/decorations';
import { CompletionRenderState } from '../render/completion';

/** A concrete attached Source control. Model/history ownership remains with the working copy. */
export class CodeEditorControl implements PointerCaptureTarget {
	public readonly focusTarget;
	public readonly nativeText = new CodeEditorTextInput(this);
	public readonly runtimeErrorPointer = new RuntimeErrorOverlayPointer(this);
	public readonly nativeCaret = { x: 0, y: 0, width: 0, height: 0 };
	public readonly inlineFieldMetrics: InlineFieldMetrics = {
		advanceChar: char => this.font.advance(char), spaceAdvance: 0, tabSpaces: TAB_SPACES,
	};
	public readonly caret = { blinkTimer: 0, cursorVisible: true, cursorRevealSuspended: false };
	public readonly pointer = {
		lastPointerSnapshot: null as PointerInputSnapshot | null,
		selectionSnapshot: { viewportX: 0, viewportY: 0, insideViewport: false, valid: false,
			pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 } as PointerSnapshot,
		pointerSelecting: false, lastPointerClickTimeMs: 0, lastPointerClickRow: -1, lastPointerClickColumn: -1,
		lastPointerRowResolution: null as { visualIndex: number; segment: VisualLineSegment },
	};
	public readonly geometry = {
		clientBounds: create_rect_bounds(),
		presentedBounds: create_rect_bounds(),
		codeVerticalScrollbarVisible: false, codeHorizontalScrollbarVisible: false,
		cachedVisibleRowCount: 1, cachedContentWidth: 1, cachedMaxScrollLeft: 0,
	};
	public readonly scratch = {
		contextMenuAnchor: create_rect_bounds(),
		gutterFont: undefined as EditorFont | undefined, gutterLineCount: -1, measuredGutterWidth: 0,
		codeAreaBounds: { codeTop: 0, codeBottom: 0, codeLeft: 0, codeRight: 0, gutterLeft: 0, gutterRight: 0, textLeft: 0 },
		pointerTextPosition: { row: 0, column: 0, injected: false },
		pointerRowResolution: { visualIndex: 0, segment: null as VisualLineSegment },
		viewportMetrics: { rows: 1, contentWidth: 1, visualCount: 0, contentRight: 0, contentBottom: 0, trackRight: 0, wrapEnabled: false, maxScrollLeft: 0 },
		viewport: { codeTop: 0, codeBottom: 0, codeLeft: 0, codeRight: 0, gutterLeft: 0, gutterRight: 0, textLeft: 0,
			rows: 1, contentWidth: 1, visualCount: 0, contentRight: 0, contentBottom: 0, trackRight: 0, wrapEnabled: false, maxScrollLeft: 0 },
		cursorScreenInfo: { row: 0, column: 0, x: 0, y: 0, width: 0, height: 0, baseChar: ' ', baseColor: 0 },
		editPosition: { row: 0, column: 0 }, wordPosition: { row: 0, column: 0 },
		rowDecorations: new CodeRowDecorations(), verticalTrack: create_rect_bounds(), horizontalTrack: create_rect_bounds(),
		runtimeErrorHighlightLines: [] as number[],
	};
	public readonly scrollbars = { codeVertical: new Scrollbar('vertical'), codeHorizontal: new Scrollbar('horizontal') };
	public readonly scrollbarController = new ScrollbarController<'codeVertical' | 'codeHorizontal'>(this.scrollbars, (kind, scroll) => {
		if (kind === 'codeVertical') {
			ensureVisualLines(this);
			this.setScrollPosition(this.layout.clampVisualScroll(scroll, this.layout.getVisualLineCount(), this.geometry.cachedVisibleRowCount), this.view.scrollLeft);
		} else this.setScrollPosition(this.view.scrollRow, this.view.wordWrapEnabled ? 0 : this.layout.clampHorizontalScroll(scroll, this.geometry.cachedMaxScrollLeft));
		this.caret.cursorRevealSuspended = true;
	}, pointerCapture);
	public readonly runtimeError = { activeOverlay: null as RuntimeErrorOverlay, executionStopRow: null as number };
	public gotoHoverHighlight: GotoHoverHighlight | null = null;
	public hoverTooltip: CodeHoverTooltip | null = null;
	public readonly references = new ReferenceState();
	public model: EditorTextModel | null = null;
	public view: CodeEditorViewState | null = null;
	public font: EditorFont;
	public lineHeight: number;
	public charAdvance: number;
	public spaceAdvance: number;
	public layout: CodeLayout;
	public completionRender: CompletionRenderState;
	public pendingEditContext: EditContext | null = null;
	private readonly inlineEditValue = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	public get inlineEdit(): InlineEditState { return this.inlineEditValue; }
	private readonly visualCursorValue = { row: 0, column: 0, visualIndex: 0 };
	private visualCursorOverride: VisualCursor | null = null;
	private readonly cursorMovedListeners = new Set<() => void>();
	private readonly viewChangeListeners = new Set<() => void>();
	private readonly pointerInput: PointerInputSnapshot = {
		viewportX: 0, viewportY: 0, insideViewport: false, valid: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false,
	};
	private unbindModelChange: (() => void) | undefined;
	private unbindModelDisposal: (() => void) | undefined;
	private readonly unbindFocus: () => void;

	public constructor(scope: InputFocusScope, font: EditorFont, public readonly clock: HostClock) {
		this.focusTarget = inputFocus.createTarget(null, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.textInput = this.nativeText;
		this.focusTarget.canFocus = () => this.model !== null
			&& this.geometry.presentedBounds.left < this.geometry.presentedBounds.right
			&& this.geometry.presentedBounds.top < this.geometry.presentedBounds.bottom;
		this.unbindFocus = this.focusTarget.onDidFocus(() => resetBlinkState(this.caret));
		this.completionRender = new CompletionRenderState(font);
		this.font = font; this.lineHeight = font.lineHeight; this.charAdvance = font.advance('M'); this.spaceAdvance = font.advance(' ');
		this.inlineFieldMetrics.spaceAdvance = this.spaceAdvance;
		this.layout = new CodeLayout(font, { inlineEdit: this.inlineEdit, computeWrapWidth: () => computeWrapWidth(this) });
	}

	public get visualCursor(): VisualCursor | null {
		const value = this.visualCursorOverride;
		return value !== null && value.row === this.view.cursorRow && value.column === this.view.cursorColumn ? value : null;
	}
	public get minimumWidth(): number { return measureGutterWidth(this) + 2 + this.charAdvance + SCROLLBAR_WIDTH + CODE_AREA_RIGHT_MARGIN; }
	public get minimumHeight(): number { return this.lineHeight + (this.view.wordWrapEnabled ? 0 : SCROLLBAR_WIDTH); }

	public setFont(font: EditorFont): void {
		if (this.font === font) return;
		const document = this.layout.document;
		this.layout.dispose();
		this.completionRender = new CompletionRenderState(font);
		this.font = font; this.lineHeight = font.lineHeight; this.charAdvance = font.advance('M'); this.spaceAdvance = font.advance(' ');
		this.inlineFieldMetrics.spaceAdvance = this.spaceAdvance;
		this.layout = new CodeLayout(font, { inlineEdit: this.inlineEdit, computeWrapWidth: () => computeWrapWidth(this) });
		if (this.model !== null) this.layout.attach(document);
		this.clearVisualCursor();
	}

	public setBounds(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds> = bounds): void {
		const client = this.geometry.clientBounds;
		const widthChanged = client.right - client.left !== bounds.right - bounds.left;
		copy_rect_bounds(client, bounds);
		write_rect_bounds(this.geometry.presentedBounds, clamp(bounds.left, clip.left, clip.right), clamp(bounds.top, clip.top, clip.bottom),
			clamp(bounds.right, clip.left, clip.right), clamp(bounds.bottom, clip.top, clip.bottom));
		if (widthChanged) { this.clearVisualCursor(); this.layout.markVisualLinesDirty(); this.pointer.lastPointerRowResolution = null; }
	}

	public attach(model: EditorTextModel, view: CodeEditorViewState, document: CodeDocumentProjection): void {
		this.detach();
		this.clearInlineEdit(); this.clearVisualCursor();
		view.cursorRow = model.clampRow(view.cursorRow); view.cursorColumn = model.clampColumn(view.cursorRow, view.cursorColumn);
		const anchor = view.selectionAnchor;
		if (anchor !== null) { anchor.row = model.clampRow(anchor.row); anchor.column = model.clampColumn(anchor.row, anchor.column); }
		this.model = model; this.view = view; this.layout.attach(document);
		this.unbindModelChange = model.onWillChangeContent(() => {
			pointerCapture.cancelTarget(this);
			this.clearInlineEdit(); this.clearVisualCursor();
		});
		this.unbindModelDisposal = model.onWillDispose(() => this.detach());
	}

	public detach(): void {
		this.unbindModelChange?.(); this.unbindModelDisposal?.();
		this.unbindModelChange = this.unbindModelDisposal = undefined;
		pointerCapture.cancelTarget(this); this.scrollbarController.cancel(); this.focusTarget.release();
		this.clearInlineEdit(); this.clearVisualCursor(); this.layout.clearDocument(); this.pendingEditContext = null;
		this.model = null; this.view = null; this.pointer.lastPointerSnapshot = null;
	}
	public update(deltaSeconds: number): void {
		advanceToggleBlink(this.caret, deltaSeconds, CURSOR_BLINK_INTERVAL);
	}

	public dispose(): void {
		this.detach(); this.unbindFocus(); this.cursorMovedListeners.clear(); this.viewChangeListeners.clear();
		this.focusTarget.textInput = undefined;
	}

	public setInlineEdit(row: number, startColumn: number, endColumn: number, text: string, preserveCase = false): boolean {
		const value = this.inlineEditValue;
		if (value.active && value.row === row && value.startColumn === startColumn && value.endColumn === endColumn
			&& value.text === text && value.preserveCase === preserveCase) return false;
		this.clearVisualCursor(); value.row = row; value.startColumn = startColumn; value.endColumn = endColumn;
		value.text = text; value.preserveCase = preserveCase; value.active = true; value.version++; return true;
	}
	public clearInlineEdit(): void { const value = this.inlineEditValue; if (!value.active) return; value.active = false; value.version++; }
	public clearVisualCursor(): void { this.visualCursorOverride = null; }
	public captureVisualCursor(row: number, column: number, visualIndex: number): void {
		const value = this.visualCursorValue; value.row = row; value.column = column; value.visualIndex = visualIndex; this.visualCursorOverride = value;
	}
	public onDidMoveCursor(listener: () => void): () => void { this.cursorMovedListeners.add(listener); return () => this.cursorMovedListeners.delete(listener); }
	public emitCursorMoved(): void {
		this.clearInlineEdit();
		for (const listener of this.cursorMovedListeners) listener();
		this.emitViewStateChanged();
	}

	public onDidChangeViewState(listener: () => void): () => void {
		this.viewChangeListeners.add(listener);
		return () => this.viewChangeListeners.delete(listener);
	}
	public emitViewStateChanged(): void {
		for (const listener of this.viewChangeListeners) listener();
	}

	public setScrollPosition(row: number, left: number): void {
		if (this.view.scrollRow === row && this.view.scrollLeft === left) return;
		this.view.scrollRow = row; this.view.scrollLeft = left;
		this.emitViewStateChanged();
	}

	public acceptPointerInput(snapshot: PointerInputSnapshot): void {
		copyPointerSnapshot(this.pointerInput, snapshot);
		this.pointerInput.modifiers = snapshot.modifiers;
		this.pointerInput.spaceDown = snapshot.spaceDown;
		this.pointer.lastPointerSnapshot = snapshot.valid ? this.pointerInput : null;
	}

	public beginPointerSelection(snapshot: PointerSnapshot): void {
		copyPointerSnapshot(this.pointer.selectionSnapshot, snapshot);
		this.pointer.pointerSelecting = true; pointerCapture.capture(this, undefined, this.focusTarget.scope.surfaceScope);
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const previous = this.pointer.selectionSnapshot;
		const moved = snapshot.viewportX !== previous.viewportX || snapshot.viewportY !== previous.viewportY;
		copyPointerSnapshot(previous, snapshot);
		if (moved) handleCodeAreaSelectionPointer(this, snapshot, getCodeAreaBounds(this));
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void {
		pointerCapture.release(this);
		if (this.pointer.pointerSelecting) this.pointer.lastPointerSnapshot = null;
		this.pointer.pointerSelecting = false; this.pointer.lastPointerRowResolution = null;
	}
}
