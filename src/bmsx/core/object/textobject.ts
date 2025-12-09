import { wrapGlyphs } from '../../render/glyphs';
import { BFont } from '../font';
import { $ } from '../game';
import { insavegame, type RevivableObjectArgs } from '../../serializer/serializationhooks';
import { WorldObject } from './worldobject';
import { RectBounds } from '../../rompack/rompack';
import { CustomVisualComponent } from '../..';

@insavegame
/**
 * World object that manages wrapped, typewriter-style text lines.
 */
export class TextObject extends WorldObject {
	public text: string[] = [''];
	public full_text_lines: string[] = [''];
	public displayed_lines: string[] = [''];
	public current_line_index = 0;
	public current_char_index = 0;
	public maximum_characters_per_line: number;
	public is_typing = false;
	public font: BFont;
	protected _dimensions: RectBounds = null;
	protected centered_block_x = 0;

	constructor(opts?: RevivableObjectArgs & { id?: string, fsm_id?: string, font?: BFont, dims?: RectBounds }) {
		super(opts);
		this.font = opts?.font || $.view.default_font;
		this.dimensions = opts?.dims ?? { top: 0, left: 0, right: $.viewportsize.x, bottom: $.viewportsize.y };

		this.add_component(new CustomVisualComponent({
			parent_or_id: this, producer: ({ rc }) => {
				const lineHeight = this.font.char_height(' ');
				const startY = 2 * lineHeight;

				const xOffset = this.centered_block_x;

				this.text.forEach((line, index) => {
					rc.submit_glyphs({ x: xOffset, y: index * lineHeight + startY, glyphs: line, background_color: { r: 0, g: 0, b: 0, a: 1 } });
				});
			}
		}));
	}

	/**
	 * Sets the text from an array of lines, wraps the text, and initializes the display properties.
	 *
	 * @param lines - An array of strings where each string represents a line of text.
	 *
	 * This method performs the following steps:
	 * 1. Combines the lines into a single string with newline characters.
	 * 2. Wraps the combined text.
	 * 3. Initializes the `fullTextLines` with the wrapped lines.
	 * 4. Initializes the `displayedLines` as an array of empty strings with the same length as `fullTextLines`.
	 * 5. Resets the `currentLineIndex` and `currentCharIndex` to 0.
	 * 6. Sets the `isTyping` flag to true.
	 * 7. Calculates the centered block X position.
	 * 8. Updates the displayed text.
	 */
	protected setTextFromLines(lines: string[]): void {
		const combined = lines.join('\n');
		const wrappedLines = wrapGlyphs(combined, this.maximum_characters_per_line);

		this.full_text_lines = wrappedLines;
		this.displayed_lines = this.full_text_lines.map(() => '');
		this.current_line_index = 0;
		this.current_char_index = 0;
		this.is_typing = true;

		this.recenter_text_block();
		this.update_displayed_text();
	}

	/**
	 * Handles the typing effect by adding the next character from the current line
	 * to the displayed text. If the end of the current line is reached, it moves
	 * to the next line. If all lines have been processed, it stops the typing effect.
	 *
	 * @private
	 * @method
	 * @returns {void}
	 */
	protected typeNextCharacter(): void {
		if (!this.is_typing) return;

		if (this.current_line_index >= this.full_text_lines.length) {
			this.is_typing = false;
			this.events.emit('text.typing.done', { totalLines: this.full_text_lines.length });
			return;
		}

		const line = this.full_text_lines[this.current_line_index];
		if (this.current_char_index < line.length) {
			const charIndex = this.current_char_index;
			const char = line[charIndex];
			this.displayed_lines[this.current_line_index] += char;
			this.current_char_index++;
			this.update_displayed_text();
			this.events.emit('text.typing.char', { char, lineIndex: this.current_line_index, charIndex });
			return;
		} else {
			this.current_line_index++;
			this.current_char_index = 0;
			if (this.current_line_index >= this.full_text_lines.length) {
				this.is_typing = false;
				this.events.emit('text.typing.done', { totalLines: this.full_text_lines.length });
			}
		}

		this.update_displayed_text();
	}

	/**
	 * Updates the displayed text by copying the contents of `displayedLines` to `text`.
	 * This method ensures that the `text` property reflects the current state of `displayedLines`.
	 */
	protected update_displayed_text(): void {
		this.text = [...this.displayed_lines];
	}

	public set dimensions(rect: RectBounds) {
		this._dimensions = rect;
		this.maximum_characters_per_line = Math.floor((rect.right - rect.left) / this.font.char_width(' '));
		this.recenter_text_block();
	}

	protected recenter_text_block(): void {
		let longestWidth = 0;
		for (const line of this.full_text_lines) {
			const width = this.font.textWidth(line);
			if (width > longestWidth) {
				longestWidth = width;
			}
		}
		this.centered_block_x = ((this._dimensions.right - this._dimensions.left) - longestWidth) / 2 + this._dimensions.left;
	}
}
