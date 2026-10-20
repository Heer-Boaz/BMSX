import type { ClipboardTarget } from '../../hosts/common/clipboard';
import type { EditorCommandId } from '../common/commands';
import type { PlayerInput } from '../../hosts/common/input/player';
import type { KeyInputEvent, TextInputTarget } from '../../hosts/common/input/text';
import type { RectBounds } from '../../machine/ts/common/rect';
import type { InputRecipient } from '../../hosts/common/input/channel';

export type GuestInputBinding = { bounds: Readonly<RectBounds>; readonly recipient: InputRecipient };

export type FocusCommand = {
	isEnabled(): boolean;
	run(): void;
};

/** A concrete control's unsubmitted value, never a pane-wide success stub. */
export interface InputEdit {
	readonly pending: boolean;
	commit(): boolean;
}

/** A retained canvas control, not a document or an editor-input classification. */
export class InputFocusTarget {
	/** Explicit action context, not inheritance through the focus-return parent. */
	public commandContext: InputFocusTarget = this;
	/** Transient controls expose their actual attachment, not a second visibility flag. */
	public canFocus: (() => boolean) | undefined;
	public edit: InputEdit | undefined;
	/** A focused embedded viewport routes physical input to the guest, not editor commands. */
	public guestInput: GuestInputBinding | undefined;
	public next: InputFocusTarget | null = null;
	public previous: InputFocusTarget | null = null;
	private readonly commands = new Map<EditorCommandId, FocusCommand>();
	private readonly blurListeners = new Set<() => void>();
	private readonly focusListeners = new Set<() => void>();
	public clipboard: ClipboardTarget | undefined;
	public textInput: TextInputTarget | undefined;
	private keyboardHandler: ((input: KeyInputEvent) => void) | undefined;
	private keyboardCancellation: (() => void) | undefined;
	private gamepadHandler: ((input: PlayerInput) => void) | undefined;

	public constructor(
		private readonly owner: InputFocusService,
		public readonly parent: InputFocusTarget | null,
	) {
	}

	public get hasFocus(): boolean {
		return this.owner.target === this;
	}

	public focus(): void {
		this.owner.setTarget(this);
	}

	/** Only the control losing focus may release it; hiding another view must not steal it. */
	public release(): void {
		if (this.hasFocus) {
			this.owner.setTarget(this.parent);
		}
	}

	public registerCommand(command: EditorCommandId, implementation: FocusCommand): void {
		this.commands.set(command, implementation);
	}

	public getCommand(command: EditorCommandId): FocusCommand | undefined {
		return this.commands.get(command);
	}

	public onDidBlur(listener: () => void): () => void {
		this.blurListeners.add(listener);
		return () => this.blurListeners.delete(listener);
	}

	public onDidFocus(listener: () => void): () => void {
		this.focusListeners.add(listener);
		return () => this.focusListeners.delete(listener);
	}

	/** The control owner binds its input handler before making it focusable. */
	public bindKeyboard(handler: (input: KeyInputEvent) => void, cancel?: () => void): () => void {
		this.keyboardHandler = handler;
		this.keyboardCancellation = cancel;
		return () => { this.keyboardHandler = undefined; this.keyboardCancellation = undefined; };
	}

	public cancelKeyboard(): void { this.keyboardCancellation?.(); }

	public bindGamepad(handler: (input: PlayerInput) => void): () => void {
		this.gamepadHandler = handler;
		return () => { this.gamepadHandler = undefined; };
	}

	public bindClipboard(target: ClipboardTarget): () => void {
		this.clipboard = target;
		return () => { this.clipboard = undefined; };
	}

	public handleKeyboard(input: KeyInputEvent): void {
		this.keyboardHandler!(input);
	}

	public handleGamepad(input: PlayerInput): void {
		this.gamepadHandler?.(input);
	}

	public didBlur(): void {
		for (const listener of this.blurListeners) listener();
	}

	public didFocus(): void {
		for (const listener of this.focusListeners) listener();
	}
}

/** Single canvas focus owner. Menus preserve the invoking control's command context. */
export class InputFocusService {
	private targetValue: InputFocusTarget | null = null;
	private readonly changeListeners = new Set<() => void>();

	public onDidChangeTarget(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	/** Native text owners synchronize only after an actual control interaction. */
	public notifyTargetChanged(): void {
		for (const listener of this.changeListeners) listener();
	}

	public createTarget(parent: InputFocusTarget | null = null): InputFocusTarget {
		return new InputFocusTarget(this, parent);
	}

	public get target(): InputFocusTarget | null {
		return this.targetValue;
	}

	public setTarget(target: InputFocusTarget | null): void {
		target = this.resolveTarget(target);
		const previous = this.targetValue;
		if (previous === target) { this.notifyTargetChanged(); return; }
		// Like Godot's Viewport, detach before notifying the departing control.
		this.targetValue = null;
		if (previous !== null) previous.didBlur();
		this.targetValue = target;
		if (target !== null) target.didFocus();
		this.notifyTargetChanged();
	}

	/** A retired inline control returns to its containing focus scope. */
	public resolveTarget(target: InputFocusTarget | null): InputFocusTarget | null {
		while (target !== null && target.canFocus !== undefined && !target.canFocus()) target = target.parent;
		return target;
	}

	public getCommand(command: EditorCommandId, target: InputFocusTarget | null = this.targetValue): FocusCommand | undefined {
		return target?.commandContext.getCommand(command);
	}

	public executeCommand(command: EditorCommandId, target: InputFocusTarget | null = this.targetValue): void {
		const implementation = this.getCommand(command, target);
		if (implementation !== undefined && implementation.isEnabled()) {
			implementation.run();
		}
	}

	public handleKeyboard(input: KeyInputEvent): void {
		if (this.targetValue !== null) this.targetValue.handleKeyboard(input);
	}

	public handleGamepad(input: PlayerInput): void {
		if (this.targetValue !== null) this.targetValue.handleGamepad(input);
	}

	public cancelKeyboard(): void { this.targetValue?.cancelKeyboard(); }

	/** The containing view programs its focus order, excluding disabled controls. */
	public moveFocus(backward: boolean): boolean {
		const target = this.targetValue;
		if (target === null) return false;
		const destination = backward ? target.previous : target.next;
		if (destination === null) return false;
		this.setTarget(destination);
		return true;
	}
}

export const inputFocus = new InputFocusService();
