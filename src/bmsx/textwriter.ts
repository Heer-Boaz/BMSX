import { BFont, GameOptions as GO, Point } from "./bmsx";
import { Color } from './view';

export class TextWriter {
    public static drawText(x: number, y: number, textToWrite: string | string[], _font: BFont = null, color: Color = null): void {
        let font = _font ?? global.view.default_font as BFont;
        let startPos: Point = <Point>{ x: x, y: y }
        let stepX: number = font.char_width;
        let stepY: number = font.char_height;
        let pos: Point = <Point>{ x: startPos.x, y: startPos.y };
        if (Array.isArray(textToWrite)) {
            for (let text of textToWrite) {
                for (let i: number = 0; i < text.length; i++) {
                    global.view.drawImg(font.char_to_img(text[i]), pos.x, pos.y);
                    pos.x += stepX;
                }
                pos.x = startPos.x;
                pos.y += stepY;
                if (pos.y >= GO.BufferHeight)
                    break;
            }
        }
        else {
            for (let i: number = 0; i < textToWrite.length; i++) {
                global.view.drawImg(font.char_to_img(textToWrite[i]), pos.x, pos.y);
                pos.x += stepX;
            }
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GO.BufferHeight)
                return;
        }
    }
}
