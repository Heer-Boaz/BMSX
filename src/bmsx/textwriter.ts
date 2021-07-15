import { GameOptions as GO, Point } from "./bmsx";
import { Color } from './view';
import { BFont } from "./rompack";

export class TextWriter {
    public static FontWidth: number = 8;
    public static FontHeight: number = 8;

    public static drawText(x: number, y: number, textToWrite: string | string[], _font: BFont = null, color: Color = null): void {
        let font = _font ?? global.view.default_font;
        let startPos: Point = <Point>{ x: x, y: y }
        let stepX: number = TextWriter.FontWidth;
        let stepY: number = TextWriter.FontHeight;
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
