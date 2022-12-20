import { BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { BaseModel } from "./model";

declare global {
	var game: Game;
	var model: BaseModel;
	var view: BaseView;
}

const fps: number = 50;
const fpstime: number = 1000 / fps;

//@insavegame
export class GameOptions {
	public static readonly INITIAL_SCALE: number = 1;
	public static readonly INITIAL_FULLSCREEN: boolean = false;

	public static Scale: number = GameOptions.INITIAL_SCALE;
	public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
	public static VolumePercentage: number = 50;
	public static MusicVolumePercentage: number = 50;

	public static get WindowWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get WindowHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	}

	public static get BufferWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get BufferHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	}
}

export module Constants {
	export const IMAGE_PATH: string = 'rom/Graphics/';
	export const AUDIO_PATH: string = 'rom/';

	export const SaveSlotCount: number = 6;
	export const SaveSlotCheckpoint: number = -1;
	export const SaveGamePath: string = "./Saves/sintervania.sa";
	export const CheckpointGamePath: string = "./Saves/sintervania.chk";
	export const OptionsPath: string = "./sintervania.ini";
}

export enum Direction {
	None = 0,
	Up = 1,
	Right = 2,
	Down = 3,
	Left = 4,
}
export interface Point {
	x: number;
	y: number;
}

export type Size = Point;

export interface Area {
	start: Point;
	end: Point;
}

export class BFont {
	protected accessor font_res_map: Record<string, string>;
	get char_width(): number { return 8; }
	get char_height(): number { return 8; }

	constructor(_font_res_map: Record<string, string>) {
		this.font_res_map = _font_res_map;
	}

	public char_to_img(c: string): string {
		let letter: string;
		let _font_res_map = this.font_res_map;
		switch (c) {
			case '0':
				letter = _font_res_map.letter_0;
				break;
			case '1':
				letter = _font_res_map.letter_1;
				break;
			case '2':
				letter = _font_res_map.letter_2;
				break;
			case '3':
				letter = _font_res_map.letter_3;
				break;
			case '4':
				letter = _font_res_map.letter_4;
				break;
			case '5':
				letter = _font_res_map.letter_5;
				break;
			case '6':
				letter = _font_res_map.letter_6;
				break;
			case '7':
				letter = _font_res_map.letter_7;
				break;
			case '8':
				letter = _font_res_map.letter_8;
				break;
			case '9':
				letter = _font_res_map.letter_9;
				break;
			case 'a':
				letter = _font_res_map.letter_a;
				break;
			case 'b':
				letter = _font_res_map.letter_b;
				break;
			case 'c':
				letter = _font_res_map.letter_c;
				break;
			case 'd':
				letter = _font_res_map.letter_d;
				break;
			case 'e':
				letter = _font_res_map.letter_e;
				break;
			case 'f':
				letter = _font_res_map.letter_f;
				break;
			case 'g':
				letter = _font_res_map.letter_g;
				break;
			case 'h':
				letter = _font_res_map.letter_h;
				break;
			case 'i':
				letter = _font_res_map.letter_i;
				break;
			case 'j':
				letter = _font_res_map.letter_j;
				break;
			case 'k':
				letter = _font_res_map.letter_k;
				break;
			case 'l':
				letter = _font_res_map.letter_l;
				break;
			case 'm':
				letter = _font_res_map.letter_m;
				break;
			case 'n':
				letter = _font_res_map.letter_n;
				break;
			case 'o':
				letter = _font_res_map.letter_o;
				break;
			case 'p':
				letter = _font_res_map.letter_p;
				break;
			case 'q':
				letter = _font_res_map.letter_q;
				break;
			case 'r':
				letter = _font_res_map.letter_r;
				break;
			case 's':
				letter = _font_res_map.letter_s;
				break;
			case 't':
				letter = _font_res_map.letter_t;
				break;
			case 'u':
				letter = _font_res_map.letter_u;
				break;
			case 'v':
				letter = _font_res_map.letter_v;
				break;
			case 'w':
				letter = _font_res_map.letter_w;
				break;
			case 'x':
				letter = _font_res_map.letter_x;
				break;
			case 'y':
				letter = _font_res_map.letter_y;
				break;
			case 'z':
				letter = _font_res_map.letter_z;
				break;
			case 'A':
				letter = _font_res_map.letter_a;
				break;
			case 'B':
				letter = _font_res_map.letter_b;
				break;
			case 'C':
				letter = _font_res_map.letter_c;
				break;
			case 'D':
				letter = _font_res_map.letter_d;
				break;
			case 'E':
				letter = _font_res_map.letter_e;
				break;
			case 'F':
				letter = _font_res_map.letter_f;
				break;
			case 'G':
				letter = _font_res_map.letter_g;
				break;
			case 'H':
				letter = _font_res_map.letter_h;
				break;
			case 'I':
				letter = _font_res_map.letter_i;
				break;
			case 'J':
				letter = _font_res_map.letter_j;
				break;
			case 'K':
				letter = _font_res_map.letter_k;
				break;
			case 'L':
				letter = _font_res_map.letter_l;
				break;
			case 'M':
				letter = _font_res_map.letter_m;
				break;
			case 'N':
				letter = _font_res_map.letter_n;
				break;
			case 'O':
				letter = _font_res_map.letter_o;
				break;
			case 'P':
				letter = _font_res_map.letter_p;
				break;
			case 'Q':
				letter = _font_res_map.letter_q;
				break;
			case 'R':
				letter = _font_res_map.letter_r;
				break;
			case 'S':
				letter = _font_res_map.letter_s;
				break;
			case 'T':
				letter = _font_res_map.letter_t;
				break;
			case 'U':
				letter = _font_res_map.letter_u;
				break;
			case 'V':
				letter = _font_res_map.letter_v;
				break;
			case 'W':
				letter = _font_res_map.letter_w;
				break;
			case 'X':
				letter = _font_res_map.letter_x;
				break;
			case '¡':
				letter = _font_res_map.letter_ij;
				break;
			case 'Y':
				letter = _font_res_map.letter_y;
				break;
			case 'Z':
				letter = _font_res_map.letter_z;
				break;
			case ',':
				letter = _font_res_map.letter_comma;
				break;
			case '.':
				letter = _font_res_map.letter_dot;
				break;
			case '!':
				letter = _font_res_map.letter_exclamation;
				break;
			case '?':
				letter = _font_res_map.letter_question;
				break;
			case '\'':
				letter = _font_res_map.letter_apostroph;
				break;
			case ' ':
				letter = _font_res_map.letter_space;
				break;
			case ':':
				letter = _font_res_map.letter_colon;
				break;
			case '-':
				letter = _font_res_map.letter_streep;
				break;
			case '/':
				letter = _font_res_map.letter_slash;
				break;
			case '%':
				letter = _font_res_map.letter_percent;
				break;
			case '[':
				letter = _font_res_map.letter_speakstart;
				break;
			case ']':
				letter = _font_res_map.letter_speakend;
				break;
			default:
				letter = _font_res_map.letter_question;
				break;
		}
		return letter;
	}
}

