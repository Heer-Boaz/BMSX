import { $ } from '../core/game';
import type { color } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { ConsoleEditorFont } from './editor_font';
import type { ConsoleFontVariant } from './font';
import type { KeyboardInput } from '../input/keyboardinput';
import type { ButtonState } from '../input/inputtypes';
import { wrapRuntimeErrorLine } from './ide/runtime_error_utils';
import {
	createInlineTextField,
	applyInlineFieldEditing,
	type InlineFieldEditingHandlers,
	setFieldText,
	selectionRange,
} from './ide/inline_text_field';
import type { InlineInputOptions, InlineTextField } from './ide/types';
import { INITIAL_REPEAT_DELAY, REPEAT_INTERVAL, TAB_SPACES } from './ide/constants';
import { EditorConsoleRenderBackend } from './render_backend';

type ConsoleOutputKind = 'prompt' | 'stdout' | 'stderr' | 'system';

type ConsoleOutputEntry = {
	text: string;
	kind: ConsoleOutputKind;
};

type ConsoleModeOptions = {
	fontVariant?: ConsoleFontVariant;
	caseInsensitive?: boolean;
	maxEntries?: number;
};

type Viewport = { width: number; height: number };

const MAX_OUTPUT_ENTRIES = 512;
const MAX_HISTORY_ENTRIES = 256;
const PROMPT_TEXT = '> ';
const PROMPT_GAP = 4;
const PADDING_X = 10;
const PADDING_Y = 10;
const PANEL_BACKGROUND_ALPHA = 0.72;
const CHARACTER_TILE_ALPHA = 1.0;
const OBLIQUE_SHADOW_OFFSET = 1;
const CHARACTER_INSET_Y = 1;
const CURSOR_BLINK_PERIOD = 0.8;
const ENABLE_PANEL_BACKDROP = false;

const OUTPUT_COLORS: Record<ConsoleOutputKind, number> = {
	prompt: 15,
	stdout: 15,
	stderr: 9,
	system: 11,
};

class KeyPressLatch {
	private readonly records = new Map<string, number | null>();

	public accept(code: string, state: ButtonState | undefined | null): boolean {
		if (!state || state.pressed !== true) {
			this.records.delete(code);
			return false;
		}
		const pressId = typeof state.pressId === 'number' ? state.pressId : null;
		if (pressId !== null) {
			const existing = this.records.get(code);
			if (existing === pressId) {
				return false;
			}
			this.records.set(code, pressId);
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		this.records.set(code, null);
		return true;
	}

	public release(code: string): void {
		this.records.delete(code);
	}

	public reset(): void {
		this.records.clear();
	}
}

class KeyRepeatController {
	private readonly cooldowns = new Map<string, number>();

	public shouldRepeat(code: string, keyboard: KeyboardInput, deltaSeconds: number, guards: KeyPressLatch): boolean {
		const state = keyboard.getButtonState(code);
		if (!state || state.pressed !== true) {
			this.cooldowns.delete(code);
			guards.release(code);
			return false;
		}
		let remaining = this.cooldowns.get(code);
		if (remaining === undefined) {
			remaining = INITIAL_REPEAT_DELAY;
			this.cooldowns.set(code, remaining);
		}
		if (guards.accept(code, state)) {
			this.cooldowns.set(code, INITIAL_REPEAT_DELAY);
			return true;
		}
		remaining -= deltaSeconds;
		if (remaining <= 0) {
			this.cooldowns.set(code, REPEAT_INTERVAL);
			return true;
		}
		this.cooldowns.set(code, remaining);
		return false;
	}

