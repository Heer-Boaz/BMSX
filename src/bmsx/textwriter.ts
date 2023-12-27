import { BFont, GameOptions as GO } from "./bmsx";
import { vec2, vec3 } from "./rompack";
import { Color } from './view';

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
    public static drawText(x: number, y: number, textToWrite: string | string[], z: number = 950, _font?: BFont, color?: Color): void {
        let font = _font ?? $.view.default_font;
        let startPos: vec2 = { x: x, y: y };
        let stepX: number = font.char_width;
        let stepY: number = font.char_height;
        let pos: vec3 = { x: startPos.x, y: startPos.y, z: z };

        /**
        * Draws a string of text on the screen at the current position.
        * @param text The text to draw on the screen.
        * @returns A boolean indicating whether the text has reached the bottom of the screen.
        */
        const draw_string = function (text): boolean {
            for (let i: number = 0; i < text.length; i++) {
                $.view.drawImg({ imgid: font.char_to_img(text[i]), pos, colorize: color });
                pos.x += stepX;
            }
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GO.BufferHeight)
                return true;
            return false;
        };

        if (Array.isArray(textToWrite)) {
            for (let text of textToWrite) {
                if (draw_string(text)) return;
            }
        }
        else {
            draw_string(textToWrite);
        }
    }
}
