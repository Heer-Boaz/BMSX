import { calculateCenteredBlockX, wrapGlyphs } from '../../render/glyphs';
import { insavegame, type RevivableObjectArgs } from '../../serializer/serializationhooks';
import { WorldObject } from './worldobject';

const DEFAULT_MAX_CHARACTERS_PER_LINE = 32;
const DEFAULT_CHARACTER_WIDTH = 8;
const DEFAULT_TEXT_BLOCK_WIDTH = 256;

@insavegame
/**
 * World object that manages wrapped, typewriter-style text lines.
 */
export class TextObject extends WorldObject {
	public text: string[] = [];
	public fullTextLines: string[] = [];
	public displayedLines: string[] = [];
	public currentLineIndex = 0;
	public currentCharIndex = 0;
	public maximum_characters_per_line = DEFAULT_MAX_CHARACTERS_PER_LINE;
	public isTyping = false;
	protected centeredBlockX = 0;
	protected characterWidth: number;
	protected textBlockWidth: number;

	constructor(opts?: RevivableObjectArgs & { id?: string, fsm_id?: string, characterWidth?: number, textBlockWidth?: number, maximum_characters_per_line?: number }) {
		super(opts);
		this.characterWidth = opts?.characterWidth ?? DEFAULT_CHARACTER_WIDTH;
		this.textBlockWidth = opts?.textBlockWidth ?? DEFAULT_TEXT_BLOCK_WIDTH;
		this.maximum_characters_per_line = opts?.maximum_characters_per_line ?? this.maximum_characters_per_line;
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

		this.fullTextLines = wrappedLines;
		this.displayedLines = this.fullTextLines.map(() => '');
		this.currentLineIndex = 0;
		this.currentCharIndex = 0;
		this.isTyping = true;

		this.centeredBlockX = calculateCenteredBlockX(this.fullTextLines, this.characterWidth, this.textBlockWidth);

		this.updateDisplayedText();
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
		if (!this.isTyping) return;

		if (this.currentLineIndex >= this.fullTextLines.length) {
			this.isTyping = false;
			return;
		}

		const line = this.fullTextLines[this.currentLineIndex];
		if (this.currentCharIndex < line.length) {
			this.displayedLines[this.currentLineIndex] += line[this.currentCharIndex];
			this.currentCharIndex++;
		} else {
			this.currentLineIndex++;
			this.currentCharIndex = 0;
			if (this.currentLineIndex >= this.fullTextLines.length) {
				this.isTyping = false;
			}
		}

		this.updateDisplayedText();
	}

	/**
	 * Updates the displayed text by copying the contents of `displayedLines` to `text`.
	 * This method ensures that the `text` property reflects the current state of `displayedLines`.
	 */
	protected updateDisplayedText(): void {
		this.text = [...this.displayedLines];
	}

	public get textOffsetX(): number {
		return this.centeredBlockX;
	}
}