	public reset(): void {
		this.cooldowns.clear();
	}
}

function cloneColor(source: color, alphaOverride?: number): color {
	return {
		r: source.r,
		g: source.g,
		b: source.b,
		a: typeof alphaOverride === 'number' ? alphaOverride : source.a ?? 1,
	};
}

function resolvePaletteColor(index: number, alpha?: number): color {
	const base = Msx1Colors[index] ?? Msx1Colors[15];
	return cloneColor(base, alpha ?? base.a ?? 1);
}

export class ConsoleMode {
	private readonly font: ConsoleEditorFont;
	private readonly caseInsensitive: boolean;
	private readonly maxEntries: number;
	private readonly panelBackgroundColor = resolvePaletteColor(0, PANEL_BACKGROUND_ALPHA);
	private readonly characterBackgroundColor = { r: 0, g: 0, b: 0, a: CHARACTER_TILE_ALPHA } as color;
	private readonly caretColor = resolvePaletteColor(15);
	private readonly selectionColor = resolvePaletteColor(11, 0.55);
	private showBackdrop = ENABLE_PANEL_BACKDROP;
	private readonly field: InlineTextField = createInlineTextField();
	private readonly output: ConsoleOutputEntry[] = [];
	private readonly history: string[] = [];
	private historyIndex: number | null = null;
	private readonly keyGuards = new KeyPressLatch();
	private readonly editingRepeat = new KeyRepeatController();
	private readonly historyRepeat = new KeyRepeatController();
	private clipboard: string | null = null;
	private blinkTimer = 0;
	private caretVisible = true;
	private active = false;

	constructor(options: ConsoleModeOptions) {
		this.font = new ConsoleEditorFont(options.fontVariant);
		this.caseInsensitive = options.caseInsensitive ?? true;
		this.maxEntries = options.maxEntries ?? MAX_OUTPUT_ENTRIES;
	}

	public setBackdropVisibility(enabled: boolean): void {
		this.showBackdrop = enabled;
	}

	public activate(): void {
		this.active = true;
		this.resetInputField('');
		this.historyIndex = null;
		this.keyGuards.reset();
		this.editingRepeat.reset();
		this.historyRepeat.reset();
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	public deactivate(): void {
		this.active = false;
		this.keyGuards.reset();
		this.editingRepeat.reset();
		this.historyRepeat.reset();
	}

	public isActive(): boolean {
		return this.active;
	}

	public clearOutput(): void {
		this.output.length = 0;
	}

	public appendPromptEcho(command: string): void {
		this.appendEntry({ kind: 'prompt', text: `${PROMPT_TEXT}${command}` });
	}

	public appendStdout(text: string): void {
		this.appendEntry({ kind: 'stdout', text });
	}

	public appendStderr(text: string): void {
		this.appendEntry({ kind: 'stderr', text });
	}

	public appendSystemMessage(text: string): void {
		this.appendEntry({ kind: 'system', text });
	}

	public update(deltaSeconds: number): void {
		if (!this.active) {
			return;
		}
		this.blinkTimer += deltaSeconds;
		if (this.blinkTimer >= CURSOR_BLINK_PERIOD) {
			this.blinkTimer -= CURSOR_BLINK_PERIOD;
		}
		this.caretVisible = this.blinkTimer < CURSOR_BLINK_PERIOD * 0.5;
	}

	public handleInput(keyboard: KeyboardInput, deltaSeconds: number): string | null {
		if (!this.active) {
			return null;
		}
		const modifiers = this.resolveModifiers(keyboard);
		const options: InlineInputOptions = {
			ctrlDown: modifiers.ctrl,
			metaDown: modifiers.meta,
			shiftDown: modifiers.shift,
			altDown: modifiers.alt,
			deltaSeconds,
			allowSpace: true,
		};
		const handlers = this.createInlineHandlers(keyboard);
		applyInlineFieldEditing(this.field, options, handlers);
		const historyHandled = this.handleHistoryNavigation(keyboard, deltaSeconds, modifiers);
		if (historyHandled) {
			this.resetBlink();
		}
		const submit = this.trySubmitCommand(keyboard);
		return submit;
	}

	public draw(renderer: EditorConsoleRenderBackend, surface: Viewport): void {
		if (!this.active) {
			return;
		}
		const lineHeight = this.font.lineHeight();
		const contentWidth = Math.max(0, surface.width - PADDING_X * 2);

		// compute prompt layout and wrapped input segments
		const promptWidth = this.measureDisplayText(PROMPT_TEXT);
		const firstLineMax = Math.max(8, contentWidth - promptWidth);
		const otherLineMax = Math.max(8, contentWidth);
		const displayInput = this.toDisplayText(this.field.text);
		const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax);

		// space available for output lines above the input area
		const availableHeight = surface.height - PADDING_Y * 2 - PROMPT_GAP - (inputWrap.segments.length * lineHeight);
		const maxContentLines = Math.max(1, Math.floor(availableHeight / lineHeight));

		// build and clamp output lines
		const wrappedLines = this.buildWrappedLines(contentWidth, maxContentLines);
		const visibleStart = Math.max(0, wrappedLines.length - maxContentLines);
		const visibleLines = wrappedLines.slice(visibleStart);

		// draw backdrop sized to visible content + input area
		if (this.showBackdrop) {
			const panelHeight = visibleLines.length * lineHeight + PROMPT_GAP + inputWrap.segments.length * lineHeight;
			this.drawBackdrop(renderer, surface.width, panelHeight);
		}

		// draw visible output lines starting at top padding
		let y = PADDING_Y;
		for (const line of visibleLines) {
			const color = resolvePaletteColor(OUTPUT_COLORS[line.kind]);
			this.drawGlyphRun(renderer, line.text, PADDING_X, y, color);
			y += lineHeight;
		}

		// compute where input block starts (positioned right after visible output lines,
		// so the input moves upward as output fills the viewport — terminal-like behavior)
		const inputStartY = PADDING_Y + visibleLines.length * lineHeight + PROMPT_GAP;

		// draw prompt at the first input line then draw wrapped input lines (first segment after prompt)
		const promptColor = resolvePaletteColor(OUTPUT_COLORS.prompt);
		this.drawGlyphRun(renderer, PROMPT_TEXT, PADDING_X, inputStartY, promptColor);

		// draw multi-line input (handles selection and caret)
		this.drawMultilineInput(renderer, PADDING_X, inputStartY, promptWidth, inputWrap);
	}

