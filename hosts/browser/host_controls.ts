/** Native host commands keep their own contact leases, never guest gamepad bits. */
export class BrowserHostControls {
	private readonly buttons: readonly HTMLButtonElement[];
	private readonly commands: readonly (() => void)[];
	private readonly contactIds: number[] = [];
	private readonly contactButtons: number[] = [];
	private readonly contactPressed: boolean[] = [];
	private readonly contactEligible: boolean[] = [];
	private readonly buttonContacts = new Uint32Array(2);
	private readonly buttonPressed = new Uint32Array(2);
	private readonly buttonActivated = new Uint8Array(2);
	private readonly buttonBounds = new Float64Array(6);
	private contactCount = 0;

	public constructor(document: Document, onKeyboard: () => void, onMenu: () => void) {
		this.buttons = [
			document.getElementById('host-keyboard-control') as HTMLButtonElement,
			document.getElementById('host-menu-control') as HTMLButtonElement,
		];
		this.commands = [onKeyboard, onMenu];
		for (const button of this.buttons) button.addEventListener('click', this.onClick);
	}

	public ownsContact(id: number): boolean { return this.contactIndex(id) >= 0; }

	/** The original host command owns a contact until its actual native up/cancel. */
	public beginContact(id: number, target: EventTarget, x: number, y: number, active: boolean): boolean {
		let button = -1;
		for (let index = 0; index < this.buttons.length; index += 1) {
			if (this.buttons[index].contains(target as Node)) { button = index; break; }
		}
		if (button < 0) return false;
		const index = this.contactCount++;
		this.contactIds[index] = id;
		this.contactButtons[index] = button;
		this.contactPressed[index] = false;
		this.contactEligible[index] = active && !this.buttons[button].hidden;
		if (this.buttonContacts[button]++ === 0) this.buttonActivated[button] = 0;
		// Layout reads happen only at native contact boundaries, never on moves.
		const bounds = this.buttons[button].getBoundingClientRect();
		const offset = button * 3;
		const radius = bounds.width / 2;
		this.buttonBounds[offset] = bounds.left + radius;
		this.buttonBounds[offset + 1] = bounds.top + bounds.height / 2;
		this.buttonBounds[offset + 2] = radius * radius;
		const dx = x - this.buttonBounds[offset];
		const dy = y - this.buttonBounds[offset + 1];
		this.setPressed(index, this.contactEligible[index] && dx * dx + dy * dy <= this.buttonBounds[offset + 2]);
		return true;
	}

	public moveContact(id: number, x: number, y: number, active: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		if (!active || this.buttons[this.contactButtons[index]].hidden) this.contactEligible[index] = false;
		const offset = this.contactButtons[index] * 3;
		const dx = x - this.buttonBounds[offset];
		const dy = y - this.buttonBounds[offset + 1];
		this.setPressed(index, this.contactEligible[index] && dx * dx + dy * dy <= this.buttonBounds[offset + 2]);
		return true;
	}

	/** One successful release activates each overlapping-finger group at most once. */
	public endContact(id: number, x: number, y: number, cancelled: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const button = this.contactButtons[index];
		let activate = false;
		if (!cancelled && this.contactEligible[index] && !this.buttons[button].hidden && this.buttonActivated[button] === 0) {
			const bounds = this.buttons[button].getBoundingClientRect();
			const radius = bounds.width / 2;
			const dx = x - bounds.left - radius;
			const dy = y - bounds.top - bounds.height / 2;
			activate = dx * dx + dy * dy <= radius * radius;
			if (activate) this.buttonActivated[button] = 1;
		}
		this.setPressed(index, false);
		this.buttonContacts[button] -= 1;
		const last = --this.contactCount;
		this.contactIds[index] = this.contactIds[last];
		this.contactButtons[index] = this.contactButtons[last];
		this.contactPressed[index] = this.contactPressed[last];
		this.contactEligible[index] = this.contactEligible[last];
		if (activate) this.commands[button]();
		return true;
	}

	public cancelContacts(): void {
		this.contactCount = 0;
		this.buttonContacts.fill(0);
		this.buttonPressed.fill(0);
		this.buttonActivated.fill(0);
		for (const button of this.buttons) button.setAttribute('aria-pressed', 'false');
	}

	public dispose(): void {
		this.cancelContacts();
		for (const button of this.buttons) button.removeEventListener('click', this.onClick);
	}

	private contactIndex(id: number): number {
		for (let index = 0; index < this.contactCount; index += 1) if (this.contactIds[index] === id) return index;
		return -1;
	}

	private setPressed(index: number, pressed: boolean): void {
		if (pressed === this.contactPressed[index]) return;
		this.contactPressed[index] = pressed;
		const button = this.contactButtons[index];
		const previous = this.buttonPressed[button];
		const next = previous + (pressed ? 1 : -1);
		this.buttonPressed[button] = next;
		if ((previous === 0) !== (next === 0)) this.buttons[button].setAttribute('aria-pressed', next !== 0 ? 'true' : 'false');
	}

	/** Pointer releases already dispatched the command; native AT clicks have detail zero. */
	private readonly onClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopImmediatePropagation();
		const button = event.currentTarget as HTMLButtonElement;
		if (event.detail === 0 && !button.hidden) this.commands[this.buttons.indexOf(button)]();
	};
}
