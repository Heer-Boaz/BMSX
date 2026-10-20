import { KeyInputEvent, KeyModifier, type TextInputHost, type TextInputTarget } from '../common/input/text';
import { BrowserTextInputState } from './text_input_state';

/** The browser owns text production; the focused canvas control owns edits and history. */
export class BrowserTextInput {
	private target: TextInputTarget | undefined;
	private textarea: HTMLTextAreaElement | undefined;
	private state: BrowserTextInputState;
	private revision = -1;
	private composing = false;
	private suspended = false;
	private left = -1;
	private top = -1;
	private height = -1;
	private caretX = -1;
	private caretY = -1;
	private caretWidth = -1;
	private caretHeight = -1;
	private canvasWidth = -1;
	private canvasHeight = -1;
	private readonly compositionKeys = new Set<string>();
	private readonly unsubscribe: () => void;
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;

	public constructor(private readonly canvas: HTMLCanvasElement, private readonly host: TextInputHost) {
		this.ownerDocument = canvas.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView;
		this.unsubscribe = host.onDidChangeTarget(this.onTargetChanged);
		this.ownerWindow.addEventListener('blur', this.onWindowBlur);
		this.ownerWindow.addEventListener('focus', this.onWindowFocus);
		this.ownerWindow.addEventListener('resize', this.layout);
		this.ownerWindow.addEventListener('scroll', this.layout, true);
		this.refresh();
	}

	/** Called by the browser keyboard owner before sampled guest-key routing. */
	public readonly handleKey = (event: KeyboardEvent): boolean => {
		this.refresh();
		const down = event.type === 'keydown';
		if (!down && this.compositionKeys.delete(event.code)) return true;
		if (event.isComposing || this.composing) {
			if (down) this.compositionKeys.add(event.code);
			return this.target !== undefined;
		}
		const modifiers = (event.shiftKey ? KeyModifier.shift : 0)
			| (event.ctrlKey ? KeyModifier.ctrl : 0)
			| (event.altKey ? KeyModifier.alt : 0)
			| (event.metaKey ? KeyModifier.meta : 0);
		const handled = this.host.dispatchKey(new KeyInputEvent(event.code, modifiers, event.repeat, down));
		if (handled) event.preventDefault();
		this.refresh(handled);
		return handled || this.target !== undefined;
	};

	/** Retained revision checks avoid copying editor text during ordinary frame presentation. */
	public readonly refresh = (force = false): void => {
		const target = this.suspended ? undefined : this.host.textTarget;
		if (target !== this.target) {
			this.detach();
			this.target = target;
			if (target !== undefined) this.attach();
		} else if (target !== undefined && (force || target.revision !== this.revision)) {
			if (this.composing) {
				// Retiring the actual native context prevents a late IME event from editing new source.
				this.detach();
				this.target = target;
				this.attach();
			} else {
				this.writeState();
				this.layout();
			}
		}
		if (target !== undefined) {
			const caret = target.caretRect();
			if (caret.x !== this.caretX || caret.y !== this.caretY || caret.width !== this.caretWidth || caret.height !== this.caretHeight
				|| this.canvas.width !== this.canvasWidth || this.canvas.height !== this.canvasHeight) this.position();
		}
	};

	/** Explicit control activation may reacquire native focus; ordinary refresh never steals it. */
	public focus(): void {
		this.refresh(true);
		this.textarea?.focus({ preventScroll: true });
	}

	/** Canvas/layout owners call this only after actual geometry changes. */
	public readonly layout = (): void => {
		if (this.textarea !== undefined) this.position();
	};

	public dispose(): void {
		this.unsubscribe();
		this.ownerWindow.removeEventListener('blur', this.onWindowBlur);
		this.ownerWindow.removeEventListener('focus', this.onWindowFocus);
		this.ownerWindow.removeEventListener('resize', this.layout);
		this.ownerWindow.removeEventListener('scroll', this.layout, true);
		this.detach();
	}

	private attach(): void {
		const textarea = this.ownerDocument.createElement('textarea');
		this.textarea = textarea;
		this.left = this.top = this.height = -1;
		textarea.tabIndex = -1;
		textarea.spellcheck = false;
		textarea.autocomplete = 'off';
		textarea.autocapitalize = 'off';
		textarea.setAttribute('autocorrect', 'off');
		textarea.setAttribute('aria-label', 'BMSX text input');
		textarea.wrap = 'off';
		textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;margin:0;border:0;padding:0;resize:none;font-size:16px;overflow:hidden;';
		textarea.addEventListener('beforeinput', this.onBeforeInput);
		textarea.addEventListener('input', this.onInput);
		textarea.addEventListener('compositionstart', this.onCompositionStart);
		textarea.addEventListener('compositionend', this.onCompositionEnd);
		textarea.addEventListener('blur', this.onTextBlur);
		this.ownerDocument.body.appendChild(textarea);
		this.writeState();
		this.position();
		textarea.focus({ preventScroll: true });
	}

