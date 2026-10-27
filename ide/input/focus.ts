import type { ClipboardTarget } from '../../hosts/common/clipboard';
import type { EditorCommandId, EditorCommandRunner } from '../common/commands';
import type { PlayerInput } from '../../hosts/common/input/player';
import type { KeyInputEvent, TextInputTarget } from '../../hosts/common/input/text';
import type { RectBounds } from '../../machine/ts/common/rect';
import type { InputRecipient } from '../../hosts/common/input/channel';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { FrameBitmap } from '../../hosts/common/frame_bitmap';
import { WORKBENCH_POINTER_SCOPE, type PointerCaptureScope } from './pointer/capture';

export type GuestInputPresentation =
	| { readonly kind: 'direct'; readonly presenter: VideoPresenter }
	| { readonly kind: 'offscreen'; readonly frames: FrameBitmap };

export type GuestInputBinding = {
	bounds: Readonly<RectBounds>;
	readonly recipient: InputRecipient;
	readonly presentation: GuestInputPresentation;
};

export type FocusCommand = {
	isEnabled(): boolean;
	isChecked?(): boolean;
	run(): void;
};

/** A concrete control's unsubmitted value, never a pane-wide success stub. */
export interface InputEdit {
	readonly pending: boolean;
	commit(): boolean;
}

/** Shared membership and reactivation state; focus return and command origin stay independent. */
export class InputFocusScope {
	public lastFocused: InputFocusTarget | null = null;
	public commands: EditorCommandRunner | undefined;
	private contextRetirementListeners: Set<() => void> | undefined;
	/** Command ancestry is independent of presentation and the control's focus-return parent. */
	public constructor(public surfaceScope: PointerCaptureScope = WORKBENCH_POINTER_SCOPE,
		public readonly commandParent: InputFocusScope | null = null) {}

	/** A transient's command authority ends with its invoking attachment or an ancestor. */
	public onDidRetireContext(listener: () => void): () => void {
		const listeners = this.contextRetirementListeners ??= new Set();
		listeners.add(listener);
		const unbindParent = this.commandParent?.onDidRetireContext(listener);
		return () => { listeners.delete(listener); unbindParent?.(); };
	}

	/** Reusable controls may bind another input only after retiring the old context. */
	public retireContext(): void {
		const listeners = this.contextRetirementListeners;
		this.contextRetirementListeners = undefined;
		if (listeners !== undefined) for (const listener of listeners) listener();
	}
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
	/** A view boundary delegates focus to its owner, which chooses the current concrete client. */
	public next: InputFocusTarget | (() => void) | null = null;
	public previous: InputFocusTarget | (() => void) | null = null;
	private readonly commands = new Map<EditorCommandId, FocusCommand>();
	private readonly blurListeners = new Set<(next: InputFocusTarget | null) => void>();
	private readonly focusListeners = new Set<() => void>();
	private inputCancellationListeners: Set<() => void> | undefined;
	public clipboard: ClipboardTarget | undefined;
	public textInput: TextInputTarget | undefined;
	private keyboardHandler: ((input: KeyInputEvent) => void) | undefined;
	private keyboardCancellation: (() => void) | undefined;
	private gamepadHandler: ((input: PlayerInput) => void) | undefined;

