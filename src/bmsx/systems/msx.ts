import * as constants from '../vm/ide/constants';
import { vec2 } from "../rompack/rompack";
import { color } from '../render/shared/render_types';

export const TileSize: number = 16;
export class Tile {
	public x: number;
	public y: number;

	public static create(x: number, y: number): Tile {
		return new Tile(x, y);
	}

	public constructor(x: number, y: number) {
		this.x = x * TileSize;
		this.y = y * TileSize;
	}

	public [Symbol.toPrimitive](hint: any): any {
		if (hint == 'number') {
			return Tile.toStageCoord(this.x);
		}
		else if (hint.x && hint.y)
			return Tile.toStagePoint(this.x, this.y);

		return true;
	}
	// https://1drv.ms/w/s!AhGwIeMtrb9HjOMW8H6tazCAqkySlg
	public static [Symbol.toPrimitive](hint: any): any {
		if (hint == 'number') {
			return Tile.toStageCoord(hint);
		}
		else if (hint.x && hint.x == 'number' && hint.y && hint.y == 'number')
			return Tile.toStagePoint(hint.x, hint.y);

		return true;
	}

	public get stagePoint() {
		return { x: this.x * TileSize, y: this.y * TileSize };
	}

	public static toStageCoord(v: number): number {
		return v * TileSize;
	}

	public static toStagePoint(x: number, y: number): vec2 {
		// if ((<Point>x).y) {
		// return { x: (<Point>x).x * TileSize, y: (<Point>x).y * TileSize };
		// }
		return { x: x * TileSize, y: y * TileSize };
	}
}

