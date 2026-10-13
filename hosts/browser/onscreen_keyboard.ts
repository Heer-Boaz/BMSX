import type { OnScreenKeyboard } from '../common/input/on_screen_keyboard';
import { KeyboardPage, ON_SCREEN_KEY_DEFINITIONS } from '../common/input/on_screen_keyboard_keys';
import { BROWSER_KEYBOARD_PAGES } from './onscreen_keyboard_layout';
import { BROWSER_ONSCREEN_KEYBOARD_STYLE } from './onscreen_keyboard_style';

const PAGE_LABELS = ['Letters', '123', 'Fn'] as const;

/** CSS keyboard presentation and native contact leases; shared model owns every key edge. */
export class BrowserOnscreenKeyboard {
	private readonly window: Window;
	private readonly panel: HTMLElement;
	private readonly style: HTMLStyleElement;
	private readonly pages: HTMLElement[] = [];
	private readonly pageButtons: HTMLButtonElement[] = [];
	private readonly pageByButton = new Map<HTMLButtonElement, KeyboardPage>();
	private readonly keyByButton = new Map<HTMLButtonElement, { readonly key: number; readonly page: KeyboardPage }>();
	private readonly keyButtons: HTMLButtonElement[] = [];
	private readonly keyIndices: number[] = [];
	private readonly keyLabels: string[] = [];
	private readonly renderedPressed: boolean[] = [];
	private readonly renderedHighlighted: boolean[] = [];
	private readonly renderedSelected: boolean[] = [];
	private readonly closeButton: HTMLButtonElement;
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
		this.style = document.createElement('style');
		this.style.textContent = BROWSER_ONSCREEN_KEYBOARD_STYLE;
		document.head.appendChild(this.style);
		this.panel = document.createElement('section');
		this.panel.className = 'bmsx-touch-keyboard';
		this.panel.setAttribute('aria-label', 'On-screen keyboard');
		this.panel.hidden = true;
		const toolbar = document.createElement('nav');
		toolbar.className = 'bmsx-touch-keyboard-toolbar';
		toolbar.setAttribute('aria-label', 'Keyboard pages');
		this.panel.appendChild(toolbar);
		for (let pageIndex = 0; pageIndex < BROWSER_KEYBOARD_PAGES.length; pageIndex += 1) {
			const button = document.createElement('button');
			button.type = 'button';
			button.tabIndex = -1;
			button.className = 'bmsx-touch-keyboard-tab';
			button.textContent = PAGE_LABELS[pageIndex];
			button.setAttribute('aria-pressed', 'false');
			toolbar.appendChild(button);
			this.pageButtons.push(button);
			this.pageByButton.set(button, pageIndex);
			const definition = BROWSER_KEYBOARD_PAGES[pageIndex];
			const page = document.createElement('div');
			page.className = 'bmsx-touch-keyboard-page';
			page.hidden = true;
			let units = 0;
			for (const row of definition.rows) units = Math.max(units, row.units);
			page.style.setProperty('--page-units', `${units}`);
			for (const row of definition.rows) {
				const rowElement = document.createElement('div');
				rowElement.className = 'bmsx-touch-keyboard-row';
				rowElement.style.setProperty('--row-units', `${row.units}`);
				for (let column = 0; column < row.keys.length; column += 1) {
					const key = row.keys[column];
					const slot = document.createElement('div');
					slot.className = 'bmsx-touch-keyboard-slot';
					slot.style.setProperty('--key-span', `${row.spans[column]}`);
					const button = document.createElement('button');
					button.type = 'button';
					button.tabIndex = -1;
					button.className = 'bmsx-touch-key';
					button.setAttribute('data-code', ON_SCREEN_KEY_DEFINITIONS[key].code);
					button.setAttribute('aria-label', ON_SCREEN_KEY_DEFINITIONS[key].label);
					button.setAttribute('aria-pressed', 'false');
					button.setAttribute('data-selected', 'false');
					button.setAttribute('data-highlighted', 'false');
					slot.appendChild(button);
					rowElement.appendChild(slot);
					this.keyByButton.set(button, { key, page: pageIndex });
					this.keyButtons.push(button);
					this.keyIndices.push(key);
					this.keyLabels.push('');
					this.renderedPressed.push(false);
					this.renderedHighlighted.push(false);
					this.renderedSelected.push(false);
				}
				page.appendChild(rowElement);
			}
			this.pages.push(page);
			this.panel.appendChild(page);
		}
		this.closeButton = document.createElement('button');
		this.closeButton.type = 'button';
		this.closeButton.tabIndex = -1;
		this.closeButton.className = 'bmsx-touch-keyboard-close';
		this.closeButton.textContent = 'Close';
		this.closeButton.setAttribute('aria-label', 'Close on-screen keyboard');
		toolbar.appendChild(this.closeButton);
		document.getElementById('player-surface').appendChild(this.panel);
		this.unsubscribe = model.subscribe(this.modelChanged);
		this.scheduleRender();
	}

	public get visible(): boolean { return this.model.visible; }
	public ownsContact(id: number): boolean { return this.contactIndex(id) >= 0; }

	/** Every new panel contact is owned, including key gutters and page/close commands. */
	public beginContact(id: number, target: EventTarget, active: boolean): boolean {
		if (!this.model.visible || !this.panel.contains(target as Node)) return false;
		const index = this.contactCount++;
		if (index === this.contactSources.length) this.contactSources.push(this.model.allocateSource());
		this.contactIds[index] = id;
		this.contactKeys[index] = -1;
		this.contactActive[index] = active;
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
			const page = this.pageByButton.get(button);
			if (page !== undefined) this.model.setPage(page);
			else if (button === this.closeButton) this.onClose();
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
		this.panel.remove();
		this.style.remove();
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
				this.pageButtons[page].setAttribute('aria-pressed', page === model.page ? 'true' : 'false');
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
			const code = ON_SCREEN_KEY_DEFINITIONS[key].code;
			const label = code === 'ArrowLeft' ? '←' : code === 'ArrowDown' ? '↓' : code === 'ArrowUp' ? '↑'
				: code === 'ArrowRight' ? '→' : code === 'ShiftLeft' ? '⇧' : code === 'Backspace' ? '⌫' : model.label(key);
			if (label !== this.keyLabels[index]) {
				button.textContent = label;
				button.setAttribute('data-wide-label', label.length > 1 ? 'true' : 'false');
				this.keyLabels[index] = label;
			}
		}
	};
}