	public recordHistory(command: string): void {
		if (!command || command.trim().length === 0) {
			this.historyIndex = null;
			return;
		}
		this.history.push(command);
		if (this.history.length > MAX_HISTORY_ENTRIES) {
			this.history.shift();
		}
		this.historyIndex = null;
	}

	private appendEntry(entry: ConsoleOutputEntry): void {
		this.output.push(entry);
		if (this.output.length > this.maxEntries) {
			this.output.splice(0, this.output.length - this.maxEntries);
		}
	}

	private resolveModifiers(keyboard: KeyboardInput): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } {
		const ctrl = keyboard.getButtonState('ControlLeft').pressed === true || keyboard.getButtonState('ControlRight').pressed === true;
		const alt = keyboard.getButtonState('AltLeft').pressed === true || keyboard.getButtonState('AltRight').pressed === true;
		const shift = keyboard.getButtonState('ShiftLeft').pressed === true || keyboard.getButtonState('ShiftRight').pressed === true;
		const meta = keyboard.getButtonState('MetaLeft').pressed === true || keyboard.getButtonState('MetaRight').pressed === true;
		return { ctrl, alt, shift, meta };
	}

	private createInlineHandlers(keyboard: KeyboardInput): InlineFieldEditingHandlers {
		return {
			isKeyJustPressed: (code: string) => this.keyGuards.accept(code, keyboard.getButtonState(code)),
			isKeyTyped: (code: string) => this.keyGuards.accept(code, keyboard.getButtonState(code)),
			shouldFireRepeat: (code: string, deltaSeconds: number) => {
				if (code === 'ArrowUp' || code === 'ArrowDown') {
					this.keyGuards.release(code);
					return false;
				}
				return this.editingRepeat.shouldRepeat(code, keyboard, deltaSeconds, this.keyGuards);
			},
			consumeKey: (code: string) => keyboard.consumeButton(code),
			readClipboard: () => this.clipboard,
			writeClipboard: (payload: string) => {
				this.clipboard = payload;
				void $.platform.clipboard.writeText(payload).catch(() => {});
			},
			onClipboardEmpty: () => this.appendSystemMessage('Clipboard is empty.'),
		};
	}

