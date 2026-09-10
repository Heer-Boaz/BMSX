import type { EditorCommandId } from '../common/commands';
import type { PlayerInput } from '../../hosts/common/input/player';

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
	public edit: InputEdit | undefined;
	public next: InputFocusTarget | null = null;
	public previous: InputFocusTarget | null = null;
	private readonly commands = new Map<EditorCommandId, FocusCommand>();
	private readonly blurListeners = new Set<() => void>();
	private readonly focusListeners = new Set<() => void>();
	private keyboardHandler: ((input: PlayerInput) => void) | undefined;

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
	public bindKeyboard(handler: (input: PlayerInput) => void): () => void {
		this.keyboardHandler = handler;
		return () => { this.keyboardHandler = undefined; };
	}

	public handleKeyboard(input: PlayerInput): void {
		this.keyboardHandler!(input);
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

	public createTarget(parent: InputFocusTarget | null = null): InputFocusTarget {
		return new InputFocusTarget(this, parent);
	}

	public get target(): InputFocusTarget | null {
		return this.targetValue;
	}

	public setTarget(target: InputFocusTarget | null): void {
		const previous = this.targetValue;
		if (previous === target) return;
		// Like Godot's Viewport, detach before notifying the departing control.
		this.targetValue = null;
		if (previous !== null) previous.didBlur();
		this.targetValue = target;
		if (target !== null) target.didFocus();
	}

	public getCommand(command: EditorCommandId): FocusCommand | undefined {
		return this.targetValue?.commandContext.getCommand(command);
	}

	public executeCommand(command: EditorCommandId): void {
		const implementation = this.getCommand(command);
		if (implementation !== undefined && implementation.isEnabled()) {
			implementation.run();
		}
	}

	public handleKeyboard(input: PlayerInput): void {
		if (this.targetValue !== null) this.targetValue.handleKeyboard(input);
	}

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
