import { view } from "../BoazEngineJS/engine"
import { BitmapId } from "./resourceids";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { Point, Color } from "../BoazEngineJS/interfaces";

export enum TextWriterType {
    Billboard,
    Story
}

export class TextWriter {
    public static FontWidth: number = 8;
    public static FontHeight: number = 8;
    public Type: TextWriterType;
    public Pos: Point;
    public End: Point;
    public Text: string[];
    public visible: boolean;

    constructor(pos: Point, end: Point, type: TextWriterType) {
        this.Type = type;
        this.Pos = pos;
        this.End = end;
        this.Text = new Array<string>();
        this.visible = false;
    }

    public setText(text: string): void {
        this.Text.length = 0;
        this.Text.push(text);
    }

    public addText(text: string | string[]): void {
        this.Text.push(...text);
    }

    public takeTurn(): void {
        switch (this.Type) {
            case TextWriterType.Billboard:
                break;
            case TextWriterType.Story:
                {

                }
                break;
        }
    }

    public static drawText(x: number, y: number, textToWrite: string | string[], color: Color = null): void {
        let startPos: Point = <Point>{ x: x, y: y }
        let stepX: number = TextWriter.FontWidth;
        let stepY: number = TextWriter.FontHeight;
        let pos: Point = <Point>{ x: startPos.x, y: startPos.y };
        if (Array.isArray(textToWrite)) {
            for (let text of textToWrite) {
                for (let i: number = 0; i < text.length; i++) {
                    TextWriter.drawLetter(pos.x, pos.y, textToWrite[i], color);
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
                TextWriter.drawLetter(pos.x, pos.y, textToWrite[i], color);
                pos.x += stepX;
            }
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GO.BufferHeight)
                return;
        }
    }

    private static drawLetter(x: number, y: number, c: string, color: Color = null): void {
        let letter = TextWriter.getBitmapForLetter(c);
        if (!color)
            view.drawImg(letter, x, y);
        else view.drawColoredBitmap(letter, x, y, color.r / 255.0, color.g / 255.0, color.b / 255.0);
    }