	private detach(): void {
		this.composing = false;
		const textarea = this.textarea;
		this.textarea = undefined;
		this.target = undefined;
		if (textarea === undefined) return;
		textarea.removeEventListener('beforeinput', this.onBeforeInput);
		textarea.removeEventListener('input', this.onInput);
		textarea.removeEventListener('compositionstart', this.onCompositionStart);
		textarea.removeEventListener('compositionend', this.onCompositionEnd);
		textarea.removeEventListener('blur', this.onTextBlur);
		textarea.remove();
	}

	private writeState(): void {
		const target = this.target!;
		const textarea = this.textarea!;
		const state = new BrowserTextInputState(target.readText());
		this.state = state;
		this.revision = target.revision;
		textarea.readOnly = target.readOnly;
		if (textarea.value !== state.text) textarea.value = state.text;
		textarea.setSelectionRange(state.selectionStart, state.selectionEnd);
	}

	private position(): void {
		const caret = this.target!.caretRect();
		this.caretX = caret.x;
		this.caretY = caret.y;
		this.caretWidth = caret.width;
		this.caretHeight = caret.height;
		this.canvasWidth = this.canvas.width;
		this.canvasHeight = this.canvas.height;
		const rect = this.canvas.getBoundingClientRect();
		const x = rect.left + caret.x * rect.width / this.canvas.width;
		const y = rect.top + caret.y * rect.height / this.canvas.height;
		const height = caret.height * rect.height / this.canvas.height;
		const style = this.textarea!.style;
		if (x !== this.left) { this.left = x; style.left = `${x}px`; }
		if (y !== this.top) { this.top = y; style.top = `${y}px`; }
		if (height !== this.height) { this.height = height; style.height = `${height}px`; }
	}

	private readonly onBeforeInput = (event: InputEvent): void => {
		this.refresh();
		if (event.currentTarget !== this.textarea || this.ownerDocument.activeElement !== this.textarea || this.target!.readOnly) event.preventDefault();
	};

	private readonly onInput = (event: InputEvent): void => {
		if (event.currentTarget !== this.textarea || this.ownerDocument.activeElement !== this.textarea || this.composing) return;
		this.commit();
	};

	private readonly onCompositionStart = (): void => {
		this.composing = true;
	};

	private readonly onTextBlur = (): void => {
		this.composing = false;
		this.host.cancelInput();
		this.writeState();
	};

	private readonly onCompositionEnd = (event: CompositionEvent): void => {
		if (event.currentTarget !== this.textarea || this.ownerDocument.activeElement !== this.textarea || !this.composing) return;
		if (this.target!.revision !== this.revision || this.target !== this.host.textTarget) {
			this.refresh();
			return;
		}
		this.composing = false;
		this.commit();
	};

	private commit(): void {
		const target = this.target!;
		if (target !== this.host.textTarget || target.revision !== this.revision) {
			this.refresh();
			return;
		}
		const textarea = this.textarea!;
		const previous = this.state;
		const text = textarea.value;
		if (text === previous.text) {
			target.setSelection(previous.ownerPosition(textarea.selectionStart), previous.ownerPosition(textarea.selectionEnd));
			this.refresh(true);
			return;
		}
		// As in VS Code's textarea state, constrain the diff by both selections.
		// This keeps a repeated character's insertion at the actual caret, not an arbitrary equal prefix.
		const prefixLimit = Math.min(previous.selectionStart, textarea.selectionStart);
		let prefix = 0;
		while (prefix < prefixLimit && previous.text.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
		const suffixLimit = Math.min(previous.text.length - previous.selectionEnd,
			text.length - textarea.selectionEnd, previous.text.length - prefix, text.length - prefix);
		let suffix = 0;
		while (suffix < suffixLimit && previous.text.charCodeAt(previous.text.length - suffix - 1) === text.charCodeAt(text.length - suffix - 1)) suffix++;
		const end = previous.text.length - suffix;
		const inserted = text.slice(prefix, text.length - suffix);
		const selectionStart = previous.ownerPositionAfterEdit(textarea.selectionStart, prefix, end, inserted.length);
		const selectionEnd = previous.ownerPositionAfterEdit(textarea.selectionEnd, prefix, end, inserted.length);
		if (target.replaceText(previous.ownerPosition(prefix), previous.ownerPosition(end), inserted)) {
			target.setSelection(selectionStart, selectionEnd);
		}
		this.refresh(true);
	}

	private readonly onTargetChanged = (): void => {
		this.focus();
	};

	private readonly onWindowBlur = (): void => {
		this.suspended = true;
		this.compositionKeys.clear();
		this.host.cancelInput();
		this.refresh();
	};

	private readonly onWindowFocus = (): void => {
		this.suspended = false;
		this.refresh();
	};
}
