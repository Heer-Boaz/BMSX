import type { EditorCommandRunner } from '../../common/commands';
import { showEditorMessage } from '../../common/feedback_state';
import type { HostClock, TimerHandle } from '../../../hosts/common/clock';
import type { InputFocusService, InputFocusTarget } from '../focus';
import { editorKeybindingStrokeLabel, resolveEditorCommandKeybinding, type EditorCommandKeybinding, type EditorKeybindingPress } from './command_keybindings';
import { consumeIdeKey } from './key_input';
import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';

/** One application command route owns draft settlement and the captured local subject. */
function runKeybinding(focus: InputFocusService, binding: EditorCommandKeybinding, event: KeyInputEvent, commands: EditorCommandRunner | undefined, target: InputFocusTarget | null): void {
	consumeIdeKey(event.code, event);
	if (commands !== undefined) {
		commands.execute(binding.command, target);
		return;
	}
	// Without an application owner, resolution has admitted the actual local capability.
	focus.executeCommand(binding.command, target);
}

const CHORD_TIMEOUT_MS = 5000;

/** The frontend owns an in-flight chord, not the focused pane or a module singleton. */
export class EditorCommandKeybindingController {
	private prefix: EditorKeybindingPress | undefined;
	private origin: InputFocusTarget | null = null;
	private timer: TimerHandle | undefined;
	private prefixLabel: string | undefined;
	private unbindFocus: (() => void) | undefined;
	private unbindInput: (() => void) | undefined;
	private unbindContext: (() => void) | undefined;
	private readonly cancelPending = () => this.cancel();
	private readonly validateOrigin = () => {
		if (this.focus.admittedTarget !== this.origin) this.cancel();
	};
	public constructor(private readonly focus: InputFocusService, private readonly clock: HostClock) {}
	public get inChordMode(): boolean { return this.prefix !== undefined; }
	/** Existing status chrome presents this hint without allocating another row. */
	public get pendingLabel(): string | undefined { return this.prefixLabel; }

	public handle(event: KeyInputEvent, commands: EditorCommandRunner | undefined, target: InputFocusTarget | null = this.focus.admittedTarget): boolean {
		if (target?.guestInput !== undefined) { this.cancel(); return false; }
		if (!event.down || event.consumed) return false;
		if (this.prefix === undefined) {
			const binding = resolveEditorCommandKeybinding(event.code, event.modifiers, commands, target);
			if (binding === null || event.repeat && !binding.repeat) return false;
			if (binding.chord === undefined) { runKeybinding(this.focus, binding, event, commands, target); return true; }
			if (event.repeat) return false;
			consumeIdeKey(event.code, event);
			this.prefix = event;
			this.origin = target;
			this.prefixLabel = `${editorKeybindingStrokeLabel(binding)}: waiting for second key.`;
			this.unbindFocus = this.focus.onDidChangeTarget(this.validateOrigin);
			this.unbindInput = target?.onDidCancelInput(this.cancelPending);
			this.unbindContext = (target === null ? this.focus.workbenchScope : target.scope).onDidRetireContext(this.cancelPending);
			this.timer = this.clock.scheduleOnce(CHORD_TIMEOUT_MS, this.cancelPending);
			return true;
		}
		if (target !== this.origin) { this.cancel(); return false; }
		if (event.code.startsWith('Control') || event.code.startsWith('Meta') || event.code.startsWith('Alt') || event.code.startsWith('Shift')) return false;
		if (event.repeat) { consumeIdeKey(event.code, event); return true; }
		if (event.code === 'Escape') { this.cancel(); consumeIdeKey(event.code, event); return true; }
		const binding = resolveEditorCommandKeybinding(event.code, event.modifiers, commands, target, this.prefix);
		this.cancel();
		if (binding === null) {
			// A failed chord must not steal modified arrow navigation or OS window keys.
			if (event.modifiers !== KeyModifier.none && event.code.startsWith('Arrow')) return false;
			consumeIdeKey(event.code, event);
			showEditorMessage('Key chord is not bound.', 'info', 2);
			return true;
		}
		runKeybinding(this.focus, binding, event, commands, target);
		return true;
	}

	public cancel(): void {
		if (this.prefix === undefined) return;
		this.prefix = undefined; this.prefixLabel = undefined; this.origin = null;
		this.timer!.cancel(); this.timer = undefined;
		this.unbindFocus!(); this.unbindFocus = undefined;
		this.unbindInput?.(); this.unbindInput = undefined;
		this.unbindContext!(); this.unbindContext = undefined;
	}

	public dispose(): void { this.cancel(); }
}
