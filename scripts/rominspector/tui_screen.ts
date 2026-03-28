type TuiColor = { r: number; g: number; b: number };

export type TuiStyle = {
	fg: TuiColor;
	bg: TuiColor;
};

type TuiCell = {
	ch: string;
	fg: TuiColor;
	bg: TuiColor;
};

const DEFAULT_STYLE: TuiStyle = {
	fg: { r: 255, g: 255, b: 255 },
	bg: { r: 0, g: 0, b: 0 },
};

function sameColor(left: TuiColor, right: TuiColor): boolean {
	return left.r === right.r && left.g === right.g && left.b === right.b;
}

function sameCell(left: TuiCell, right: TuiCell): boolean {
	return left.ch === right.ch && sameColor(left.fg, right.fg) && sameColor(left.bg, right.bg);
}

function cloneCell(cell: TuiCell): TuiCell {
	return {
		ch: cell.ch,
		fg: cell.fg,
		bg: cell.bg,
	};
}

function ansiColor(prefix: 38 | 48, color: TuiColor): string {
	return `\x1b[${prefix};2;${color.r};${color.g};${color.b}m`;
}

function parseHexColor(hex: string): TuiColor {
	return {
		r: Number.parseInt(hex.slice(1, 3), 16),
		g: Number.parseInt(hex.slice(3, 5), 16),
		b: Number.parseInt(hex.slice(5, 7), 16),
	};
}

function resolveNamedColor(name: string): TuiColor {
	switch (name) {
		case 'black': return TUI_COLORS.black;
		case 'white': return TUI_COLORS.white;
		case 'blue': return TUI_COLORS.blue;
		case 'yellow': return TUI_COLORS.yellow;
		case 'green': return TUI_COLORS.green;
		case 'red': return TUI_COLORS.red;
		case 'cyan': return TUI_COLORS.cyan;
		case 'magenta': return TUI_COLORS.magenta;
		case 'grey':
		case 'gray':
		case 'light-black': return TUI_COLORS.dim;
		case 'light-red': return TUI_COLORS.lightRed;
		case 'light-blue': return TUI_COLORS.lightBlue;
		case 'light-yellow': return TUI_COLORS.lightYellow;
		case 'light-green': return TUI_COLORS.lightGreen;
		case 'light-cyan': return TUI_COLORS.lightCyan;
		case 'light-magenta': return TUI_COLORS.lightMagenta;
		default:
			throw new Error(`Unsupported TUI color tag: ${name}`);
	}
}

function isStyleTag(tag: string): boolean {
	if (tag === '/' || tag.startsWith('/')) {
		return true;
	}
	return /^#[0-9a-fA-F]{6}-(fg|bg)$/.test(tag) || /^[a-z-]+-(fg|bg)$/.test(tag);
}

function resolveTagColor(tag: string): TuiColor {
	const colorName = tag.slice(0, -3);
	if (colorName.startsWith('#') && colorName.length === 7) {
		return parseHexColor(colorName);
	}
	return resolveNamedColor(colorName);
}

export class TuiScreen {
	private widthValue = 80;
	private heightValue = 24;
	private buffer: TuiCell[] = [];
	private prevBuffer: TuiCell[] = [];
	private initialized = false;
	private fullRedraw = true;

	width(): number {
		return this.widthValue;
	}

	height(): number {
		return this.heightValue;
	}