export function mod(n: number, p: number): number {
	let r = n % p;
	return r < 0 ? r + p : r;
}

export function moveArea(a: Area, p: Point): Area {
	return <Area>{
		start: <Point>{ x: a.start.x + p.x, y: a.start.y + p.y },
		end: <Point>{ x: a.end.x + p.x, y: a.end.y + p.y },
	};
}

export function addPoints(a: Point, b: Point): Point {
	return <Point>{ x: a.x + b.x, y: a.y + b.y };
}

/// http://stackoverflow.com/questions/4959975/generate-random-value-between-two-numbers-in-javascript
export function randomInt(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

export function newPoint(x: number, y: number): Point {
	return <Point>{ x: x, y: y };
}

export function copyPoint(toCopy: Point): Point {
	return <Point>{ x: toCopy.x, y: toCopy.y };
}

export function multiplyPoint(toMult: Point, factor: number): Point {
	return <Point>{ x: toMult.x * factor, y: toMult.y * factor };
}

export function divPoint(toDivide: Point, divide_by: number): Point {
	return <Point>{ x: toDivide.x / divide_by, y: toDivide.y / divide_by };
}

export function newArea(sx: number, sy: number, ex: number, ey: number): Area {
	return <Area>{ start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

export function newSize(x: number, y: number): Size {
	return <Size>{ x: x, y: y };
}

/// Alternative implementation for Point.Set()
export function setPoint(p: Point, new_x: number, new_y: number) {
	p.x = new_x;
	p.y = new_y;
}

/// Alternative implementation for Size.Set()
export function setSize(s: Size, new_x: number, new_y: number) {
	s.x = new_x;
	s.y = new_y;
}

export function area2size(a: Area) {
	return <Size>{ x: a.end.x - a.start.x, y: a.end.y - a.start.y };
}

export function addElementToScreen(element: HTMLElement): void {
	(document.getElementById('gamescreen') as HTMLElement).appendChild(element);
}

export function removeElementFromScreen(element: HTMLElement): void {
	(document.getElementById('gamescreen') as HTMLElement).removeChild(element);
}

export function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement {
	let result = document.createElement('div');
	if (classnames) {
		classnames.forEach(x => {
			result.classList.add(x);
		});
	}

	let rimg = document.createElement('img');
	if (imgsrc) rimg.src = imgsrc;
	else if (img) rimg.src = img.src;
	else throw ('Cannot create sprite without an image or image source!');

	result.appendChild(rimg);

	return result;
}

export function GetDeltaFromSourceToTarget(source: Point, target: Point): Point {
	let delta = <Point>{ x: 0, y: 0 };

	if (Math.abs(target.x - source.x - 0) < 0.01) {
		delta.x = 0;
		delta.y = (target.y - source.y) > 0 ? 1 : -1;
	}
	else if (Math.abs(target.y - source.y - 0) < 0.01) {
		delta.x = (target.x - source.x) > 0 ? 1 : -1;
		delta.y = 0;
	}
	else if (Math.abs((target.x - source.x)) > Math.abs((target.y - source.y))) {
		delta.x = (target.x - source.x) > 0 ? 1 : -1;
		delta.y = (target.y - source.y) / (Math.abs(target.x - source.x));
	}
	else {
		delta.x = (target.x - source.x) / (Math.abs(target.y - source.y));
		delta.y = (target.y - source.y) > 0 ? 1 : -1;
	}

	return delta;
}

export function LineLength(p1: Point, p2: Point): number {
	return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - 1;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
export function isStorageAvailable(type: string): boolean {
	try {
		// var storage: any = window[type],
		//     x = '__storage_test__';
		// storage.setItem(x, x);
		// storage.removeItem(x);
		return true;
	}
	catch (e) {
		return e instanceof DOMException && (
			// everything except Firefox
			e.code === 22 ||
			// Firefox
			e.code === 1014 ||
			// test name field too, because code might not be present
			// everything except Firefox
			e.name === 'QuotaExceededError' ||
			// Firefox
			e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
			// acknowledge QuotaExceededError only if there's something already stored
			true;// storage.length !== 0;
	}
}

export function isLocalStorageAvailable(): boolean {
	return isStorageAvailable('localStorage');
}

export function isSessionStorageAvailable(): boolean {
	return isStorageAvailable('sessionStorage');
}

export function getLookAtDirection(subjectpos: Point, targetpos: Point): Direction {
	let delta: Point = <Point>{ x: subjectpos.x - targetpos.x, y: subjectpos.x - targetpos.y };
	if (Math.abs(delta.x) >= Math.abs(delta.y)) {
		if (delta.x < 0)
			return Direction.Right;
		else return Direction.Left;
	}
	else {
		if (delta.y < 0)
			return Direction.Down;
		else return Direction.Up;
	}
}

export function getOppositeDirection(dir: Direction): Direction {
	switch (dir) {
		case Direction.Up:
			return Direction.Down;
		case Direction.Right:
			return Direction.Left;
		case Direction.Down:
			return Direction.Up;
		case Direction.Left:
			return Direction.Right;
		default:
			return Direction.None;
	}
}

export class Game {
	lastTick!: number;
	_turnCounter!: number;
	animationFrameRequestid!: number;
	public running: boolean;
	public paused: boolean;
	wasupdated: boolean;
	public rom: RomLoadResult;
	public debug_runSingleFrameAndPause!: boolean;
	public model<T extends BaseModel>(): T { return <T>global.model; }
	public view<T extends BaseView>(): T { return <T>global.view; }

	constructor(_rom: RomLoadResult, _model: BaseModel, _view: BaseView, sndcontext: AudioContext, gainnode: GainNode) {
		global['game'] = this;
		this.rom = _rom;

		global['model'] = _model;
		global['view'] = _view;

		BaseView.images = _rom.images;
		global.view.init();
		SM.init(_rom['sndresources'], sndcontext, gainnode);
		Input.init();

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		global.model.init_model_state_machines(global.model.constructor_name).do_one_time_game_init();

		this.running = false;
		this.paused = false;
		this.wasupdated = true;
	}

	public get turnCounter(): number {
		return this._turnCounter;
	}

	public start(): void {
		// global.view.handleResize();

		this.running = true;
		this.lastTick = performance.now();
		this.run(performance.now());
	}

	public update(): void {
		global.model.run();
		if (global.game.debug_runSingleFrameAndPause) {
			global.game.debug_runSingleFrameAndPause = false;
			global.game.paused = true;
		}
	}

	public run(tFrame: number): void {
		let game = global.game;
		if (!game.running) return;

		game.animationFrameRequestid = window.requestAnimationFrame(game.run);
		let nextTick = game.lastTick + fpstime;
		let numTicks = 0;

		// If tFrame < nextTick then 0 ticks need to be updated (0 is default for numTicks).
		// If tFrame = nextTick then 1 tick needs to be updated (and so forth).
		// Note: As we mention in summary, you should keep track of how large numTicks is.
		// If it is large, then either your game was asleep, or the machine cannot keep up.
		if (tFrame > nextTick) {
			let timeSinceTick = tFrame - game.lastTick;
			numTicks = Math.floor(timeSinceTick / fpstime);
		}

		for (let i = 0; i < numTicks; i++) {
			++game._turnCounter;
			game.lastTick = game.lastTick + fpstime; // Now lastTick is this tick.
			if (game.paused) continue;
			Input.pollGamepadInput();
			game.update();
			// game.update(game.lastTick);
		}
		global.view.drawgame();
	}

	public stop(): void {
		global.game.running = false;
		window.cancelAnimationFrame(this.animationFrameRequestid);
		window.requestAnimationFrame(() => {
			global.view.clear();
			global.view.handleResize();
			SM.stopEffect();
			SM.stopMusic();
		});
	}
}
