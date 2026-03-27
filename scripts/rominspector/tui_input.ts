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
	button: 'left' | 'middle' | 'right' | 'wheelup' | 'wheeldown';
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
	private onData = (chunk: Buffer) => {
		const text = chunk.toString('utf8');
		if (this.pending.length === 0 && text.indexOf('\x1b[<') === -1) {
			return;
		}
		this.pending += text;
		this.parsePending();
	};
	private onKeypress = (ch: string | undefined, key: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string }) => {
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
		this.push({ type: 'resize' });
	};

	init(): void {
		readline.emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on('data', this.onData);
		process.stdin.on('keypress', this.onKeypress);
		process.stdout.on('resize', this.onResize);
		process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
	}

	restore(): void {
		process.stdin.off('data', this.onData);
		process.stdin.off('keypress', this.onKeypress);
		process.stdout.off('resize', this.onResize);
		process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();
		this.pending = '';
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
			const start = this.pending.indexOf('\x1b[<');
			if (start === -1) {
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
		const x = Number.parseInt(match[2], 10) - 1;
		const y = Number.parseInt(match[3], 10) - 1;
		const suffix = match[4];
		const shift = (code & 4) !== 0;
		const meta = (code & 8) !== 0;
		const ctrl = (code & 16) !== 0;
		const motion = (code & 32) !== 0;
		const wheel = (code & 64) !== 0;
		if (wheel) {
			this.push({
				type: 'mouse',
				x,
				y,
				button: (code & 1) === 0 ? 'wheelup' : 'wheeldown',
				action: 'scroll',
				ctrl,
				shift,
				meta,
			});
			return true;
		}
		const buttonIndex = code & 3;
		const button = buttonIndex === 0 ? 'left' : buttonIndex === 1 ? 'middle' : 'right';
		this.push({
			type: 'mouse',
			x,
			y,
			button,
			action: suffix === 'm' ? 'up' : motion ? 'drag' : 'down',
			ctrl,
			shift,
			meta,
		});
		return true;
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