	private handleHistoryNavigation(keyboard: KeyboardInput, deltaSeconds: number, modifiers: { ctrl: boolean; alt: boolean; meta: boolean }): boolean {
		if (modifiers.ctrl || modifiers.alt || modifiers.meta) {
			return false;
		}
		if (this.history.length === 0) {
			return false;
		}
		if (this.historyRepeat.shouldRepeat('ArrowUp', keyboard, deltaSeconds, this.keyGuards)) {
			this.recallHistory(-1);
			keyboard.consumeButton('ArrowUp');
			return true;
		}
		if (this.historyRepeat.shouldRepeat('ArrowDown', keyboard, deltaSeconds, this.keyGuards)) {
			this.recallHistory(1);
			keyboard.consumeButton('ArrowDown');
			return true;
		}
		return false;
	}

	private recallHistory(direction: -1 | 1): void {
		if (this.history.length === 0) {
			return;
		}
		if (this.historyIndex === null) {
			this.historyIndex = this.history.length;
		}
		this.historyIndex = Math.min(this.history.length, Math.max(0, this.historyIndex + direction));
		if (this.historyIndex === this.history.length) {
			this.resetInputField('');
			return;
		}
		const entry = this.history[this.historyIndex];
		this.resetInputField(entry);
	}

	private trySubmitCommand(keyboard: KeyboardInput): string | null {
		const enterState = keyboard.getButtonState('Enter');
		const numpadEnterState = keyboard.getButtonState('NumpadEnter');
		const enterPressed = this.keyGuards.accept('Enter', enterState) || this.keyGuards.accept('NumpadEnter', numpadEnterState);
		if (!enterPressed) {
			return null;
		}
		keyboard.consumeButton('Enter');
		keyboard.consumeButton('NumpadEnter');
		const command = this.field.text.trimEnd();
		if (command.length === 0) {
			this.resetBlink();
			return null;
		}
		this.resetInputField('');
		this.resetBlink();
		return command;
	}

	private resetInputField(value: string): void {
		setFieldText(this.field, value, true);
	}

