import { pointerHover } from '../../../input/pointer/hover';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { create_rect_bounds, point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { advanceQuickInputSelection } from '../../../editor/navigation/quick_input_navigation';
import { resetBlink } from '../../../editor/render/caret';
import { applyInlineFieldEditing, applyInlineFieldPointer, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { editorViewState } from '../../../editor/ui/view/state';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { QuickPickModel, type QuickPickRenderRow } from './model';
import type { QuickPickItem, QuickPickMatch, QuickPickProvider } from './provider';
import { drawQuickInput, layoutQuickInput } from './render';

type QuickInputSession = {
	readonly returnFocus: InputFocusTarget | null;
	readonly disposables: DisposableStore;
} & ({ readonly kind: 'pick'; readonly accept: (itemIndex: number) => void }
	| { readonly kind: 'input'; readonly accept: () => Promise<void> });

/** One transient workbench surface, independent of editor panes and their documents. */
export class QuickInputController implements PointerCaptureTarget {
	public readonly pointerScope = Symbol('quick input');
	public readonly field = new TextField();
	public readonly model = new QuickPickModel();
	public readonly textViewport = new SingleLineFieldViewport();
	public readonly layout = {
		bounds: create_rect_bounds(), field: create_rect_bounds(),
		width: -1, height: -1, headerHeight: -1, font: null as object | null,
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
	private readonly scrollbarPointer = new ScrollbarPointerControl(pointerCapture, this.pointerScope);
	private pressedRow: QuickPickMatch | undefined;
	private pointerRevision = 0;
	private readonly unbindKeyboard: () => void;
	private readonly pointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	};

	public constructor(private readonly clipboard: Clipboard) {
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.onDidChangeText(() => {
			this.cancelPointer();
			this.scrollbarPointer.cancelPointer();
			if (this.session?.kind === 'pick') this.model.filter(this.field.text);
			else { this.message = ''; this.labelsDirty = true; }
			resetBlink();
		});
		this.field.focusTarget.onDidBlur(() => { this.hide(false); });
	}

	public get visible(): boolean { return this.session !== null; }
	public get inputBox(): boolean { return this.session?.kind === 'input'; }

	public pick<T extends QuickPickItem>(
		title: string,
		placeholder: string,
		provide: (origin: InputFocusTarget | null, disposables: DisposableStore) => QuickPickProvider<T>,
		accept: (item: T) => void,
	): void {
		this.hide();
		pointerCapture.cancel();
		const returnFocus = inputFocus.target;
		// A provider observes the invoking control after its ordinary blur policy,
		// never the previous popup's query or an unaccepted property draft.
		this.field.focusTarget.focus();
		const disposables = new DisposableStore();
		const provider = provide(returnFocus, disposables);
		this.session = { kind: 'pick', returnFocus, disposables, accept: index => accept(provider.items[index]) };
		this.title = title;
		this.placeholder = placeholder;
		this.model.setInput(provider);
		this.labelsDirty = true;
		setFieldText(this.field, '', true);
		this.model.filter('');
		this.scrollbarPointer.setInput(this.model.viewport.scrollbar);
		this.update();
		resetBlink();
	}

	/** Submission owns its operation; this surface owns feedback and focus lifetime. */
	public input<T>(
		title: string,
		placeholder: string,
		value: string,
		submit: (value: string) => Promise<T>,
		accept: (result: T) => void,
	): DisposableStore {
		this.hide();
		pointerCapture.cancel();
		const returnFocus = inputFocus.target;
		this.field.focusTarget.focus();
		const session: QuickInputSession = {
			kind: 'input', returnFocus, disposables: new DisposableStore(),
			accept: async () => {
				if (this.field.readOnly) return; // One outstanding submission per input session.
				this.field.readOnly = true;
				this.message = 'WORKING...';
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
				this.hide();
				accept(result);
			},
		};
		this.session = session;
		this.title = title;
		this.placeholder = placeholder;
		this.labelsDirty = true;
		setFieldText(this.field, value, true);
		this.update();
		resetBlink();
		return session.disposables;
	}

	public hide(restoreFocus = true): void {
		pointerHover.release(this);
		this.cancelPointer();
		this.scrollbarPointer.clearInput();
		const session = this.session;
		if (session === null) return;
		this.session = null;
		session.disposables.dispose();
		this.model.clearInput();
		this.layout.renderRows.length = 0;
		this.message = '';
		this.field.readOnly = false;
		this.field.pointerSelecting = false;
		if (restoreFocus) inputFocus.setTarget(session.returnFocus);
		else this.field.focusTarget.release();
	}

	public accept(): void | Promise<void> {
		const session = this.session!;
		if (session.kind === 'input') return session.accept();
		const list = this.model.list;
		if (list.selectionIndex === -1) return; // A real user choice is required.
		const index = list.rows[list.selectionIndex].itemIndex;
		const accept = session.accept;
		this.hide();
		accept(index);
	}

	public update(): void {
		if (!this.visible) return;
		layoutQuickInput(this);
		if (!this.inputBox) this.scrollbarPointer.update();
		if (this.pressedRow !== undefined && this.pointerRevision !== this.model.viewport.revision) this.cancelPointer();
		this.textViewport.update(this.field, this.layout.field.right - this.layout.field.left - 6,
			editorViewState.inlineFieldMetricsRef, editorViewState.font);
	}

	public draw(): void { if (this.visible) drawQuickInput(this); }

	private moveSelection(delta: number): void {
		const list = this.model.list;
		list.selectionIndex = advanceQuickInputSelection(list.selectionIndex, list.rows.length, delta);
		this.model.revealSelection();
		resetBlink();
	}

	private handleKeyboard(input: PlayerInput): void {
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
			applyInlineFieldEditing(input, this.clipboard, this.field, INPUT_OPTIONS);
			return;
		}
		if (isCtrlDown(input) && (isKeyJustPressed('Home', input) || isKeyJustPressed('End', input))) {
			const last = isKeyJustPressed('End', input);
			consumeIdeKey(last ? 'End' : 'Home', input);
			const list = this.model.list;
			list.selectionIndex = list.rows.length === 0 ? -1 : last ? list.rows.length - 1 : 0;
			this.model.revealSelection();
			resetBlink();
			return;
		}
		for (const [code, delta] of NAVIGATION) {
			if (shouldRepeatKeyFromPlayer(code, input)) {
				consumeIdeKey(code, input);
				this.moveSelection(delta * (code === 'PageUp' || code === 'PageDown' ? this.model.visibleRowCount : 1));
				return;
			}
		}
		applyInlineFieldEditing(input, this.clipboard, this.field, INPUT_OPTIONS);
	}

	public onPointerLeave(): void { this.model.list.hoverIndex = -1; }

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean): void {
		this.update();
		if (!snapshot.valid || !snapshot.insideViewport) { pointerHover.release(this); return; }
		this.model.list.hoverIndex = -1;
		if (!this.inputBox && this.scrollbarPointer.handlePointer(snapshot)) { pointerHover.release(this); return; }
		if (this.field.pointerSelecting || point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.field)) {
			this.pointer.textLeft = this.layout.field.left + 3 - this.textViewport.offset;
			this.pointer.pointerX = snapshot.viewportX;
			this.pointer.justPressed = justPressed;
			this.pointer.pointerPressed = ((snapshot.pressedButtons & PointerButton.Primary) !== 0);
			if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetBlink();
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
		this.hide(false);
		this.unbindKeyboard();
	}
}

const NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1], ['PageUp', -1], ['PageDown', 1]] as const;
const INPUT_OPTIONS = {
	allowSpace: true,
	characterFilter: (character: string) => character !== '\r' && character !== '\n' && character !== '\t',
};
