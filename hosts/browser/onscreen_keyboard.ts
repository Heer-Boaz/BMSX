import type { OnScreenKeyboard } from '../common/input/on_screen_keyboard';
import { OnScreenKeyboardCommand, ON_SCREEN_KEY_DEFINITIONS } from '../common/input/on_screen_keyboard_keys';
import { BrowserKeyboardAction, BROWSER_KEYBOARD_KEY_LABELS } from './onscreen_keyboard_layout';

/** CSS keyboard presentation and native contact leases; shared model owns every key edge. */
export class BrowserOnscreenKeyboard {
	private readonly window: Window;
	private readonly panel: HTMLElement;
	private readonly pages: HTMLElement[] = [];
	private readonly actionByButton = new Map<HTMLButtonElement, BrowserKeyboardAction>();
	private readonly keyByButton = new Map<HTMLButtonElement, { readonly key: number; readonly page: number }>();
	private readonly keyButtons: HTMLButtonElement[] = [];
	private readonly keyIndices: number[] = [];
	private readonly keyLabels: string[] = [];
	private readonly renderedPressed: boolean[] = [];
	private readonly renderedHighlighted: boolean[] = [];
	private readonly renderedSelected: boolean[] = [];
	private readonly unsubscribe: () => void;
	private readonly contactIds: number[] = [];
	private readonly contactSources: number[] = [];
	private readonly contactKeys: number[] = [];
	private readonly contactActive: boolean[] = [];
	private contactCount = 0;
	private animationId = 0;
	private renderedRevision = -1;
	private renderedPage = -1;
	private renderedVisible = false;
	private modelVisible: boolean;

	public constructor(
		private readonly document: Document,
		private readonly model: OnScreenKeyboard,
		private readonly onClose: () => void,
	) {
		this.window = document.defaultView;
		this.modelVisible = model.visible;
		// gamebase.html and the package builder own the nodes; this view binds once.
		this.panel = document.getElementById('bmsx-touch-keyboard');
		const pages = this.panel.querySelectorAll<HTMLElement>('.bmsx-touch-keyboard-page');
		for (let index = 0; index < pages.length; index += 1) this.pages.push(pages[index]);
		const commands = this.panel.querySelectorAll<HTMLButtonElement>('.bmsx-touch-keyboard-command');
		for (let index = 0; index < commands.length; index += 1) {
			this.actionByButton.set(commands[index], Number(commands[index].dataset.keyboardAction));
		}
		const buttons = this.panel.querySelectorAll<HTMLButtonElement>('.bmsx-touch-key');
		for (let index = 0; index < buttons.length; index += 1) {
			const button = buttons[index];
			const key = Number(button.dataset.key);
			this.keyByButton.set(button, { key, page: Number(button.dataset.page) });
			this.keyButtons.push(button);
			this.keyIndices.push(key);
			this.keyLabels.push(button.textContent);
			this.renderedPressed.push(button.getAttribute('aria-pressed') === 'true');
			this.renderedHighlighted.push(button.getAttribute('data-highlighted') === 'true');
			this.renderedSelected.push(button.getAttribute('data-selected') === 'true');
		}
		this.unsubscribe = model.subscribe(this.modelChanged);
		this.scheduleRender();
	}

	public get visible(): boolean { return this.model.visible; }
	public ownsContact(id: number): boolean { return this.contactIndex(id) >= 0; }

	/** Every new panel contact is owned, including key gutters and page/close commands. */
	public beginContact(id: number, target: EventTarget, active: boolean): boolean {
		if (!this.panel.contains(target as Node)) return false;
		const index = this.contactCount++;
		if (index === this.contactSources.length) this.contactSources.push(this.model.allocateSource());
		this.contactIds[index] = id;
		this.contactKeys[index] = -1;
		this.contactActive[index] = active;
		// The native target owns this contact even when an earlier event in the
		// same batch closed the model. Keep the lease inert until actual up/cancel;
		// neither delayed painting nor a reopen may hand it to underlying controls.
		if (!this.model.visible) return true;
		const button = (target as Element).closest<HTMLButtonElement>('button');
		const keyTarget = this.keyByButton.get(button);
		if (keyTarget !== undefined) {
			this.contactKeys[index] = keyTarget.key;
			if (active) {
				// A native batch may already target the old page when another finger
				// changes pages. Preserve that producing page, not a guessed current one.
				this.model.selectKey(keyTarget.key, keyTarget.page);
				this.model.pressKey(this.contactSources[index], keyTarget.key);
			}
		} else if (active) {
			switch (this.actionByButton.get(button)) {
				case BrowserKeyboardAction.NextPage:
					this.model.command(this.contactSources[index], OnScreenKeyboardCommand.TogglePage);
					break;
				case BrowserKeyboardAction.Close: this.onClose(); break;
			}
		}
		return true;
	}