	public constructor(
		private readonly owner: InputFocusService,
		public readonly parent: InputFocusTarget | null,
		public readonly scope: InputFocusScope,
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
	public unregisterCommand(command: EditorCommandId): void { this.commands.delete(command); }

	public getCommand(command: EditorCommandId): FocusCommand | undefined {
		return this.commands.get(command);
	}

	public onDidBlur(listener: (next: InputFocusTarget | null) => void): () => void {
		this.blurListeners.add(listener);
		return () => this.blurListeners.delete(listener);
	}

	public onDidFocus(listener: () => void): () => void {
		this.focusListeners.add(listener);
		return () => this.focusListeners.delete(listener);
	}

	/** Input can be revoked without blurring or committing the control's draft. */
	public onDidCancelInput(listener: () => void): () => void {
		const listeners = this.inputCancellationListeners ??= new Set();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	/** The control owner binds its input handler before making it focusable. */
	public bindKeyboard(handler: (input: KeyInputEvent) => void, cancel?: () => void): () => void {
		this.keyboardHandler = handler;
		this.keyboardCancellation = cancel;
		return () => { this.keyboardHandler = undefined; this.keyboardCancellation = undefined; };
	}

	public cancelInput(): void {
		this.keyboardCancellation?.();
		if (this.inputCancellationListeners !== undefined) {
			for (const listener of this.inputCancellationListeners) listener();
		}
	}

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

	public didBlur(next: InputFocusTarget | null): void {
		this.cancelInput();
		for (const listener of this.blurListeners) listener(next);
	}

	public didFocus(): void {
		for (const listener of this.focusListeners) listener();
	}
}

/** Single canvas focus owner. Menus preserve the invoking control's command context. */
export class InputFocusService {
	public readonly workbenchScope = new InputFocusScope();
	private targetValue: InputFocusTarget | null = null;
	private readonly changeListeners = new Set<() => void>();
	private focusRevision = 0;
	private pendingTargetValue: InputFocusTarget | null = null;
	private scopeAdmission: ((scope: InputFocusScope) => boolean) | undefined;

	/** The frontend supplies structural admission; focus retains its own authoritative state. */
	public bindScopeAdmission(admit: (scope: InputFocusScope) => boolean): () => void {
		this.scopeAdmission = admit;
		return () => { this.scopeAdmission = undefined; };
	}

	public onDidChangeTarget(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	/** Native text owners synchronize only after an actual control interaction. */
	public notifyTargetChanged(): void {
		const revision = this.focusRevision;
		for (const listener of this.changeListeners) {
			listener();
			if (revision !== this.focusRevision) break;
		}
	}

	public createTarget(parent: InputFocusTarget | null = null,
		scope: InputFocusScope = parent === null ? new InputFocusScope(WORKBENCH_POINTER_SCOPE, this.workbenchScope) : parent.scope): InputFocusTarget {
		return new InputFocusTarget(this, parent, scope);
	}

	/** An isolated scope ends the route; it never falls back to an unrelated workbench. */
	public get commandRunner(): EditorCommandRunner | undefined {
		let scope = this.targetValue === null ? this.workbenchScope : this.targetValue.scope;
		while (scope.commands === undefined && scope.commandParent !== null) scope = scope.commandParent;
		return scope.commands;
	}

	/** Focus admission for delayed UI operations is tied to this actual control transition. */
	public get revision(): number { return this.focusRevision; }

	public get target(): InputFocusTarget | null {
		return this.targetValue;
	}
	/** The current transition owns admission until departing blur handlers finish. */
	public get pendingTarget(): InputFocusTarget | null { return this.pendingTargetValue; }

	public get admittedTarget(): InputFocusTarget | null {
		const target = this.targetValue;
		return target !== null && (target.canFocus === undefined || target.canFocus())
			&& (this.scopeAdmission === undefined || this.scopeAdmission(target.scope)) ? target : null;
	}

	public setTarget(target: InputFocusTarget | null): void {
		target = this.resolveTarget(target);
		if (target !== null && this.scopeAdmission !== undefined && !this.scopeAdmission(target.scope)) return;
		const revision = ++this.focusRevision;
		this.pendingTargetValue = target;
		const previous = this.targetValue;
		if (previous === target) { this.pendingTargetValue = null; this.notifyTargetChanged(); return; }
		// Like Godot's Viewport, detach before notifying the departing control.
		this.targetValue = null;
		if (previous !== null) previous.didBlur(target);
		if (revision !== this.focusRevision) return;
		target = this.resolveTarget(target);
		this.pendingTargetValue = null;
		this.targetValue = target;
		if (target !== null) { target.scope.lastFocused = target; target.didFocus(); }
		if (revision !== this.focusRevision) return;
		this.notifyTargetChanged();
	}

	/** A retired inline control returns to its containing focus scope. */
	public resolveTarget(target: InputFocusTarget | null): InputFocusTarget | null {
		while (target !== null && target.canFocus !== undefined && !target.canFocus()) target = target.parent;
		return target;
	}

	public getCommand(command: EditorCommandId, target: InputFocusTarget | null = this.targetValue): FocusCommand | undefined {
		return target?.getCommand(command);
	}

	public executeCommand(command: EditorCommandId, target: InputFocusTarget | null = this.targetValue): void {
		const implementation = this.getCommand(command, target);
		if (implementation !== undefined && implementation.isEnabled()) {
			implementation.run();
		}
	}

	public handleKeyboard(input: KeyInputEvent): void {
		this.admittedTarget?.handleKeyboard(input);
	}

	public handleGamepad(input: PlayerInput): void {
		this.admittedTarget?.handleGamepad(input);
	}

	public cancelInput(): void { this.targetValue?.cancelInput(); }

	/** The containing view programs its focus order, excluding disabled controls. */
	public moveFocus(backward: boolean): boolean {
		const target = this.targetValue;
		if (target === null) return false;
		const destination = backward ? target.previous : target.next;
		if (destination === null) return false;
		if (typeof destination === 'function') destination();
		else this.setTarget(destination);
		return true;
	}
}

export const inputFocus = new InputFocusService();
