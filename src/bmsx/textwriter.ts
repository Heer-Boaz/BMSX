import { BFont, GameOptions as GO, vec2 } from "./bmsx";
import { Color } from './view';

export class TextWriter {
    public static drawText(x: number, y: number, textToWrite: string | string[], z: number = 950, _font?: BFont, color?: Color): void {
        let font = _font ?? global.view.default_font;
        let startPos: vec2 = { x: x, y: y };
        let stepX: number = font.char_width;
        let stepY: number = font.char_height;
        let pos: vec2 = { x: startPos.x, y: startPos.y };

        const draw_string = function (text): boolean {
            for (let i: number = 0; i < text.length; i++) {
                global.view.drawImg({ imgid: font.char_to_img(text[i]), x: pos.x, y: pos.y, z: z, colorize: color });
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
