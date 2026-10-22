/** Host editing events are ordered actions, not sampled guest key state. */
export enum KeyModifier {
	none = 0,
	shift = 1 << 0,
	ctrl = 1 << 1,
	alt = 1 << 2,
	meta = 1 << 3,
}

export interface ModifierState {
	readonly modifiers: KeyModifier;
}

export const enum KeyInputSource { Physical, Virtual }

export class KeyInputEvent implements ModifierState {
	public consumed = false;
	public constructor(public readonly code: string, public readonly modifiers: KeyModifier, public readonly repeat = false,
		public readonly down = true, public readonly source = KeyInputSource.Physical) {}
}

/** Native editing context. Offsets and selections use UTF-16, like editor buffers. */
export type TextInputState = {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	offset: number;
};

/** The concrete focused control owns source edits, selection and history. */
export interface TextInputTarget {
	readonly readOnly: boolean;
	readonly revision: number;
	readText(): TextInputState;
	/** False leaves selection with the control when its input constraints changed/rejected text. */
	replaceText(from: number, to: number, text: string): boolean;
	setSelection(from: number, to: number): void;
	caretRect(): { x: number; y: number; width: number; height: number };
}

export interface TextInputHost {
	readonly textTarget: TextInputTarget | undefined;
	dispatchKey(event: KeyInputEvent): boolean;
	/** Pointer source retirement does not cancel keyboard/text gestures. */
	cancelPointerInput(): void;
	cancelInput(): void;
	onDidChangeTarget(listener: () => void): () => void;
}
