export type TuiKey = {
	name: string;
	ctrl?: boolean;
	shift?: boolean;
	meta?: boolean;
};

export type TuiMouseEvent = {
	type: 'mouse';
	x: number;
	y: number;
	subX: number;
	subY: number;
	button: 'left' | 'middle' | 'right' | 'wheelup' | 'wheeldown' | 'none';
	action: 'down' | 'up' | 'drag' | 'move' | 'scroll';
	ctrl: boolean;
	shift: boolean;
	meta: boolean;
};

export type TuiInputEvent =
	| { type: 'key'; key: TuiKey; ch: string | undefined }
	| { type: 'resize' }
	| TuiMouseEvent;

export class TuiInput {
	private queue: TuiInputEvent[] = [];
	private resolver: ((event: TuiInputEvent) => void) | null = null;
	private pending = '';
	private pixelMouseEnabled = false;
	private cellPixelWidth = 0;
	private cellPixelHeight = 0;
	private readonly useSgrMouseProfile = this.detectSgrMouseProfile();

	private onData = (chunk: Buffer) => {
		this.pending += chunk.toString('latin1');
		this.parsePending();
	};

	private onResize = () => {
		if (this.useSgrMouseProfile) {
			process.stdout.write('\x1b[16t');
		}
		this.push({ type: 'resize' });
	};

	init(): void {
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on('data', this.onData);
		process.stdout.on('resize', this.onResize);
		process.stdout.write(this.useSgrMouseProfile
			? '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[16t'
			: '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1005h');
	}

	restore(): void {
		process.stdin.off('data', this.onData);
		process.stdout.off('resize', this.onResize);
		process.stdout.write(this.useSgrMouseProfile
			? '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1016l'
			: '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l');
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();
		this.pending = '';
		this.pixelMouseEnabled = false;
		this.cellPixelWidth = 0;
		this.cellPixelHeight = 0;
	}

	private detectSgrMouseProfile(): boolean {
		if (process.env.WT_SESSION) {
			return false;
		}
		return !!(process.env.VTE_VERSION || process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_CWD);
	}

	async nextEvent(): Promise<TuiInputEvent> {
		if (this.queue.length > 0) {
			return this.queue.shift()!;
		}
		return new Promise<TuiInputEvent>(resolve => {
			this.resolver = resolve;
		});
	}

	private parsePending(): void {
		while (this.pending.length > 0) {
			if (this.pending.startsWith('\x1b[<')) {
				const mouseResult = this.tryParseSgrMouse();
				if (mouseResult === 'wait') {
					return;
				}
				if (mouseResult) {
					continue;
				}
			}
			if (this.pending.startsWith('\x1b[M')) {
				const utfMouseResult = this.tryParseUtfMouse();
				if (utfMouseResult === 'wait') {
					return;
				}
				if (utfMouseResult) {
					continue;
				}
				const x10MouseResult = this.tryParseX10Mouse();
				if (x10MouseResult === 'wait') {
					return;
				}
				if (x10MouseResult) {
					continue;
				}
			}
			if (this.pending.startsWith('\x1b[6;')) {
				const sizeResult = this.tryParseCellSize();
				if (sizeResult === 'wait') {
					return;
				}
				if (sizeResult) {
					continue;
				}
			}
			if (this.pending.startsWith('\x1b[')) {
				const csiKeyResult = this.tryParseCsiKey();
				if (csiKeyResult === 'wait') {
					return;
				}
				if (csiKeyResult) {
					continue;
				}
			}
			if (this.pending.startsWith('\x1bO')) {
				const ss3KeyResult = this.tryParseSs3Key();
				if (ss3KeyResult === 'wait') {
					return;
				}
				if (ss3KeyResult) {
					continue;
				}
			}
			if (this.pending[0] === '\x1b') {
				if (this.pending.length === 1) {
					return;
				}
				this.pending = this.pending.slice(1);
				this.pushKey('escape');
				continue;
			}
			this.parsePlainKey();
		}
	}

