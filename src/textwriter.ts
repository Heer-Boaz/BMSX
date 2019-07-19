import { GameConstants as CS } from "./gameconstants"
import { BitmapId } from "./resourceids";
import { GameOptions } from "./gameoptions";

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

    public SetText(text: string): void {
        this.Text.length = 0;
        this.Text.push(text);
    }

    public AddText(text: string | string[]): void {
        this.Text.push(...text);
    }

    public TakeTurn(): void {
        switch (this.Type) {
            case TextWriterType.Billboard:
                break;
            case TextWriterType.Story:
                {

                }
                break;
        }
    }

    public static DrawText(x: number, y: number, textToWrite: string, color: System.Drawing.Color = null): void {
        TextWriter.DrawText(x, y, textToWrite,/*color:*/color);
    }

    public static DrawText(x: number, y: number, textToWrite: string[], verticalPixels: number = null, color: System.Drawing.Color = null): void {
        let startPos: Point = new Point(x, y);
        let stepX: number = TextWriter.FontWidth;
        let stepY: number = TextWriter.FontHeight;
        let pos: Point = Point.Copy(startPos);
        let letter: BitmapId;
        textToWrite.forEach(function (text) {
            for (let i: number = 0; i < text.length; i++) {
                let c: string = text[i];
                letter = TextWriter.getBitmapForLetter(c);
                if (!color.HasValue)
                    BDX._.DrawBitmap(<number>letter, pos.x, pos.y);
                else BDX._.DrawColoredBitmap(<number>letter, pos.x, pos.y, color.Value.R / 255.0, color.Value.G / 255.0, color.Value.B / 255.0);
                pos.x += stepX;
            }
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GameOptions._.BufferHeight)
                break;
        });
    }

    public Paint(): void {
        if (!this.visible)
            return
        if (this.Text.length == 0)
            return
        let startPos: Point = Point.Copy(this.Pos);
        let stepX: number = TextWriter.FontWidth;
        let stepY: number = TextWriter.FontHeight;
        let pos: Point = Point.Copy(startPos);
        let letter: BitmapId;
        this.Text.forEach(function (text) {
            text.forEach(function (c) {
                if (pos.y < -TextWriter.FontHeight)
                    break;
                letter = TextWriter.getBitmapForLetter(c);
                BDX._.DrawBitmap(<number>letter, pos.x, pos.y);
                pos.x += stepX;
            });
            pos.x = startPos.x;
            pos.y += stepY;
            if (pos.y >= GameOptions._.BufferHeight)
                break;
        });
    }

    private static getBitmapForLetter(c: string): BitmapId {
        let letter: BitmapId;
        switch (c) {
            case '0':
                letter = BitmapId.Font_0;
                break;
            case '1':
                letter = BitmapId.Font_1;
                break;
            case '2':
                letter = BitmapId.Font_2;
                break;
            case '3':
                letter = BitmapId.Font_3;
                break;
            case '4':
                letter = BitmapId.Font_4;
                break;
            case '5':
                letter = BitmapId.Font_5;
                break;
            case '6':
                letter = BitmapId.Font_6;
                break;
            case '7':
                letter = BitmapId.Font_7;
                break;
            case '8':
                letter = BitmapId.Font_8;
                break;
            case '9':
                letter = BitmapId.Font_9;
                break;
            case 'a':
                letter = BitmapId.Font_A;
                break;
            case 'b':
                letter = BitmapId.Font_B;
                break;
            case 'c':
                letter = BitmapId.Font_C;
                break;
            case 'd':
                letter = BitmapId.Font_D;
                break;
            case 'e':
                letter = BitmapId.Font_E;
                break;
            case 'f':
                letter = BitmapId.Font_F;
                break;
            case 'g':
                letter = BitmapId.Font_G;
                break;
            case 'h':
                letter = BitmapId.Font_H;
                break;
            case 'i':
                letter = BitmapId.Font_I;
                break;
            case 'j':
                letter = BitmapId.Font_J;
                break;
            case 'k':
                letter = BitmapId.Font_K;
                break;
            case 'l':
                letter = BitmapId.Font_L;
                break;
            case 'm':
                letter = BitmapId.Font_M;
                break;
            case 'n':
                letter = BitmapId.Font_N;
                break;
            case 'o':
                letter = BitmapId.Font_O;
                break;
            case 'p':
                letter = BitmapId.Font_P;
                break;
            case 'q':
                letter = BitmapId.Font_Q;
                break;
            case 'r':
                letter = BitmapId.Font_R;
                break;
            case 's':
                letter = BitmapId.Font_S;
                break;
            case 't':
                letter = BitmapId.Font_T;
                break;
            case 'u':
                letter = BitmapId.Font_U;
                break;
            case 'v':
                letter = BitmapId.Font_V;
                break;
            case 'w':
                letter = BitmapId.Font_W;
                break;
            case 'x':
                letter = BitmapId.Font_X;
                break;
            case 'y':
                letter = BitmapId.Font_Y;
                break;
            case 'z':
                letter = BitmapId.Font_Z;
                break;
            case 'A':
                letter = BitmapId.Font_A;
                break;
            case 'B':
                letter = BitmapId.Font_B;
                break;
            case 'C':
                letter = BitmapId.Font_C;
                break;
            case 'D':
                letter = BitmapId.Font_D;
                break;
            case 'E':
                letter = BitmapId.Font_E;
                break;
            case 'F':
                letter = BitmapId.Font_F;
                break;
            case 'G':
                letter = BitmapId.Font_G;
                break;
            case 'H':
                letter = BitmapId.Font_H;
                break;
            case 'I':
                letter = BitmapId.Font_I;
                break;
            case 'J':
                letter = BitmapId.Font_J;
                break;
            case 'K':
                letter = BitmapId.Font_K;
                break;
            case 'L':
                letter = BitmapId.Font_L;
                break;
            case 'M':
                letter = BitmapId.Font_M;
                break;
            case 'N':
                letter = BitmapId.Font_N;
                break;
            case 'O':
                letter = BitmapId.Font_O;
                break;
            case 'P':
                letter = BitmapId.Font_P;
                break;
            case 'Q':
                letter = BitmapId.Font_Q;
                break;
            case 'R':
                letter = BitmapId.Font_R;
                break;
            case 'S':
                letter = BitmapId.Font_S;
                break;
            case 'T':
                letter = BitmapId.Font_T;
                break;
            case 'U':
                letter = BitmapId.Font_U;
                break;
            case 'V':
                letter = BitmapId.Font_V;
                break;
            case 'W':
                letter = BitmapId.Font_W;
                break;
            case 'X':
                letter = BitmapId.Font_X;
                break;
            case '¡':
                letter = BitmapId.Font_IJ;
                break;
            case 'Y':
                letter = BitmapId.Font_Y;
                break;
            case 'Z':
                letter = BitmapId.Font_Z;
                break;
            case ',':
                letter = BitmapId.Font_Comma;
                break;
            case '.':
                letter = BitmapId.Font_Dot;
                break;
            case '!':
                letter = BitmapId.Font_Exclamation;
                break;
            case '?':
                letter = BitmapId.Font_QuestionMark;
                break;
            case '\'':
                letter = BitmapId.Font_Apostroph;
                break;
            case ' ':
                letter = BitmapId.Font_Space;
                break;
            case ':':
                letter = BitmapId.Font_Colon;
                break;
            case '-':
                letter = BitmapId.Font_Streep;
                break;
            case '/':
                letter = BitmapId.Font_Slash;
                break;
            case '%':
                letter = BitmapId.Font_Percent;
                break;
            case '[':
                letter = BitmapId.Font_SpeakStart;
                break;
            case ']':
                letter = BitmapId.Font_SpeakEnd;
                break;
            default:
                letter = BitmapId.Font_QuestionMark;
                break;
        }
        return letter;
    }
}