export const MSX1ScreenWidth: number = 256;
export const MSX1ScreenHeight: number = 192;
export const MSX2ScreenWidth: number = 256;
export const MSX2ScreenHeight: number = 212;
export const Msx1Colors: color[] = [
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 0 }, // 0 = Transparent
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 1 }, // 1 = Black
	{ r: 0 / 255, g: 241 / 255, b: 20 / 255, a: 1 }, // 2 = Medium Green
	{ r: 68 / 255, g: 249 / 255, b: 86 / 255, a: 1 }, // 3 = Light Green
	{ r: 85 / 255, g: 79 / 255, b: 255 / 255, a: 1 }, // 4 = Dark Blue
	{ r: 128 / 255, g: 111 / 255, b: 255 / 255, a: 1 }, // 5 = Light Blue
	{ r: 250 / 255, g: 80 / 255, b: 51 / 255, a: 1 }, // 6 = Dark Red
	{ r: 12 / 255, g: 255 / 255, b: 255 / 255, a: 1 }, // 7 = Cyan
	{ r: 255 / 255, g: 81 / 255, b: 52 / 255, a: 1 }, // 8 = Medium Red
	{ r: 255 / 255, g: 115 / 255, b: 86 / 255, a: 1 }, // 9 = Light Red
	{ r: 226 / 255, g: 210 / 255, b: 4 / 255, a: 1 }, // 10 = Dark Yellow
	{ r: 242 / 255, g: 217 / 255, b: 71 / 255, a: 1 }, // 11 = Light Yellow
	{ r: 4 / 255, g: 212 / 255, b: 19 / 255, a: 1 }, // 12 = Dark Green
	{ r: 231 / 255, g: 80 / 255, b: 229 / 255, a: 1 }, // 13 = Magenta
	{ r: 208 / 255, g: 208 / 255, b: 208 / 255, a: 1 }, // 14 = Grey
	{ r: 255 / 255, g: 255 / 255, b: 255 / 255, a: 1 }, // 15 = White
	// Extra MSX1 color for extended palettes. Let's call them "BMSX" palette entries :-)
	// Bright brown
	{ r: 222 / 255, g: 184 / 255, b: 135 / 255, a: 1 }, // 16 = Brown
	// Very dark blue
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 }, // 17 = Very dark blue

	// Additional palette slots for IDE themes
	{ r: 250 / 255, g: 250 / 255, b: 250 / 255, a: 1 }, // 18 = Soft white (#fafafa)
	{ r: 234 / 255, g: 234 / 255, b: 235 / 255, a: 1 }, // 19 = Panel grey (#eaeaeb)
	{ r: 219 / 255, g: 219 / 255, b: 220 / 255, a: 1 }, // 20 = Divider grey (#dbdbdc)
	{ r: 82 / 255, g: 111 / 255, b: 255 / 255, a: 1 }, // 21 = Accent blue (#526fff)
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 1 }, // 22 = Deep text grey (#383a42)
	{ r: 18 / 255, g: 20 / 255, b: 23 / 255, a: 1 }, // 23 = Near black (#121417)
	{ r: 229 / 255, g: 229 / 255, b: 230 / 255, a: 1 }, // 24 = Light border grey (#e5e5e6)
	{ r: 157 / 255, g: 157 / 255, b: 159 / 255, a: 1 }, // 25 = Muted mid grey (#9d9d9f)
	{ r: 245 / 255, g: 245 / 255, b: 245 / 255, a: 1 }, // 26 = Gentle white (#f5f5f5)
	{ r: 175 / 255, g: 178 / 255, b: 187 / 255, a: 1 }, // 27 = Hint grey (#afb2bb)
	{ r: 66 / 255, g: 66 / 255, b: 67 / 255, a: 1 }, // 28 = Status text grey (#424243)
	{ r: 35 / 255, g: 35 / 255, b: 36 / 255, a: 1 }, // 29 = List text grey (#232324)
	{ r: 88 / 255, g: 113 / 255, b: 239 / 255, a: 1 }, // 30 = Button blue (#5871ef)
	{ r: 107 / 255, g: 131 / 255, b: 237 / 255, a: 1 }, // 31 = Button hover blue (#6b83ed)
	{ r: 59 / 255, g: 186 / 255, b: 84 / 255, a: 1 }, // 32 = Success green (#3bba54)
	{ r: 76 / 255, g: 194 / 255, b: 99 / 255, a: 1 }, // 33 = Success hover green (#4cc263)
	{ r: 0 / 255, g: 128 / 255, b: 155 / 255, a: 0.2 }, // 34 = Diff inserted translucent (#00809b33)
	{ r: 78 / 255, g: 86 / 255, b: 102 / 255, a: 0.5 }, // 35 = Scrollbar base (#4e566680)
	{ r: 90 / 255, g: 99 / 255, b: 117 / 255, a: 0.5 }, // 36 = Scrollbar hover (#5a637580)
	{ r: 116 / 255, g: 125 / 255, b: 145 / 255, a: 0.5 }, // 37 = Scrollbar active (#747d9180)
	{ r: 166 / 255, g: 38 / 255, b: 164 / 255, a: 1 }, // 38 = Keyword magenta (#a626a4)
	{ r: 80 / 255, g: 161 / 255, b: 79 / 255, a: 1 }, // 39 = String green (#50a14f)
	{ r: 152 / 255, g: 104 / 255, b: 1 / 255, a: 1 }, // 40 = Number brown (#986801)
	{ r: 1 / 255, g: 132 / 255, b: 188 / 255, a: 1 }, // 41 = Cyan blue (#0184bc)
	{ r: 228 / 255, g: 86 / 255, b: 73 / 255, a: 1 }, // 42 = Accent red (#e45649)
	{ r: 64 / 255, g: 120 / 255, b: 242 / 255, a: 1 }, // 43 = Function blue (#4078f2)
	{ r: 160 / 255, g: 161 / 255, b: 167 / 255, a: 1 }, // 44 = Comment grey (#a0a1a7)
	{ r: 191 / 255, g: 136 / 255, b: 3 / 255, a: 1 }, // 45 = Warning amber (#bf8803)
	{ r: 66 / 255, g: 173 / 255, b: 225 / 255, a: 1 }, // 46 = Info blue (#42ade1)
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 0 }, // 47 = Line highlight overlay (#383a420c)
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 }, // 48 = Selection overlay (#e5e5e6bf)
	{ r: 0.9, g: 0.35, b: 0.35, a: 0.38 }, // 49 = Search match overlay
	{ r: 1, g: 0.85, b: 0.25, a: 0.6 }, // 50 = Search match active overlay
	{ r: 0.25, g: 0.62, b: 0.95, a: 0.32 }, // 51 = References match overlay
	{ r: 0.18, g: 0.44, b: 0.9, a: 0.54 }, // 52 = References match active overlay
	{ r: 0.6, g: 0, b: 0, a: 1 }, // 53 = Error overlay background
	{ r: 0.75, g: 0.1, b: 0.1, a: 1 }, // 54 = Error overlay background hover
	{ r: 1, g: 1, b: 1, a: 0.18 }, // 55 = Error overlay line hover
	{ r: 0.95, g: 0.45, b: 0.1, a: 0.45 }, // 56 = Execution stop overlay
	{ r: 0.1, g: 0.1, b: 0.1, a: 0.9 }, // 57 = Hover tooltip background
	{ r: 0, g: 0, b: 0, a: 0.65 }, // 58 = Action overlay
	// Gruvbox palette for IDE themes
	{ r: 40 / 255, g: 40 / 255, b: 40 / 255, a: 1 }, // 59 = Gruvbox bg0 (#282828)
	{ r: 60 / 255, g: 56 / 255, b: 54 / 255, a: 1 }, // 60 = Gruvbox bg1 (#3c3836)
	{ r: 80 / 255, g: 73 / 255, b: 69 / 255, a: 1 }, // 61 = Gruvbox bg2 (#504945)
	{ r: 102 / 255, g: 92 / 255, b: 84 / 255, a: 1 }, // 62 = Gruvbox bg3 (#665c54)
	{ r: 124 / 255, g: 111 / 255, b: 100 / 255, a: 1 }, // 63 = Gruvbox bg4 (#7c6f64)
	{ r: 235 / 255, g: 219 / 255, b: 178 / 255, a: 1 }, // 64 = Gruvbox fg1 (#ebdbb2)
	{ r: 213 / 255, g: 196 / 255, b: 161 / 255, a: 1 }, // 65 = Gruvbox fg2 (#d5c4a1)
	{ r: 189 / 255, g: 174 / 255, b: 147 / 255, a: 1 }, // 66 = Gruvbox fg3 (#bdae93)
	{ r: 168 / 255, g: 153 / 255, b: 132 / 255, a: 1 }, // 67 = Gruvbox fg4 (#a89984)
	{ r: 146 / 255, g: 131 / 255, b: 116 / 255, a: 1 }, // 68 = Gruvbox gray (#928374)
	{ r: 251 / 255, g: 73 / 255, b: 52 / 255, a: 1 }, // 69 = Gruvbox red (#fb4934)
	{ r: 204 / 255, g: 36 / 255, b: 29 / 255, a: 1 }, // 70 = Gruvbox red dark (#cc241d)
	{ r: 184 / 255, g: 187 / 255, b: 38 / 255, a: 1 }, // 71 = Gruvbox green (#b8bb26)
	{ r: 152 / 255, g: 151 / 255, b: 26 / 255, a: 1 }, // 72 = Gruvbox green dark (#98971a)
	{ r: 250 / 255, g: 189 / 255, b: 47 / 255, a: 1 }, // 73 = Gruvbox yellow (#fabd2f)
	{ r: 215 / 255, g: 153 / 255, b: 33 / 255, a: 1 }, // 74 = Gruvbox yellow dark (#d79921)
	{ r: 131 / 255, g: 165 / 255, b: 152 / 255, a: 1 }, // 75 = Gruvbox blue (#83a598)
	{ r: 69 / 255, g: 133 / 255, b: 136 / 255, a: 1 }, // 76 = Gruvbox blue dark (#458588)
	{ r: 211 / 255, g: 134 / 255, b: 155 / 255, a: 1 }, // 77 = Gruvbox purple (#d3869b)
	{ r: 177 / 255, g: 98 / 255, b: 134 / 255, a: 1 }, // 78 = Gruvbox purple dark (#b16286)
	{ r: 142 / 255, g: 192 / 255, b: 124 / 255, a: 1 }, // 79 = Gruvbox aqua (#8ec07c)
	{ r: 104 / 255, g: 157 / 255, b: 106 / 255, a: 1 }, // 80 = Gruvbox aqua dark (#689d6a)
	{ r: 254 / 255, g: 128 / 255, b: 25 / 255, a: 1 }, // 81 = Gruvbox orange (#fe8019)
	{ r: 214 / 255, g: 93 / 255, b: 14 / 255, a: 1 }, // 82 = Gruvbox orange dark (#d65d0e)
	{ r: 60 / 255, g: 56 / 255, b: 54 / 255, a: 96 / 255 }, // 83 = Gruvbox line highlight (#3c383660)
	{ r: 104 / 255, g: 157 / 255, b: 106 / 255, a: 64 / 255 }, // 84 = Gruvbox selection (#689d6a40)
	{ r: 80 / 255, g: 73 / 255, b: 69 / 255, a: 153 / 255 }, // 85 = Gruvbox scrollbar thumb (#50494599)
];
export function resolvePaletteIndex(color: { r: number; g: number; b: number; a: number; } | number): number {
	if (typeof color === 'number') {
		return color;
	}
	const index = Msx1Colors.indexOf(color);
	return index === -1 ? null : index;
}

export function invertColorIndex(colorIndex: number): number {
	const color = Msx1Colors[colorIndex];
	if (!color) {
		return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	}
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return luminance > 0.5 ? 0 : 15;
}
