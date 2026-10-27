import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../context_menu/controller';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { create_rect_bounds, point_in_rect } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { advanceQuickInputSelection } from '../../../editor/navigation/quick_input_navigation';
import { resetInlineBlink } from '../../../editor/render/caret';
import { applyInlineFieldEditing, applyInlineFieldPointer, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { editorViewState } from '../../../editor/ui/view/state';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { QuickPickModel, type QuickPickRenderRow } from './model';
import type { QuickPickItem, QuickPickMatch, QuickPickProvider } from './provider';
import { drawQuickInput, layoutQuickInput } from './render';
import type { WorkbenchModalPresentation } from '../windows/model';

export type QuickInputOptions = {
	readonly preserveFocus?: boolean;
	readonly invocationOrigin?: InputFocusTarget | null;
};

type QuickInputSession = {
	readonly kind: 'pick' | 'input';
	origin: InputFocusTarget | null;
	returnFocus: InputFocusTarget | null;
	interactionOrigin: InputFocusScope | undefined;
	readonly disposables: DisposableStore;
	contextAdmitted: boolean;
	unbindOrigin: (() => void) | undefined;
	readonly accept: () => void | Promise<void>;
	prepare: (() => void) | undefined;
};

/** One transient workbench surface, independent of editor panes and their documents. */
export class QuickInputController implements PointerCaptureTarget {
	public readonly pointerScope = Symbol('quick input');
	public readonly field: TextField;
	public readonly model = new QuickPickModel();
	public readonly textViewport = new SingleLineFieldViewport();
	public readonly layout = {
		bounds: create_rect_bounds(), field: create_rect_bounds(),
		left: 0, top: 0, width: -1, height: -1, font: null as object | null,
		projectionRevision: -1, textRevision: 0, preparedStart: -1, preparedEnd: -1,
		renderRows: [] as QuickPickRenderRow[],
		messageLines: [] as string[],
	};
	public title = '';
	public placeholder = '';
	public titleText = '';
	public placeholderText = '';
	public message = '';
	public labelsDirty = true;
	private session: QuickInputSession | null = null;
	private retiringSession: QuickInputSession | null = null;
	private disposed = false;
	private readonly scrollbarPointer = new ScrollbarPointerControl(pointerCapture, this.pointerScope);
	private pressedRow: QuickPickMatch | undefined;
	private pointerRevision = 0;
	private readonly unbindKeyboard: () => void;
	private readonly presentForFocus = (): void => {
		const session = this.session!;
		if (this.presentation.kind === 'part') this.presentation.reveal();
		if (this.session !== session) return;
		if (session.prepare !== undefined) {
			session.returnFocus = inputFocus.resolveTarget(session.returnFocus);
			const prepare = session.prepare; session.prepare = undefined; prepare();
		}
		if (this.session === session) this.onDidChangeVisibility();
	};
	private readonly pointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	};

	public constructor(private readonly contextMenu: ContextMenuController,
		private readonly onDidChangeVisibility: () => void = () => {},
		private readonly acceptsFocusTransfer: (next: InputFocusTarget | null) => boolean = () => false,
		public readonly presentation: WorkbenchModalPresentation) {
		this.field = new TextField(null, INPUT_OPTIONS, new InputFocusScope(this.pointerScope, presentation.scope));
		this.field.focusTarget.canFocus = () => this.session !== null;
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.onDidChangeText(() => {
			this.cancelPointer();
			this.scrollbarPointer.cancelPointer();
			if (this.session?.kind === 'pick') this.model.filter(this.field.text);
			else { this.message = ''; this.labelsDirty = true; }
			resetInlineBlink();
		});
		this.field.focusTarget.onDidBlur(next => {
			this.cancelPointer(); this.scrollbarPointer.cancelPointer(); this.field.pointerSelecting = false;
			if (presentation.kind === 'workspace' && this.session !== null && !this.acceptsFocusTransfer(next)) this.hide(false);
		});
	}

	public get visible(): boolean { return this.session !== null; }
	public get invocationOrigin(): InputFocusTarget | null { return this.session!.origin; }
	public get inputBox(): boolean { return this.session?.kind === 'input'; }

	public pick<T extends QuickPickItem>(
		title: string,
		placeholder: string,
		provide: (origin: InputFocusTarget | null, disposables: DisposableStore) => QuickPickProvider<T>,
		accept: (item: T) => void,
		onWillShow?: (lifetime: DisposableStore) => void,
		options: QuickInputOptions = {},
	): void {
		const { invocationOrigin } = options;
		let provider: QuickPickProvider<T>;
		const session: QuickInputSession = {
			kind: 'pick', origin: null, returnFocus: null, interactionOrigin: undefined, disposables: new DisposableStore(), contextAdmitted: true, unbindOrigin: undefined,
			prepare: () => {
				// Catalogs observe the invoking control after ordinary blur has published
				// its draft, before native focus sees the new field presentation.
				session.origin = invocationOrigin === undefined ? inputFocus.resolveTarget(session.origin) : invocationOrigin;
				provider = provide(session.origin, session.disposables);
				if (this.session !== session) return;
				this.title = title;
				this.placeholder = placeholder;
				this.model.setInput(provider);
				if (provider.onDidChange !== undefined) {
					const unbind = provider.onDidChange(() => {
						if (this.session !== session) return;
						this.cancelPointer(); this.scrollbarPointer.cancelPointer(); pointerHover.release(this);
						if (this.session !== session) return;
						this.model.refresh(this.field.text);
						if (this.session !== session) return;
						this.update();
					});
					if (this.session !== session) { unbind(); return; }
					session.disposables.add({ dispose: unbind });
				}
				this.labelsDirty = true;
				setFieldText(this.field, '', true);
				if (this.session !== session) return;
				this.update();
				resetInlineBlink();
				this.onDidChangeVisibility();
			},
			accept: () => {
				const list = this.model.list;
				if (list.selectionIndex === -1) return; // A real user choice is required.
				const item = provider.items[list.rows[list.selectionIndex].itemIndex];
				try {
					this.retireSession(true, true);
					session.disposables.dispose();
					if (session.contextAdmitted) accept(item);
				} finally {
					session.contextAdmitted = false; session.unbindOrigin?.(); session.disposables.dispose();
					if (this.retiringSession === session) this.retiringSession = null;
				}
			},
		};
		this.show(session, onWillShow, options);
	}

	/** Attach scoped resources before focus can publish source changes. Submission owns its operation. */
	public input<T>(
		title: string,
		placeholder: string,
		value: string,
		submit: (value: string) => Promise<T>,
		accept: (result: T, preserveFocus: boolean) => void,
		onWillShow?: (lifetime: DisposableStore) => void,
		options: QuickInputOptions = {},
	): void {
		const session: QuickInputSession = {
			kind: 'input', origin: null, returnFocus: null, interactionOrigin: undefined, disposables: new DisposableStore(), contextAdmitted: true, unbindOrigin: undefined,
			prepare: () => {
				this.title = title;
				this.placeholder = placeholder;
				this.labelsDirty = true;
				setFieldText(this.field, value, true);
				if (this.session !== session) return;
				this.update();
				resetInlineBlink();
				this.onDidChangeVisibility();
			},
			accept: async () => {
				if (this.field.readOnly) return; // One outstanding submission per input session.
				const focusRevision = inputFocus.revision;
				this.field.readOnly = true;
				this.message = 'WORKING…';
				this.labelsDirty = true;
				let result: T;
				try { result = await submit(this.field.text); }
				catch (error) {
					if (this.session === session) {
						this.field.readOnly = false;
						this.message = error instanceof Error ? error.message : String(error);
						this.labelsDirty = true;
					}
					return;
				}
				// Cancelling/replacing the UI does not undo a completed operation or
				// allow its late completion to navigate away from the new focus owner.
				if (this.session !== session) return;
				const preserveFocus = focusRevision !== inputFocus.revision || !this.field.focusTarget.hasFocus;
				try {
					this.retireSession(true, true);
					session.disposables.dispose();
					if (session.contextAdmitted) accept(result, preserveFocus);
				} finally {
					session.contextAdmitted = false; session.unbindOrigin?.(); session.disposables.dispose();
					if (this.retiringSession === session) this.retiringSession = null;
				}
			},
		};
		this.show(session, onWillShow, options);
	}

	/** Publish the new owner before retiring callbacks; replacements keep the invoking context. */
	private show(session: QuickInputSession, onWillShow: ((lifetime: DisposableStore) => void) | undefined, options: QuickInputOptions): boolean {
		if (this.disposed) { session.disposables.dispose(); return false; }
		const { invocationOrigin, preserveFocus } = options;
		const previous = this.session;
		const target = inputFocus.target === null ? inputFocus.pendingTarget : inputFocus.target;
		const takeFocus = !preserveFocus;
		let returnFocus = previous !== null ? previous.returnFocus
			: target === this.contextMenu.focusTarget ? this.contextMenu.returnFocus
			: this.retiringSession !== null && target === this.field.focusTarget ? this.retiringSession.returnFocus : target;
		let origin = invocationOrigin !== undefined ? invocationOrigin : previous !== null ? previous.origin
			: target === this.contextMenu.focusTarget ? this.contextMenu.returnFocus
			: this.retiringSession !== null && target === this.field.focusTarget ? this.retiringSession.origin : target;
		let interactionOrigin = invocationOrigin !== undefined ? invocationOrigin?.scope : previous !== null ? previous.interactionOrigin
			: target === this.contextMenu.focusTarget ? this.contextMenu.invocationOrigin?.scope
			: this.retiringSession !== null && target === this.field.focusTarget ? this.retiringSession.interactionOrigin : target?.scope;
		if (preserveFocus && this.presentation.kind === 'part') {
			if (invocationOrigin === undefined && origin !== null && !this.presentation.scope.contains(origin.scope)) origin = null;
			if (returnFocus !== null && !this.presentation.scope.contains(returnFocus.scope)) returnFocus = null;
			if (origin === null) interactionOrigin = this.presentation.scope;
		}
		session.origin = origin;
		session.returnFocus = returnFocus;
		session.interactionOrigin = interactionOrigin;
		this.session = session;
		this.field.focusTarget.scope.interactionOrigin = interactionOrigin;
		const originScope = origin === null ? this.presentation.scope : origin.commandContext.scope;
		session.unbindOrigin = originScope.onDidRetireContext(() => {
			session.contextAdmitted = false;
			if (this.session === session) this.hide(false);
		});
		if (!this.presentation.scope.contains(originScope)) session.disposables.add({ dispose: this.presentation.scope.onDidRetireContext(() => this.hide(false)) });
		this.clearPresentation();
		onWillShow?.(session.disposables);
		if (previous !== null) { previous.contextAdmitted = false; previous.unbindOrigin?.(); previous.disposables.dispose(); }
		const retiring = this.retiringSession;
		if (retiring !== null) {
			retiring.contextAdmitted = false; retiring.unbindOrigin?.(); retiring.disposables.dispose();
			if (this.retiringSession === retiring) this.retiringSession = null;
		}
		if (this.session !== session) return false;
		if (takeFocus || this.contextMenu.visible && this.contextMenu.invocationOrigin !== null
			&& this.presentation.scope.contains(this.contextMenu.invocationOrigin.scope)) this.contextMenu.hide();
		if (this.session !== session) return false;
		if (this.presentation.kind === 'workspace') pointerCapture.cancel();
		if (this.session !== session) return false;
		if ((!takeFocus || this.field.focusTarget.hasFocus) && session.prepare !== undefined) {
			const prepare = session.prepare!;
			session.prepare = undefined;
			prepare();
			if (this.session !== session) return false;
		}
		if (takeFocus) inputFocus.setTarget(this.field.focusTarget, this.presentForFocus);
		if (this.session !== session) return false;
		session.returnFocus = inputFocus.resolveTarget(returnFocus);
		return true;
	}

	private clearPresentation(): void {
		pointerHover.release(this);
		this.cancelPointer();
		this.scrollbarPointer.cancelPointer();
		this.model.clearInput();
		this.layout.renderRows.length = 0;
		this.message = '';
		this.field.readOnly = false;
		this.field.pointerSelecting = false;
	}

	public hide(restoreFocus = true): void {
		if (this.retiringSession !== null) this.retiringSession.contextAdmitted = false;
		this.retireSession(restoreFocus);
	}

	/** Presentation ends before focus return; an accepted action retains origin admission through handoff. */
	private retireSession(restoreFocus: boolean, handoff = false): void {
		const session = this.session;
		if (session === null) return;
		this.session = null;
		this.field.focusTarget.scope.interactionOrigin = undefined;
		if (!handoff) { session.contextAdmitted = false; session.unbindOrigin?.(); }
		this.retiringSession = session;
		this.clearPresentation();
		if (!handoff) session.disposables.dispose();
		if (this.session !== null) return;
		this.onDidChangeVisibility();
		if (this.session !== null) return;
		if (this.field.focusTarget.hasFocus || inputFocus.pendingTarget === this.field.focusTarget || this.acceptsFocusTransfer(inputFocus.target)) {
			inputFocus.setTarget(restoreFocus ? session.returnFocus : null);
		}
		if (!handoff && this.retiringSession === session) this.retiringSession = null;
	}

	public accept(): void | Promise<void> {
		return this.session!.accept();
	}

	public update(): void {
		if (!this.visible) return;
		layoutQuickInput(this);
		if (this.pressedRow !== undefined && this.pointerRevision !== this.model.viewport.revision) this.cancelPointer();
		this.textViewport.layout(this.field, this.layout.field, editorViewState.inlineFieldMetricsRef, editorViewState.font, this.layout.bounds);
	}

	public draw(): void { if (this.visible) drawQuickInput(this); }

	private moveSelection(delta: number): void {
		const list = this.model.list;
		list.selectionIndex = advanceQuickInputSelection(list.selectionIndex, list.rows.length, delta);
		this.model.revealSelection();
		resetInlineBlink();
	}

	private handleKeyboard(input: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.hide();
			return;
		}
		if (isKeyJustPressed('Enter', input) || isKeyJustPressed('NumpadEnter', input)) {
			consumeIdeKey('Enter', input);
			consumeIdeKey('NumpadEnter', input);
			void this.accept();
			return;
		}
		if (this.inputBox) {
			applyInlineFieldEditing(input, this.field);
			return;
		}
		if (isCtrlDown(input) && (isKeyJustPressed('Home', input) || isKeyJustPressed('End', input))) {
			const last = isKeyJustPressed('End', input);
			consumeIdeKey(last ? 'End' : 'Home', input);
			const list = this.model.list;
			list.selectionIndex = list.rows.length === 0 ? -1 : last ? list.rows.length - 1 : 0;
			this.model.revealSelection();
			resetInlineBlink();
			return;
		}
		for (const [code, delta] of NAVIGATION) {
			if (isKeyDown(code, input)) {
				consumeIdeKey(code, input);
				this.moveSelection(delta * (code === 'PageUp' || code === 'PageDown' ? this.model.visibleRowCount : 1));
				return;
			}
		}
		applyInlineFieldEditing(input, this.field);
	}

	public onPointerLeave(): void { this.model.list.hoverIndex = -1; }

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean): void {
		this.update();
		if (!snapshot.valid || !snapshot.insideViewport) { pointerHover.release(this); return; }
		if (justPressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.bounds)) {
			const session = this.session;
			inputFocus.setTarget(this.field.focusTarget, this.presentForFocus);
			if (this.session !== session) return;
		}
		this.model.list.hoverIndex = -1;
		if (!this.inputBox && this.scrollbarPointer.handlePointer(snapshot, this.model.viewport.scrollbar)) { pointerHover.release(this); return; }
		if (this.field.pointerSelecting || point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.field)) {
			this.pointer.textLeft = this.layout.field.left + 3 - this.textViewport.offset;
			this.pointer.pointerX = snapshot.viewportX;
			this.pointer.justPressed = justPressed;
			this.pointer.pointerPressed = ((snapshot.pressedButtons & PointerButton.Primary) !== 0);
			if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetInlineBlink();
			return;
		}
		const index = this.inputBox ? -1 : this.model.rowIndexAtPosition(snapshot.viewportX, snapshot.viewportY);
		if (index >= 0) pointerHover.visit(this);
		else pointerHover.release(this);
		this.model.list.hoverIndex = index;
		if (!justPressed) return;
		if (index !== -1) {
			this.model.list.selectionIndex = index;
			pointerCapture.capture(this, PointerButton.Primary, this.pointerScope);
			this.pressedRow = this.model.list.rows[index];
			this.pointerRevision = this.model.viewport.revision;
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		} else if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.bounds)) {
			this.hide();
		}
	}

	public handleWheel(delta: number): void {
		if (this.inputBox) return;
		this.cancelPointer();
		this.scrollbarPointer.cancelPointer();
		const view = this.model.viewport;
		view.scrollbar.setScroll(view.scrollTop + delta * this.model.rowHeight);
		this.model.list.hoverIndex = -1;
	}

	public cancelPointer(): void {
		pointerCapture.release(this);
		this.pressedRow = undefined;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		const index = this.model.rowIndexAtPosition(snapshot.viewportX, snapshot.viewportY);
		this.model.list.hoverIndex = index;
		if (index >= 0) pointerHover.visit(this);
		else pointerHover.release(this);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const row = this.pressedRow;
		const index = this.model.rowIndexAtPosition(snapshot.viewportX, snapshot.viewportY);
		this.cancelPointer();
		if (row !== undefined && index >= 0 && this.model.list.rows[index] === row) {
			this.model.list.selectionIndex = index;
			this.accept();
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.hide(false);
		this.unbindKeyboard();
	}
}

const NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1], ['PageUp', -1], ['PageDown', 1]] as const;
const INPUT_OPTIONS = {
	allowSpace: true,
	characterFilter: (character: string) => character !== '\r' && character !== '\n' && character !== '\t',
};
