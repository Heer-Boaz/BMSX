import { create_rect_bounds, point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../common/clipboard';
import type { PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { advanceQuickInputSelection } from '../../../editor/navigation/quick_input_navigation';
import { resetBlink } from '../../../editor/render/caret';
import { applyInlineFieldEditing, applyInlineFieldPointer, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { editorViewState } from '../../../editor/ui/view/state';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { QuickPickModel, type QuickPickItem } from './model';
import { drawQuickPick, layoutQuickPick } from './render';

type QuickPickSession = {
	readonly accept: (itemIndex: number) => void;
	readonly returnFocus: InputFocusTarget | null;
};

/** One transient workbench surface, independent of editor panes and their documents. */
export class QuickInputController {
	public readonly field = new TextField();
	public readonly model = new QuickPickModel();
	public readonly textViewport = new SingleLineFieldViewport();
	public readonly layout = {
		bounds: create_rect_bounds(), field: create_rect_bounds(),
		width: -1, height: -1, headerHeight: -1, font: null as object | null,
	};
	public title = '';
	public placeholder = '';
	public titleText = '';
	public placeholderText = '';
	public layoutDirty = true;
	public labelsDirty = true;
	private session: QuickPickSession | null = null;
	private readonly unbindKeyboard: () => void;
	private readonly pointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	};

	public constructor(private readonly clipboard: Clipboard) {
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.field.onDidChangeText(() => {
			this.model.filter(this.field.text);
			this.layoutDirty = true;
			resetBlink();
		});
		this.field.focusTarget.onDidBlur(() => { this.hide(false); });
	}

	public get visible(): boolean { return this.session !== null; }

	public pick<T extends QuickPickItem>(
		title: string,
		placeholder: string,
		provideItems: (origin: InputFocusTarget | null) => readonly T[],
		accept: (item: T) => void,
	): void {
		this.hide();
		const returnFocus = inputFocus.target;
		// A provider observes the invoking control after its ordinary blur policy,
		// never the previous popup's query or an unaccepted property draft.
		this.field.focusTarget.focus();
		const items = provideItems(returnFocus);
		this.session = { returnFocus, accept: index => accept(items[index]) };
		this.title = title;
		this.placeholder = placeholder;
		this.model.setItems(items);
		this.labelsDirty = true;
		setFieldText(this.field, '', true);
		this.model.filter('');
		this.layoutDirty = true;
		this.update();
		resetBlink();
	}

	public hide(restoreFocus = true): void {
		const session = this.session;
		if (session === null) return;
		this.session = null;
		this.model.entries.length = 0;
		this.model.list.rows.length = 0;
		this.model.list.selectionIndex = -1;
		this.model.list.scroll = 0;
		this.model.list.hoverIndex = -1;
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
		this.textViewport.update(this.field, this.layout.field.right - this.layout.field.left - 6,
			editorViewState.inlineFieldMetricsRef, editorViewState.font);
	}

	public draw(): void { if (this.visible) drawQuickPick(this); }

	private moveSelection(delta: number): void {
		const list = this.model.list;
		list.selectionIndex = advanceQuickInputSelection(list.selectionIndex, list.rows.length, delta);
		revealWorkbenchListSelection(list);
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
		for (const [code, delta] of NAVIGATION) {
			if (shouldRepeatKeyFromPlayer(code, input)) {
				consumeIdeKey(code, input);
				this.moveSelection(delta * (code === 'PageUp' || code === 'PageDown' ? this.model.list.layout.visibleRowCount : 1));
				return;
			}
		}
		applyInlineFieldEditing(input, this.clipboard, this.field, INPUT_OPTIONS);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean): void {
		this.update();
		this.model.list.hoverIndex = -1;
		if (this.field.pointerSelecting || point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.field)) {
			this.pointer.textLeft = this.layout.field.left + 3 - this.textViewport.offset;
			this.pointer.pointerX = snapshot.viewportX;
			this.pointer.justPressed = justPressed;
			this.pointer.pointerPressed = snapshot.primaryPressed;
			if (applyInlineFieldPointer(this.field, this.pointer).requestBlinkReset) resetBlink();
			return;
		}
		const index = workbenchListRowIndexAtPosition(this.model.list, snapshot.viewportX, snapshot.viewportY);
		this.model.list.hoverIndex = index;
		if (!justPressed) return;
		if (index !== -1) {
			this.model.list.selectionIndex = index;
			this.accept();
		} else if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, this.layout.bounds)) {
			this.hide();
		}
	}

	public handleWheel(delta: number): void { scrollWorkbenchList(this.model.list, delta); }

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