	private tryParseCellSize(): boolean | 'wait' {
		const match = this.pending.match(/^\x1b\[6;(\d+);(\d+)t/);
		if (!match) {
			return 'wait';
		}
		this.pending = this.pending.slice(match[0].length);
		this.cellPixelHeight = Number.parseInt(match[1], 10);
		this.cellPixelWidth = Number.parseInt(match[2], 10);
		if (!this.pixelMouseEnabled) {
			process.stdout.write('\x1b[?1016h');
			this.pixelMouseEnabled = true;
		}
		return true;
	}

	private tryParseSgrMouse(): boolean | 'wait' {
		const match = this.pending.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
		if (!match) {
			return 'wait';
		}
		this.pending = this.pending.slice(match[0].length);
		const code = Number.parseInt(match[1], 10);
		const suffix = match[4];
		const shift = (code & 4) !== 0;
		const meta = (code & 8) !== 0;
		const ctrl = (code & 16) !== 0;
		const motion = (code & 32) !== 0;
		const wheel = (code & 64) !== 0;
		const position = this.resolveMousePosition(Number.parseInt(match[2], 10) - 1, Number.parseInt(match[3], 10) - 1);
		if (wheel) {
			this.pushMouse(position, (code & 1) === 0 ? 'wheelup' : 'wheeldown', 'scroll', ctrl, shift, meta);
			return true;
		}
		const buttonIndex = code & 3;
		const button = buttonIndex === 0 ? 'left' : buttonIndex === 1 ? 'middle' : buttonIndex === 2 ? 'right' : 'none';
		const action = suffix === 'm' ? 'up' : motion ? (button === 'none' ? 'move' : 'drag') : 'down';
		this.pushMouse(position, button, action, ctrl, shift, meta);
		return true;
	}

	private tryParseX10Mouse(): boolean | 'wait' {
		if (this.pending.length < 6) {
			return 'wait';
		}
		const code = this.pending.charCodeAt(3) - 32;
		const rawX = this.pending.charCodeAt(4) - 33;
		const rawY = this.pending.charCodeAt(5) - 33;
		this.pending = this.pending.slice(6);
		const shift = (code & 4) !== 0;
		const meta = (code & 8) !== 0;
		const ctrl = (code & 16) !== 0;
		const motion = (code & 32) !== 0;
		const wheel = (code & 64) !== 0;
		const position = this.resolveMousePosition(rawX, rawY);
		if (wheel) {
			this.pushMouse(position, (code & 1) === 0 ? 'wheelup' : 'wheeldown', 'scroll', ctrl, shift, meta);
			return true;
		}
		const buttonIndex = code & 3;
		const isRelease = buttonIndex === 3 && !motion;
		const button = isRelease ? 'none' : buttonIndex === 0 ? 'left' : buttonIndex === 1 ? 'middle' : buttonIndex === 2 ? 'right' : 'none';
		const action = isRelease ? 'up' : motion ? (button === 'none' ? 'move' : 'drag') : 'down';
		this.pushMouse(position, button, action, ctrl, shift, meta);
		return true;
	}

	private tryParseUtfMouse(): boolean | 'wait' {
		const button = this.decodeUtf8CodePoint(3);
		if (button === 'wait') {
			return 'wait';
		}
		if (!button) {
			return false;
		}
		const x = this.decodeUtf8CodePoint(button.nextOffset);
		if (x === 'wait') {
			return 'wait';
		}
		if (!x) {
			return false;
		}
		const y = this.decodeUtf8CodePoint(x.nextOffset);
		if (y === 'wait') {
			return 'wait';
		}
		if (!y) {
			return false;
		}
		const sequenceLength = y.nextOffset;
		if (sequenceLength === 6 && button.codePoint < 0x80 && x.codePoint < 0x80 && y.codePoint < 0x80) {
			return false;
		}
		this.pending = this.pending.slice(sequenceLength);
		const code = button.codePoint - 32;
		const rawX = x.codePoint - 33;
		const rawY = y.codePoint - 33;
		const shift = (code & 4) !== 0;
		const meta = (code & 8) !== 0;
		const ctrl = (code & 16) !== 0;
		const motion = (code & 32) !== 0;
		const wheel = (code & 64) !== 0;
		const position = this.resolveMousePosition(rawX, rawY);
		if (wheel) {
			this.pushMouse(position, (code & 1) === 0 ? 'wheelup' : 'wheeldown', 'scroll', ctrl, shift, meta);
			return true;
		}
		const buttonIndex = code & 3;
		const isRelease = buttonIndex === 3 && !motion;
		const mouseButton = isRelease ? 'none' : buttonIndex === 0 ? 'left' : buttonIndex === 1 ? 'middle' : buttonIndex === 2 ? 'right' : 'none';
		const action = isRelease ? 'up' : motion ? (mouseButton === 'none' ? 'move' : 'drag') : 'down';
		this.pushMouse(position, mouseButton, action, ctrl, shift, meta);
		return true;
	}

	private tryParseCsiKey(): boolean | 'wait' {
		if (/^\x1b\[[0-9;]*$/.test(this.pending)) {
			return 'wait';
		}
		const match = this.pending.match(/^\x1b\[([0-9;]*)([~A-Za-z])/);
		if (!match) {
			return false;
		}
		this.pending = this.pending.slice(match[0].length);
		const params = match[1].length > 0 ? match[1].split(';').map(value => Number.parseInt(value, 10)) : [];
		const final = match[2];
		const modifier = params.length >= 2 ? params[params.length - 1] : 1;
		const flags = this.decodeModifier(modifier);
		if (final === 'A') return this.pushKey('up', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === 'B') return this.pushKey('down', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === 'C') return this.pushKey('right', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === 'D') return this.pushKey('left', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === 'H') return this.pushKey('home', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === 'F') return this.pushKey('end', undefined, flags.ctrl, flags.shift, flags.meta), true;
		if (final === '~') {
			const code = params[0];
			if (code === 1 || code === 7) return this.pushKey('home', undefined, flags.ctrl, flags.shift, flags.meta), true;
			if (code === 4 || code === 8) return this.pushKey('end', undefined, flags.ctrl, flags.shift, flags.meta), true;
			if (code === 5) return this.pushKey('pageup', undefined, flags.ctrl, flags.shift, flags.meta), true;
			if (code === 6) return this.pushKey('pagedown', undefined, flags.ctrl, flags.shift, flags.meta), true;
		}
		return false;
	}

	private tryParseSs3Key(): boolean | 'wait' {
		if (this.pending.length < 3) {
			return 'wait';
		}
		const match = this.pending.match(/^\x1bO([ABCDHF])/);
		if (!match) {
			return false;
		}
		this.pending = this.pending.slice(match[0].length);
		const final = match[1];
		if (final === 'A') return this.pushKey('up'), true;
		if (final === 'B') return this.pushKey('down'), true;
		if (final === 'C') return this.pushKey('right'), true;
		if (final === 'D') return this.pushKey('left'), true;
		if (final === 'H') return this.pushKey('home'), true;
		if (final === 'F') return this.pushKey('end'), true;
		return false;
	}

	private parsePlainKey(): void {
		const code = this.pending.charCodeAt(0);
		const ch = this.pending[0];
		this.pending = this.pending.slice(1);
		if (code === 3) {
			this.pushKey('c', undefined, true);
			return;
		}
		if (code === 13 || code === 10) {
			this.pushKey('return', '\n');
			return;
		}
		if (code === 127 || code === 8) {
			this.pushKey('backspace');
			return;
		}
		if (code === 9) {
			this.pushKey('tab', '\t');
			return;
		}
		if (code > 0 && code < 27) {
			this.pushKey(String.fromCharCode(code + 96), undefined, true);
			return;
		}
		const shift = ch >= 'A' && ch <= 'Z';
		this.pushKey(ch.toLowerCase(), ch, false, shift);
	}

	private decodeModifier(value: number): { shift: boolean; meta: boolean; ctrl: boolean } {
		switch (value) {
			case 2: return { shift: true, meta: false, ctrl: false };
			case 3: return { shift: false, meta: true, ctrl: false };
			case 4: return { shift: true, meta: true, ctrl: false };
			case 5: return { shift: false, meta: false, ctrl: true };
			case 6: return { shift: true, meta: false, ctrl: true };
			case 7: return { shift: false, meta: true, ctrl: true };
			case 8: return { shift: true, meta: true, ctrl: true };
			default: return { shift: false, meta: false, ctrl: false };
		}
	}

	private decodeUtf8CodePoint(offset: number): { codePoint: number; nextOffset: number } | null | 'wait' {
		if (offset >= this.pending.length) {
			return 'wait';
		}
		const first = this.pending.charCodeAt(offset);
		if (first < 0x80) {
			return { codePoint: first, nextOffset: offset + 1 };
		}
		if ((first & 0xe0) === 0xc0) {
			if (offset + 1 >= this.pending.length) {
				return 'wait';
			}
			const second = this.pending.charCodeAt(offset + 1);
			if ((second & 0xc0) !== 0x80) {
				return null;
			}
			return {
				codePoint: ((first & 0x1f) << 6) | (second & 0x3f),
				nextOffset: offset + 2,
			};
		}
		if ((first & 0xf0) === 0xe0) {
			if (offset + 2 >= this.pending.length) {
				return 'wait';
			}
			const second = this.pending.charCodeAt(offset + 1);
			const third = this.pending.charCodeAt(offset + 2);
			if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
				return null;
			}
			return {
				codePoint: ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
				nextOffset: offset + 3,
			};
		}
		return null;
	}

	private resolveMousePosition(rawX: number, rawY: number) {
		if (!this.pixelMouseEnabled) {
			return { x: rawX, y: rawY, subX: 0.5, subY: 0.5 };
		}
		const x = Math.floor(rawX / this.cellPixelWidth);
		const y = Math.floor(rawY / this.cellPixelHeight);
		const subX = (rawX - x * this.cellPixelWidth) / this.cellPixelWidth;
		const subY = (rawY - y * this.cellPixelHeight) / this.cellPixelHeight;
		return { x, y, subX, subY };
	}

	private pushMouse(
		position: { x: number; y: number; subX: number; subY: number },
		button: TuiMouseEvent['button'],
		action: TuiMouseEvent['action'],
		ctrl: boolean,
		shift: boolean,
		meta: boolean,
	): void {
		this.push({
			type: 'mouse',
			x: position.x,
			y: position.y,
			subX: position.subX,
			subY: position.subY,
			button,
			action,
			ctrl,
			shift,
			meta,
		});
	}

	private pushKey(name: string, ch?: string, ctrl = false, shift = false, meta = false): void {
		this.push({
			type: 'key',
			key: { name, ctrl, shift, meta },
			ch,
		});
	}

	private push(event: TuiInputEvent): void {
		if (this.resolver) {
			const resolve = this.resolver;
			this.resolver = null;
			resolve(event);
			return;
		}
		this.queue.push(event);
	}
}