    public paint(): void {
        if (!this.visible)
            return
        if (this.Text.length == 0)
            return
        let startPos: Point = <Point>{ x: this.Pos.x, y: this.Pos.y };
        let stepX: number = TextWriter.FontWidth;
        let stepY: number = TextWriter.FontHeight;
        let pos: Point = <Point>{ x: startPos.x, y: startPos.y };
        let letter: BitmapId;
        for (let text of this.Text) {
            for (let c of text) {
                if (pos.y < -TextWriter.FontHeight)
                    break;
                letter = TextWriter.getBitmapForLetter(c);
                view.drawImg(letter, pos.x, pos.y);
                pos.x += stepX;
            };
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GO.BufferHeight)
                break;
        };
    }

    private static getBitmapForLetter(c: string): BitmapId {
        let letter: BitmapId;
        switch (c) {
            case '0':
                letter = BitmapId.Letter_0;
                break;
            case '1':
                letter = BitmapId.Letter_1;
                break;
            case '2':
                letter = BitmapId.Letter_2;
                break;
            case '3':
                letter = BitmapId.Letter_3;
                break;
            case '4':
                letter = BitmapId.Letter_4;
                break;
            case '5':
                letter = BitmapId.Letter_5;
                break;
            case '6':
                letter = BitmapId.Letter_6;
                break;
            case '7':
                letter = BitmapId.Letter_7;
                break;
            case '8':
                letter = BitmapId.Letter_8;
                break;
            case '9':
                letter = BitmapId.Letter_9;
                break;
            case 'a':
                letter = BitmapId.Letter_A;
                break;
            case 'b':
                letter = BitmapId.Letter_B;
                break;
            case 'c':
                letter = BitmapId.Letter_C;
                break;
            case 'd':
                letter = BitmapId.Letter_D;
                break;
            case 'e':
                letter = BitmapId.Letter_E;
                break;
            case 'f':
                letter = BitmapId.Letter_F;
                break;
            case 'g':
                letter = BitmapId.Letter_G;
                break;
            case 'h':
                letter = BitmapId.Letter_H;
                break;
            case 'i':
                letter = BitmapId.Letter_I;
                break;
            case 'j':
                letter = BitmapId.Letter_J;
                break;
            case 'k':
                letter = BitmapId.Letter_K;
                break;
            case 'l':
                letter = BitmapId.Letter_L;
                break;
            case 'm':
                letter = BitmapId.Letter_M;
                break;
            case 'n':
                letter = BitmapId.Letter_N;
                break;
            case 'o':
                letter = BitmapId.Letter_O;
                break;
            case 'p':
                letter = BitmapId.Letter_P;
                break;
            case 'q':
                letter = BitmapId.Letter_Q;
                break;
            case 'r':
                letter = BitmapId.Letter_R;
                break;
            case 's':
                letter = BitmapId.Letter_S;
                break;
            case 't':
                letter = BitmapId.Letter_T;
                break;
            case 'u':
                letter = BitmapId.Letter_U;
                break;
            case 'v':
                letter = BitmapId.Letter_V;
                break;
            case 'w':
                letter = BitmapId.Letter_W;
                break;
            case 'x':
                letter = BitmapId.Letter_X;
                break;
            case 'y':
                letter = BitmapId.Letter_Y;
                break;
            case 'z':
                letter = BitmapId.Letter_Z;
                break;
            case 'A':
                letter = BitmapId.Letter_A;
                break;
            case 'B':
                letter = BitmapId.Letter_B;
                break;
            case 'C':
                letter = BitmapId.Letter_C;
                break;
            case 'D':
                letter = BitmapId.Letter_D;
                break;
            case 'E':
                letter = BitmapId.Letter_E;
                break;
            case 'F':
                letter = BitmapId.Letter_F;
                break;
            case 'G':
                letter = BitmapId.Letter_G;
                break;
            case 'H':
                letter = BitmapId.Letter_H;
                break;
            case 'I':
                letter = BitmapId.Letter_I;
                break;
            case 'J':
                letter = BitmapId.Letter_J;
                break;
            case 'K':
                letter = BitmapId.Letter_K;
                break;
            case 'L':
                letter = BitmapId.Letter_L;
                break;
            case 'M':
                letter = BitmapId.Letter_M;
                break;
            case 'N':
                letter = BitmapId.Letter_N;
                break;
            case 'O':
                letter = BitmapId.Letter_O;
                break;
            case 'P':
                letter = BitmapId.Letter_P;
                break;
            case 'Q':
                letter = BitmapId.Letter_Q;
                break;
            case 'R':
                letter = BitmapId.Letter_R;
                break;
            case 'S':
                letter = BitmapId.Letter_S;
                break;
            case 'T':
                letter = BitmapId.Letter_T;
                break;
            case 'U':
                letter = BitmapId.Letter_U;
                break;
            case 'V':
                letter = BitmapId.Letter_V;
                break;
            case 'W':
                letter = BitmapId.Letter_W;
                break;
            case 'X':
                letter = BitmapId.Letter_X;
                break;
            case '¡':
                letter = BitmapId.Letter_IJ;
                break;
            case 'Y':
                letter = BitmapId.Letter_Y;
                break;
            case 'Z':
                letter = BitmapId.Letter_Z;
                break;
            case ',':
                letter = BitmapId.Letter_Comma;
                break;
            case '.':
                letter = BitmapId.Letter_Dot;
                break;
            case '!':
                letter = BitmapId.Letter_Exclamation;
                break;
            case '?':
                letter = BitmapId.Letter_Question;
                break;
            case '\'':
                letter = BitmapId.Letter_Apostroph;
                break;
            case ' ':
                letter = BitmapId.Letter_Space;
                break;
            case ':':
                letter = BitmapId.Letter_Colon;
                break;
            case '-':
                letter = BitmapId.Letter_Streep;
                break;
            case '/':
                letter = BitmapId.Letter_Slash;
                break;
            case '%':
                letter = BitmapId.Letter_Percent;
                break;
            case '[':
                letter = BitmapId.Letter_SpeakStart;
                break;
            case ']':
                letter = BitmapId.Letter_SpeakEnd;
                break;
            default:
                letter = BitmapId.Letter_Question;
                break;
        }
        return letter;
    }
}