	/** Contact leases retain their chosen key, independently of pointer motion or page changes. */
	public moveContact(id: number, active: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		if (!this.model.visible || this.contactKeys[index] < 0 || active === this.contactActive[index]) return true;
		this.contactActive[index] = active;
		if (active) {
			this.model.pressKey(this.contactSources[index], this.contactKeys[index]);
		} else this.model.releaseSource(this.contactSources[index]);
		return true;
	}

	public endContact(id: number, cancelled: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const source = this.contactSources[index];
		// The shared source owner sees both touch and controller chords; only a
		// completed native tap can latch its genuinely unused held modifier.
		this.model.releaseSource(source, !cancelled);
		const last = --this.contactCount;
		this.contactIds[index] = this.contactIds[last];
		this.contactSources[index] = this.contactSources[last];
		this.contactKeys[index] = this.contactKeys[last];
		this.contactActive[index] = this.contactActive[last];
		this.contactSources[last] = source;
		return true;
	}

	/** Genuine page/blur/teardown cancellation, never an ordinary presentation transition. */
	public cancelContacts(): void {
		for (let index = 0; index < this.contactCount; index += 1) this.model.releaseSource(this.contactSources[index]);
		this.contactCount = 0;
		if (this.model.visible) this.onClose();
	}

	public dispose(): void {
		this.cancelContacts();
		this.unsubscribe();
		if (this.animationId) this.window.cancelAnimationFrame(this.animationId);
		this.animationId = 0;
		this.panel.hidden = true;
		this.document.body.classList.remove('bmsx-touch-keyboard-visible');
	}

	private contactIndex(id: number): number {
		for (let index = 0; index < this.contactCount; index += 1) if (this.contactIds[index] === id) return index;
		return -1;
	}

	private readonly modelChanged = (): void => {
		const visible = this.model.visible;
		if (this.modelVisible && !visible) {
			// Closing releases shared key state, but native contacts stay owned until
			// their actual up/cancel. Reopening cannot reinterpret those held fingers.
			for (let index = 0; index < this.contactCount; index += 1) this.contactKeys[index] = -1;
		}
		this.modelVisible = visible;
		this.scheduleRender();
	};

	private readonly scheduleRender = (): void => {
		if (!this.animationId) this.animationId = this.window.requestAnimationFrame(this.render);
	};

	private readonly render = (): void => {
		this.animationId = 0;
		const model = this.model;
		if (model.revision === this.renderedRevision) return;
		this.renderedRevision = model.revision;
		if (model.visible !== this.renderedVisible) {
			this.panel.hidden = !model.visible;
			this.document.body.classList.toggle('bmsx-touch-keyboard-visible', model.visible);
			this.renderedVisible = model.visible;
		}
		if (model.page !== this.renderedPage) {
			for (let page = 0; page < this.pages.length; page += 1) {
				this.pages[page].hidden = page !== model.page;
			}
			this.renderedPage = model.page;
		}
		for (let index = 0; index < this.keyButtons.length; index += 1) {
			const key = this.keyIndices[index];
			const button = this.keyButtons[index];
			const pressed = model.isKeyPressed(key);
			const highlighted = model.isKeyHighlighted(key);
			const selected = key === model.selectedKey;
			if (pressed !== this.renderedPressed[index]) {
				button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
				this.renderedPressed[index] = pressed;
			}
			if (highlighted !== this.renderedHighlighted[index]) {
				button.setAttribute('data-highlighted', highlighted ? 'true' : 'false');
				this.renderedHighlighted[index] = highlighted;
			}
			if (selected !== this.renderedSelected[index]) {
				button.setAttribute('data-selected', selected ? 'true' : 'false');
				this.renderedSelected[index] = selected;
			}
			const definition = ON_SCREEN_KEY_DEFINITIONS[key];
			const label = definition.shiftLabel === undefined ? BROWSER_KEYBOARD_KEY_LABELS[key] : model.label(key);
			if (label !== this.keyLabels[index]) {
				button.textContent = label;
				button.setAttribute('data-wide-label', label.length > 1 ? 'true' : 'false');
				this.keyLabels[index] = label;
			}
		}
	};
}