	init(): void {
		if (this.initialized) {
			return;
		}
		this.initialized = true;
		this.fullRedraw = true;
		process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[H');
		this.updateSize();
	}

	restore(): void {
		if (!this.initialized) {
			return;
		}
		process.stdout.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l');
		this.initialized = false;
	}

	updateSize(): void {
		const nextWidth = Math.max(40, process.stdout.columns ?? 80);
		const nextHeight = Math.max(10, process.stdout.rows ?? 24);
		const sizeChanged = nextWidth !== this.widthValue || nextHeight !== this.heightValue;
		this.widthValue = nextWidth;
		this.heightValue = nextHeight;
		const size = this.widthValue * this.heightValue;
		if (this.buffer.length !== size) {
			const cell: TuiCell = { ch: ' ', fg: DEFAULT_STYLE.fg, bg: DEFAULT_STYLE.bg };
			this.buffer = Array.from({ length: size }, () => cloneCell(cell));
		}
		if (this.prevBuffer.length !== size) {
			const cell: TuiCell = { ch: ' ', fg: DEFAULT_STYLE.fg, bg: DEFAULT_STYLE.bg };
			this.prevBuffer = Array.from({ length: size }, () => cloneCell(cell));
			this.fullRedraw = true;
		}
		if (sizeChanged) {
			this.fullRedraw = true;
		}
	}

	clear(style: TuiStyle = DEFAULT_STYLE): void {
		for (let i = 0; i < this.buffer.length; i += 1) {
			this.buffer[i].ch = ' ';
			this.buffer[i].fg = style.fg;
			this.buffer[i].bg = style.bg;
		}
	}

	fillRect(x: number, y: number, width: number, height: number, style: TuiStyle, ch = ' '): void {
		for (let row = 0; row < height; row += 1) {
			for (let col = 0; col < width; col += 1) {
				this.writeChar(x + col, y + row, ch, style);
			}
		}
	}

	writeChar(x: number, y: number, ch: string, style: TuiStyle): void {
		if (x < 0 || y < 0 || x >= this.widthValue || y >= this.heightValue) {
			return;
		}
		const offset = y * this.widthValue + x;
		this.buffer[offset].ch = ch[0] ?? ' ';
		this.buffer[offset].fg = style.fg;
		this.buffer[offset].bg = style.bg;
	}

	writeText(x: number, y: number, text: string, style: TuiStyle): void {
		if (y < 0 || y >= this.heightValue || x >= this.widthValue) {
			return;
		}
		let cx = x;
		for (const ch of text) {
			if (cx >= this.widthValue) {
				break;
			}
			if (cx >= 0) {
				this.writeChar(cx, y, ch, style);
			}
			cx += 1;
		}
	}

	writeTaggedText(x: number, y: number, text: string, baseStyle: TuiStyle, maxWidth = this.widthValue - x): void {
		if (y < 0 || y >= this.heightValue || x >= this.widthValue || maxWidth <= 0) {
			return;
		}
		let cx = x;
		let fg = baseStyle.fg;
		let bg = baseStyle.bg;
		let index = 0;
		while (index < text.length && cx < x + maxWidth) {
			const ch = text[index];
			if (ch === '{') {
				const end = text.indexOf('}', index + 1);
				if (end >= 0) {
					const tag = text.slice(index + 1, end);
					if (isStyleTag(tag)) {
						if (tag === '/' || tag.startsWith('/')) {
							fg = baseStyle.fg;
							bg = baseStyle.bg;
						} else if (tag.endsWith('-fg')) {
							fg = resolveTagColor(tag);
						} else if (tag.endsWith('-bg')) {
							bg = resolveTagColor(tag);
						}
						index = end + 1;
						continue;
					}
				}
			}
			if (ch === '\n') {
				break;
			}
			this.writeChar(cx, y, ch, { fg, bg });
			cx += 1;
			index += 1;
		}
	}

	taggedTextWidth(text: string): number {
		let width = 0;
		let index = 0;
		while (index < text.length) {
			const ch = text[index];
			if (ch === '{') {
				const end = text.indexOf('}', index + 1);
				if (end >= 0) {
					const tag = text.slice(index + 1, end);
					if (isStyleTag(tag)) {
						index = end + 1;
						continue;
					}
				}
			}
			if (ch === '\n') {
				break;
			}
			width += 1;
			index += 1;
		}
		return width;
	}

	writeTaggedTextClipped(x: number, y: number, text: string, baseStyle: TuiStyle, startCol: number, maxWidth: number): void {
		if (y < 0 || y >= this.heightValue || x >= this.widthValue || maxWidth <= 0) {
			return;
		}
		let cx = x;
		let fg = baseStyle.fg;
		let bg = baseStyle.bg;
		let index = 0;
		let visibleCol = 0;
		const endCol = startCol + maxWidth;
		while (index < text.length && visibleCol < endCol && cx < this.widthValue) {
			const ch = text[index];
			if (ch === '{') {
				const end = text.indexOf('}', index + 1);
				if (end >= 0) {
					const tag = text.slice(index + 1, end);
					if (isStyleTag(tag)) {
						if (tag === '/' || tag.startsWith('/')) {
							fg = baseStyle.fg;
							bg = baseStyle.bg;
						} else if (tag.endsWith('-fg')) {
							fg = resolveTagColor(tag);
						} else if (tag.endsWith('-bg')) {
							bg = resolveTagColor(tag);
						}
						index = end + 1;
						continue;
					}
				}
			}
			if (ch === '\n') {
				break;
			}
			if (visibleCol >= startCol) {
				this.writeChar(cx, y, ch, { fg, bg });
				cx += 1;
			}
			visibleCol += 1;
			index += 1;
		}
	}

	draw(): void {
		let out = '';
		let currentFg: TuiColor | null = null;
		let currentBg: TuiColor | null = null;
		let wrote = false;
		for (let y = 0; y < this.heightValue; y += 1) {
			const rowStart = y * this.widthValue;
			let x = 0;
			while (x < this.widthValue) {
				while (x < this.widthValue && !this.fullRedraw && sameCell(this.buffer[rowStart + x], this.prevBuffer[rowStart + x])) {
					x += 1;
				}
				if (x >= this.widthValue) {
					break;
				}
				out += `\x1b[${y + 1};${x + 1}H`;
				while (x < this.widthValue && (this.fullRedraw || !sameCell(this.buffer[rowStart + x], this.prevBuffer[rowStart + x]))) {
					const cell = this.buffer[rowStart + x];
					if (!currentFg || !sameColor(currentFg, cell.fg)) {
						out += ansiColor(38, cell.fg);
						currentFg = cell.fg;
					}
					if (!currentBg || !sameColor(currentBg, cell.bg)) {
						out += ansiColor(48, cell.bg);
						currentBg = cell.bg;
					}
					out += cell.ch;
					this.prevBuffer[rowStart + x] = cloneCell(cell);
					x += 1;
					wrote = true;
				}
			}
		}
		if (!wrote) {
			return;
		}
		this.fullRedraw = false;
		out += '\x1b[0m';
		process.stdout.write(out);
	}
}

export const TUI_COLORS = {
	black: { r: 0, g: 0, b: 0 },
	white: { r: 255, g: 255, b: 255 },
	blue: { r: 80, g: 140, b: 255 },
	yellow: { r: 255, g: 230, b: 120 },
	green: { r: 120, g: 220, b: 120 },
	red: { r: 255, g: 110, b: 110 },
	cyan: { r: 100, g: 230, b: 255 },
	magenta: { r: 255, g: 120, b: 255 },
	lightRed: { r: 255, g: 128, b: 128 },
	lightBlue: { r: 120, g: 180, b: 255 },
	lightYellow: { r: 255, g: 240, b: 140 },
	lightGreen: { r: 140, g: 255, b: 140 },
	lightCyan: { r: 140, g: 255, b: 255 },
	lightMagenta: { r: 255, g: 160, b: 255 },
	dim: { r: 140, g: 140, b: 140 },
	panel: { r: 18, g: 18, b: 18 },
	panel2: { r: 28, g: 28, b: 28 },
};
