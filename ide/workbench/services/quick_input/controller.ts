import { pointerHover } from '../../../input/pointer/hover';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { create_rect_bounds, point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../common/clipboard';
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
import { drawQuickPick, layoutQuickPick } from './render';

type QuickPickSession = {
	readonly accept: (itemIndex: number) => void;
	readonly returnFocus: InputFocusTarget | null;
	readonly disposables: DisposableStore;
};

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
	};
	public title = '';
	public placeholder = '';
	public titleText = '';
	public placeholderText = '';
	public labelsDirty = true;
	private session: QuickPickSession | null = null;
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
			this.model.filter(this.field.text);
			resetBlink();
		});
		this.field.focusTarget.onDidBlur(() => { this.hide(false); });
	}

	public get visible(): boolean { return this.session !== null; }

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
		this.session = { returnFocus, disposables, accept: index => accept(provider.items[index]) };
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
		this.field.pointerSelecting = false;
		if (restoreFocus) inputFocus.setTarget(session.returnFocus);
		else this.field.focusTarget.release();
	}

	public accept(): void {
		const list = this.model.list;
		if (list.selectionIndex === -1) return; // A real user choice is required.
		const index = list.rows[list.selectionIndex].itemIndex;
		const accept = this.session!.accept;
		this.hide();
		accept(index);
	}

	public update(): void {
		if (!this.visible) return;
		layoutQuickPick(this);
		this.scrollbarPointer.update();
		if (this.pressedRow !== undefined && this.pointerRevision !== this.model.viewport.revision) this.cancelPointer();
		this.textViewport.update(this.field, this.layout.field.right - this.layout.field.left - 6,
			editorViewState.inlineFieldMetricsRef, editorViewState.font);
	}

	public draw(): void { if (this.visible) drawQuickPick(this); }

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
			this.accept();
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
		if (this.scrollbarPointer.handlePointer(snapshot)) { pointerHover.release(this); return; }
		if (this.field.pointerSelecting || point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.field)) {
			this.pointer.textLeft = this.layout.field.left + 3 - this.textViewport.offset;
			this.pointer.pointerX = snapshot.viewportX;
			this.pointer.justPressed = justPressed;
			this.pointer.pointerPressed = ((snapshot.pressedButtons & PointerButton.Primary) !== 0);
			if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetBlink();
			return;
		}
		const index = this.model.rowIndexAtPosition(snapshot.viewportX, snapshot.viewportY);
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
