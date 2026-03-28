import * as readline from 'node:readline';

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
	pixelX?: number;
	pixelY?: number;
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
	private suppressKeypress = false;
	private pixelMouseEnabled = false;
	private cellPixelWidth = 0;
	private cellPixelHeight = 0;
	private onData = (chunk: Buffer) => {
		const text = chunk.toString('utf8');
		const hasControlSequence = this.pending.length > 0 || text.indexOf('\x1b[<') !== -1 || text.indexOf('\x1b[6;') !== -1;
		if (!hasControlSequence) {
			return;
		}
		this.suppressKeypress = true;
		queueMicrotask(() => {
			this.suppressKeypress = false;
		});
		this.pending += text;
		this.parsePending();
	};
	private onKeypress = (ch: string | undefined, key: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string }) => {
		if (this.suppressKeypress) {
			return;
		}
		if (key.sequence?.startsWith('\x1b[<')) {
			return;
		}
		const name = key.name ?? ch!.toLowerCase();
		this.push({
			type: 'key',
			key: { name, ctrl: key.ctrl, shift: key.shift, meta: key.meta },
			ch,
		});
	};
	private onResize = () => {
		process.stdout.write('\x1b[16t');
		this.push({ type: 'resize' });
	};

	init(): void {
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on('data', this.onData);
		readline.emitKeypressEvents(process.stdin);
		process.stdin.on('keypress', this.onKeypress);
		process.stdout.on('resize', this.onResize);
		process.stdout.write('\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[16t');
	}

	restore(): void {
		process.stdin.off('data', this.onData);
		process.stdin.off('keypress', this.onKeypress);
		process.stdout.off('resize', this.onResize);
		process.stdout.write('\x1b[?1000l\x1b[?1003l\x1b[?1006l\x1b[?1016l');
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();
		this.pending = '';
		this.suppressKeypress = false;
		this.pixelMouseEnabled = false;
		this.cellPixelWidth = 0;
		this.cellPixelHeight = 0;
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
			if (this.pending.startsWith('\x1b[6;')) {
				const sizeResult = this.tryParseCellSize();
				if (sizeResult === 'wait') {
					return;
				}
				if (sizeResult) {
					continue;
				}
			}
			const mouseStart = this.pending.indexOf('\x1b[<');
			const cellSizeStart = this.pending.indexOf('\x1b[6;');
			const start = Math.min(this.indexOrMax(mouseStart), this.indexOrMax(cellSizeStart));
			if (start === Number.MAX_SAFE_INTEGER) {
				this.pending = '';
				return;
			}
			if (start > 0) {
				this.pending = this.pending.slice(start);
			}
			const mouseResult = this.tryParseMouse();
			if (mouseResult === 'wait') {
				return;
			}
			if (!mouseResult) {
				throw new Error(`Failed to parse mouse input: ${JSON.stringify(this.pending)}`);
			}
		}
	}

	private indexOrMax(value: number): number {
		return value === -1 ? Number.MAX_SAFE_INTEGER : value;
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

	private tryParseMouse(): boolean | 'wait' {
		if (!this.pending.startsWith('\x1b[<')) {
			return false;
		}
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
		if (wheel) {
			const position = this.resolveMousePosition(match[2], match[3]);
			this.push({
				type: 'mouse',
				x: position.x,
				y: position.y,
				subX: position.subX,
				subY: position.subY,
				pixelX: position.pixelX,
				pixelY: position.pixelY,
				button: (code & 1) === 0 ? 'wheelup' : 'wheeldown',
				action: 'scroll',
				ctrl,
				shift,
				meta,
			});
			return true;
		}
		const buttonIndex = code & 3;
		const button = buttonIndex === 0 ? 'left' : buttonIndex === 1 ? 'middle' : buttonIndex === 2 ? 'right' : 'none';
		const position = this.resolveMousePosition(match[2], match[3]);
		this.push({
			type: 'mouse',
			x: position.x,
			y: position.y,
			subX: position.subX,
			subY: position.subY,
			pixelX: position.pixelX,
			pixelY: position.pixelY,
			button,
			action: suffix === 'm' ? 'up' : motion ? (button === 'none' ? 'move' : 'drag') : 'down',
			ctrl,
			shift,
			meta,
		});
		return true;
	}

	private resolveMousePosition(rawX: string, rawY: string) {
		const xValue = Number.parseInt(rawX, 10) - 1;
		const yValue = Number.parseInt(rawY, 10) - 1;
		if (!this.pixelMouseEnabled) {
			return { x: xValue, y: yValue, subX: 0.5, subY: 0.5, pixelX: undefined, pixelY: undefined };
		}
		const x = Math.floor(xValue / this.cellPixelWidth);
		const y = Math.floor(yValue / this.cellPixelHeight);
		const subX = (xValue - x * this.cellPixelWidth) / this.cellPixelWidth;
		const subY = (yValue - y * this.cellPixelHeight) / this.cellPixelHeight;
		return { x, y, subX, subY, pixelX: xValue, pixelY: yValue };
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
