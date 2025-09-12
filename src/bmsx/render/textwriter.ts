import { BFont } from '../core/font';
import { $ } from '../core/game';
import { GameOptions as GO } from '../core/gameoptions';
import { vec2 } from "../rompack/rompack";
import { color, type RectRenderSubmission } from './gameview';

/**
 * A utility class for drawing text on the screen.
 */
export class TextWriter {
    /**
     * Draws text on the screen at the specified position.
     * @param x The x-coordinate of the starting position.
     * @param y The y-coordinate of the starting position.
     * @param textToWrite The text to draw on the screen.
     * @param z The z-index of the text.
     * @param _font The font to use for the text. If not specified, the default font will be used.
     * @param color The color to use for the text. If not specified, the default color will be used.
     */
    public static drawText(x: number, y: number, textToWrite: string | string[], z: number = 950, _font?: BFont, color?: color, backgroundColor?: color, layer?: 'world' | 'ui'): void {
        let font = _font ?? $.view.default_font;
        if (!font) {
            console.error('No default font available for TextWriter.drawText');
        }
        let startPos: vec2 = { x: x, y: y };
        let stepX: number = 0;
        let stepY: number = 0;
        let pos: vec2 = { x: startPos.x, y: startPos.y, z: z };

        /**
        * Draws a string of text on the screen at the current position.
        * @param text The text to draw on the screen.
        * @returns A boolean indicating whether the text has reached the bottom of the screen.
        */
        const draw_string = function (text: string): boolean {
            for (let i: number = 0; i < text.length; i++) {
                const letter = text[i]; // Get the character to draw
                stepX = font.char_width(letter); // Get the width of the character
                stepY = font.char_height(letter) > stepY ? font.char_height(letter) : stepY; // Ensure stepY is the maximum height of the characters
                if (backgroundColor) {
                    // Fill rectangle behind the character
                    const rectoptions: RectRenderSubmission = { area: { start: { x: pos.x, y: pos.y }, end: { x: pos.x + stepX, y: pos.y + stepY } }, color: backgroundColor, kind: 'fill', layer };
                    $.view.renderer.submit.rect(rectoptions);
                }
                // Draw the character image
                $.view.renderer.submit.sprite({ imgid: font.char_to_img(text[i]), pos, colorize: color, layer });
                // Move the position to the right for the next character
                pos.x += stepX;
            }
            // Check if the next position exceeds the buffer width
            pos.x = startPos.x;
            // Check if the next position exceeds the buffer height
            pos.y += stepY;
            stepY = 0; // Reset stepY for the next line
            // If the next position exceeds the buffer height, return true to indicate that the text has reached the bottom of the screen
            if (pos.y >= GO.BufferHeight)
                return true;
            return false;
        };

        // If textToWrite is an array, iterate through each string in the array
        if (Array.isArray(textToWrite)) {
            // Iterate through each string in the array
            for (let text of textToWrite) { // For each string in the array
                if (draw_string(text)) return; // If the text has reached the bottom of the screen, stop drawing
            }
        }
        else {
            // If textToWrite is a single string, draw it directly
            draw_string(textToWrite);
        }
    }
}