	private resetBlink(): void {
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	private buildWrappedLines(maxWidth: number, maxLines: number): Array<{ text: string; kind: ConsoleOutputKind }> {
		const lines: Array<{ text: string; kind: ConsoleOutputKind }> = [];
		for (let i = 0; i < this.output.length; i += 1) {
			const entry = this.output[i];
			const segments = this.wrapText(entry.text, maxWidth);
			for (let j = 0; j < segments.length; j += 1) {
				lines.push({ text: segments[j], kind: entry.kind });
			}
		}
		if (lines.length > maxLines) {
			return lines.slice(lines.length - maxLines);
		}
		return lines;
	}

	private wrapText(text: string, maxWidth: number): string[] {
		if (text.length === 0) {
			return [''];
		}
		const normalized = this.toDisplayText(text);
		return wrapRuntimeErrorLine(normalized, Math.max(8, maxWidth), (value) => this.font.measure(value));
	}

	// New helper: wraps display text with a smaller first-line width (after prompt) and full width for following lines.
	private wrapDisplayWithFirstWidth(text: string, firstWidth: number, otherWidth: number): { segments: string[]; starts: number[] } {
		const segments: string[] = [];
		const starts: number[] = [];
		let current = '';
		let currentWidth = 0;
		let widthLimit = firstWidth;
		let index = 0;
		let segStart = 0;

		for (let i = 0; i < text.length; i += 1) {
			const ch = text.charAt(i);
			// treat newline as explicit break
			if (ch === '\n') {
				segments.push(current);
				starts.push(segStart);
				current = '';
				currentWidth = 0;
				index += 1;
				segStart = i + 1;
				widthLimit = otherWidth;
				continue;
			}
			const adv = this.font.advance(ch);
			if (currentWidth + adv > widthLimit && current.length > 0) {
				segments.push(current);
				starts.push(segStart);
				current = ch;
				currentWidth = adv;
				segStart = i;
				widthLimit = otherWidth;
			} else {
				current += ch;
				currentWidth += adv;
			}
		}
		segments.push(current);
		starts.push(segStart);
		// ensure at least one segment
		if (segments.length === 0) {
			segments.push('');
			starts.push(0);
		}
		return { segments, starts };
	}

	// Replace single-line drawInputField with multi-line aware renderer
	private drawMultilineInput(renderer: EditorConsoleRenderBackend, baseX: number, baseY: number, promptWidth: number, wrap: { segments: string[]; starts: number[] }): void {
		const inputColor = resolvePaletteColor(OUTPUT_COLORS.stdout);
		const sel = selectionRange(this.field);
		const cursorIndex = this.field.cursor;
		const displayText = this.toDisplayText(this.field.text);

		for (let si = 0; si < wrap.segments.length; si += 1) {
			const seg = wrap.segments[si];
			const segStart = wrap.starts[si];
			const segLen = seg.length;
			const y = baseY + si * this.font.lineHeight();
			let x = baseX;
			// first segment is placed after the prompt
			if (si === 0) {
				x += promptWidth;
			}

			// draw selection background for this segment if selection overlaps
			if (sel) {
				const selStart = Math.max(sel.start, segStart);
				const selEnd = Math.min(sel.end, segStart + segLen);
				if (selStart < selEnd) {
					const before = displayText.slice(segStart, selStart);
					const selected = displayText.slice(selStart, selEnd);
					const startWidth = this.measureDisplayText(before);
					const selWidth = this.measureDisplayText(selected);
					renderer.drawRect({
						kind: 'fill',
						x0: x + startWidth - 1,
						y0: y - CHARACTER_INSET_Y,
						x1: x + startWidth + selWidth + 1,
						y1: y + this.font.lineHeight() + CHARACTER_INSET_Y,
						color: this.selectionColor,
					});
				}
			}

			// draw the glyph run for this segment
			this.drawGlyphRun(renderer, seg, x, y, inputColor);

			// caret rendering: if caret is within this segment draw caret
			if (this.caretVisible) {
				const caretInSeg = cursorIndex >= segStart && cursorIndex <= segStart + segLen;
				if (caretInSeg) {
					const local = displayText.slice(segStart, cursorIndex);
					const caretOffset = this.measureDisplayText(local);
					renderer.drawRect({
						kind: 'fill',
						x0: x + caretOffset,
						y0: y - CHARACTER_INSET_Y,
						x1: x + caretOffset + 1,
						y1: y + this.font.lineHeight() + CHARACTER_INSET_Y,
						color: this.caretColor,
					});
				}
			}
		}
	}

	private drawGlyphRun(renderer: EditorConsoleRenderBackend, text: string, originX: number, originY: number, tint: color): void {
		const renderFont = this.font.getRenderFont();
		const display = this.toDisplayText(text);
		let cursorX = originX;
		for (let i = 0; i < display.length; i += 1) {
			const ch = display.charAt(i);
			if (ch === '\t') {
				cursorX += this.font.advance(' ') * TAB_SPACES;
				continue;
			}
			if (ch === '\n') {
				continue;
			}
			const advance = this.font.advance(ch);
			const backgroundX = cursorX + OBLIQUE_SHADOW_OFFSET;
			renderer.drawRect({
				kind: 'fill',
				x0: backgroundX,
				y0: originY - CHARACTER_INSET_Y,
				x1: backgroundX + advance + CHARACTER_INSET_Y,
				y1: originY + this.font.lineHeight() + CHARACTER_INSET_Y,
				color: this.characterBackgroundColor,
			});
			if (ch !== ' ') {
				renderer.drawText({ kind: 'print', text: ch, x: cursorX, y: originY, color: tint }, renderFont);
			}
			cursorX += advance;
		}
	}

	private drawBackdrop(renderer: EditorConsoleRenderBackend, surfaceWidth: number, contentHeight: number): void {
		const padding = 6;
		const x0 = Math.max(0, PADDING_X - padding);
		const x1 = Math.max(x0 + 1, surfaceWidth - PADDING_X + padding);
		const y0 = Math.max(0, PADDING_Y - padding);
		const y1 = Math.max(y0 + 1, y0 + contentHeight + padding * 2);
		renderer.drawRect({
			kind: 'fill',
			x0,
			y0,
			x1,
			y1,
			color: this.panelBackgroundColor,
		});
	}

	private toDisplayText(value: string): string {
		if (this.caseInsensitive && this.font.getVariant() === 'tiny') {
			return value.toUpperCase();
		}
		return value;
	}

	private measureDisplayText(value: string): number {
		if (!value) {
			return 0;
		}
		return this.font.measure(this.toDisplayText(value));
	}
}
