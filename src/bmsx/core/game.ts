import { SM } from "../audio/soundmaster";
import { BaseModel, BinaryCompressor, GameObject, gamePaused, gameResumed, PSG, TextWriter, type InputMap } from "../bmsx";
import { Input } from "../input/input";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { BaseView, Color, DrawImgOptions, DrawRectOptions } from "../render/view";
import { Area, RomPack, Size, vec2, vec3, Vector } from "../rompack/rompack";
import { MSX2ScreenHeight, MSX2ScreenWidth } from "../systems/msx";
import { EventEmitter } from "./eventemitter";
import { Registry } from "./registry";

/**
 * Declare global variables and types.
 */
declare global {
	var $: Game;
	var $rom: RomPack;
	var debug: boolean;
}

global = globalThis || window; // Ensure global is defined

/**
 * The initial scale of the game.
 */
const INITIAL_SCALE = 1;

/**
 * The initial fullscreen mode of the game.
 */
const INITIAL_FULLSCREEN = false;

const INITIAL_VOLUME = 1;

const DEFAULT_CANVAS_OR_ONSCREENGAMEPAD_MUST_RESPECT_LEBENSRAUM: 'canvas' | 'gamepad' = 'canvas';

/**
 * Represents the game options.
 */
export const GameOptions = {
	canvas_or_onscreengamepad_must_respect_lebensraum: DEFAULT_CANVAS_OR_ONSCREENGAMEPAD_MUST_RESPECT_LEBENSRAUM as 'canvas' | 'gamepad',

	/**
	 * The current scale of the game.
	 */
	Scale: INITIAL_SCALE,

	/**
	 * The current fullscreen mode of the game.
	 */
	Fullscreen: INITIAL_FULLSCREEN,

	/**
	 * The volume percentage of the game.
	 */
	VolumePercentage: INITIAL_VOLUME,

	/**
	 * Gets the width of the game window.
	 */
	get WindowWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	},

	/**
	 * Gets the height of the game window.
	 */
	get WindowHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	},

	/**
	 * Gets the width of the game buffer.
	 */
	get BufferWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	},

	/**
	 * Gets the height of the game buffer.
	 */
	get BufferHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	}
}

/**
 * Module containing constants used in the Sintervania application.
 */
export module Constants {
	/**
	 * The path to the directory containing the images.
	 */
	export const IMAGE_PATH: string = 'rom/Graphics/';

	/**
	 * The path to the directory containing the audio files.
	 */
	export const AUDIO_PATH: string = 'rom/';

	/**
	 * The number of save slots available.
	 */
	export const SaveSlotCount: number = 6;

	/**
	 * The value representing a checkpoint save slot.
	 */
	export const SaveSlotCheckpoint: number = -1;

	/**
	 * The path to the save game file.
	 */
	export const SaveGamePath: string = "./Saves/sintervania.sa";

	/**
	 * The path to the checkpoint game file.
	 */
	export const CheckpointGamePath: string = "./Saves/sintervania.chk";

	/**
	 * The path to the options file.
	 */
	export const OptionsPath: string = "./sintervania.ini";
}

/**
 * Represents a type that is a constructor function with a prototype of type T.
 * This effectively allows it to match any class (including abstract classes) that produces T instances.
 * Used for attaching abstract classes to game objects.
 */
export type AbstractConstructor<T> = Function & { prototype: T };

/**
 * Represents the direction values.
 */
export type Direction = 'none' | 'up' | 'right' | 'down' | 'left';

export type Identifier = string | 'model';
export interface Identifiable {
	id: Identifier;
}

export interface Parentable {
	parentid?: Identifier;
}

export interface Disposable {
	dispose(): void;
}

export interface Registerable extends Identifiable, Disposable {
	registrypersistent?: boolean;
}

export interface RegisterablePersistent extends Registerable {
	registrypersistent: true;
}

/**
 * Represents a bitmap font used for rendering text.
 */
export class BFont {
	/**
	 * The map of font resources.
	 */
	protected accessor font_res_map: Record<string, string>;
	public char_width(letter: string): number { return global.$rom.img_assets[this.letter_to_img[letter]].imgmeta.width; }
	public char_height(letter: string): number { return global.$rom.img_assets[this.letter_to_img[letter]].imgmeta.height; }
	readonly letter_to_img: Record<string, string> = {
		'0': 'letter_0',
		'1': 'letter_1',
		'2': 'letter_2',
		'3': 'letter_3',
		'4': 'letter_4',
		'5': 'letter_5',
		'6': 'letter_6',
		'7': 'letter_7',
		'8': 'letter_8',
		'9': 'letter_9',
		'a': 'letter_a',
		'b': 'letter_b',
		'c': 'letter_c',
		'd': 'letter_d',
		'e': 'letter_e',
		'f': 'letter_f',
		'g': 'letter_g',
		'h': 'letter_h',
		'i': 'letter_i',
		'j': 'letter_j',
		'k': 'letter_k',
		'l': 'letter_l',
		'm': 'letter_m',
		'n': 'letter_n',
		'o': 'letter_o',
		'p': 'letter_p',
		'q': 'letter_q',
		'r': 'letter_r',
		's': 'letter_s',
		't': 'letter_t',
		'u': 'letter_u',
		'v': 'letter_v',
		'w': 'letter_w',
		'x': 'letter_x',
		'y': 'letter_y',
		'z': 'letter_z',
		'A': 'letter_a',
		'B': 'letter_b',
		'C': 'letter_c',
		'D': 'letter_d',
		'E': 'letter_e',
		'F': 'letter_f',
		'G': 'letter_g',
		'H': 'letter_h',
		'I': 'letter_i',
		'J': 'letter_j',
		'K': 'letter_k',
		'L': 'letter_l',
		'M': 'letter_m',
		'N': 'letter_n',
		'O': 'letter_o',
		'P': 'letter_p',
		'Q': 'letter_q',
		'R': 'letter_r',
		'S': 'letter_s',
		'T': 'letter_t',
		'U': 'letter_u',
		'V': 'letter_v',
		'W': 'letter_w',
		'X': 'letter_x',
		'Y': 'letter_y',
		'Z': 'letter_z',
		'¡': 'letter_ij', // Dutch letter 'IJ'
		',': 'letter_comma',
		'.': 'letter_dot',
		'!': 'letter_exclamation',
		'?': 'letter_question',
		'\'': 'letter_apostroph',
		' ': 'letter_space',
		':': 'letter_colon',
		'-': 'letter_streep',
		'–': 'letter_streep',
		'/': 'letter_slash',
		'%': 'letter_percent',
		'[': 'letter_speakstart', // opening square bracket
		']': 'letter_speakend',   // closing square bracket
		'(': 'letter_haakjeopen', // opening parenthesis
		')': 'letter_haakjesluit' // closing parenthesis
	};

	/**
	 * Creates a new instance of the `BFont` class.
	 * @param _font_res_map A map of font resources.
	 */
	constructor(_font_res_map: Record<string, string>) {
		this.font_res_map = _font_res_map;
	}

	/**
	 * Converts a character to an image.
	 * @param c The character to convert.
	 * @returns The image as a string.
	 */
	public char_to_img(c: string): string {
		let letter: string;
		if (c in this.letter_to_img) {
			letter = this.letter_to_img[c];
		} else {
			letter = 'letter_question'; // Default to question mark if character is not found
		}
		return letter;
	}

}

/**
 * Calculates the modulus of a number.
 * @param n The dividend.
 * @param p The divisor.
 * @returns The modulus of the division.
 */
export function mod(n: number, p: number): number {
	let r = n % p;
	return r < 0 ? r + p : r;
}

/**
 * Moves an area by adding the specified vector to its start and end points.
 * @param a - The area to be moved.
 * @param p - The vector representing the amount to move the area by.
 * @returns The moved area.
 */
export function moveArea(a: Area, p: vec3): Area {
	return {
		start: { x: a.start.x + p.x, y: a.start.y + p.y },
		end: { x: a.end.x + p.x, y: a.end.y + p.y },
	};
}

/**
 * Translates a 2D vector by adding another vector to it.
 * @param a The first vector.
 * @param b The second vector to be added.
 * @returns The resulting translated vector.
 */
export function translate_vec2(a: vec2, b: vec2): vec2 {
	return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Translates the given vector `a` by the values of vector `b` and stores the result in `a`.
 * @param a - The vector to be translated.
 * @param b - The vector containing the translation values.
 */
export function translate_inplace_vec2(a: vec2, b: vec2): void {
	set_inplace_vec2(a, { x: a.x + b.x, y: a.y + b.y });
}

/**
 * Translates a 3D vector by adding another 3D vector to it.
 * @param a The first 3D vector.
 * @param b The second 3D vector to be added.
 * @returns The resulting translated 3D vector.
 */
export function translate_vec3(a: vec3, b: vec3): vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Translates the given vec3 in place by adding the values of another vec3.
 * @param a - The vec3 to be translated.
 * @param b - The vec3 containing the translation values.
 */
export function translate_inplace_vec3(a: vec3, b: vec3): void {
	set_inplace_vec3(a, { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
}

/// http://stackoverflow.com/questions/4959975/generate-random-value-between-two-numbers-in-javascript
/**
 * Generates a random integer between the specified minimum and maximum values (inclusive).
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns A random integer between the minimum and maximum values (inclusive).
 */
export function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Creates a new 2D vector with the specified x and y coordinates.
 * @param x The x coordinate of the vector.
 * @param y The y coordinate of the vector.
 * @returns The newly created 2D vector.
 */
export function new_vec2(x: number, y: number): vec2 {
	return { x: x, y: y };
}

/**
 * Creates a new vec3 object with the specified x, y, and z coordinates.
 *
 * @param x - The x coordinate of the vec3 object.
 * @param y - The y coordinate of the vec3 object.
 * @param z - The z coordinate of the vec3 object.
 * @returns A new vec3 object with the specified coordinates.
 */
export function new_vec3(x: number, y: number, z: number): vec3 {
	return { x: x, y: y, z: z };
}

/**
 * Creates a copy of a Vector object.
 * @param toCopy - The Vector object to be copied.
 * @returns A new Vector object with the same x, y and z values as the original.
 */
export function copy_vector(toCopy: Vector): Vector {
	return { x: toCopy.x, y: toCopy.y, z: toCopy.z };
}

/**
 * Truncates the components of a 2D vector to integers.
 *
 * @param p The input vector.
 * @returns A new vector with truncated components.
 */
export function trunc_vec2(p: vec2): vec2 {
	return { x: ~~p.x, y: ~~p.y };
}

/**
 * Truncates the values of a vec3 object to integers.
 *
 * @param p - The vec3 object to truncate.
 * @returns A new vec3 object with truncated values.
 */
export function trunc_vec3(p: vec3): vec3 {
	return { x: ~~p.x, y: ~~p.y, z: ~~p.z };
}

/**
 * Multiplies a vec2 or vec3 by a factor.
 * @param toMult The vec2 or vec3 to multiply.
 * @param factor The factor to multiply by.
 * @returns The multiplied vec2 or vec3.
 */
export function multiply_vec(toMult: Vector, factor: number): Vector {
	if ('z' in toMult) {
		const { x, y, z } = toMult as vec3;
		return { x: x * factor, y: y * factor, z: z * factor };
	} else {
		const { x, y } = toMult as vec2;
		return { x: x * factor, y: y * factor };
	}
}

/**
 * Multiplies a vec2 by a factor.
 * @param toMult The vec2 to multiply.
 * @param factor The factor to multiply by.
 * @returns The multiplied vec2.
 */
export function multiply_vec2(toMult: vec2, factor: number): vec2 {
	return { x: toMult.x * factor, y: toMult.y * factor };
}

/**
 * Divides each component of a 2D vector by a scalar value.
 * @param toDivide - The vector to be divided.
 * @param divide_by - The scalar value to divide the vector by.
 * @returns The resulting vector after division.
 */
export function div_vec2(toDivide: vec2, divide_by: number): vec2 {
	return { x: toDivide.x / divide_by, y: toDivide.y / divide_by };
}

/**
 * Sets the values of the given `Area` object in place with the values from another `Area` object.
 *
 * @param a - The target `Area` object to be modified.
 * @param n - The source `Area` object containing the new values.
 */
export function set_inplace_area(a: Area, n: Area): void {
	set_inplace_vec2(a.start, n.start);
	set_inplace_vec2(a.end, n.end);
}

/**
 * Creates a new area with the specified coordinates.
 * @param sx The x-coordinate of the start point.
 * @param sy The y-coordinate of the start point.
 * @param ex The x-coordinate of the end point.
 * @param ey The y-coordinate of the end point.
 * @returns The newly created area.
 */
export function new_area(sx: number, sy: number, ex: number, ey: number): Area {
	return new_area3d(sx, sy, undefined, ex, ey, undefined);
}

export function new_area3d(sx: number, sy: number, sz: number, ex: number, ey: number, ez?: number): Area {
	[sx, sy, ex, ey] = correctAreaStartEnd(sx, sy, ex, ey);
	return { start: { x: sx, y: sy, z: sz }, end: { x: ex, y: ey, z: ez } };
}

function correctAreaStartEnd(x: number, y: number, ex: number, ey: number) {
	if (ex < x) {
		[x, ex] = [ex, x];
	}
	// Reverse y and ey if ey < y
	if (ey < y) {
		[y, ey] = [ey, y];
	}

	return [x, y, ex, ey];
}

export function middlepoint_area(a: Area): vec2 {
	return { x: ~~((a.start.x + a.end.x) / 2), y: ~~((a.start.y + a.end.y) / 2) };
}

/// Alternative implementation for Point.Set()
export function set_vec2(p: vec2, new_x: number, new_y: number) {
	p.x = new_x;
	p.y = new_y;
}

/**
 * Overwrites the values of a vec2 with the values of another vec2.
 * @param p - The vec2 to be overwritten.
 * @param n - The vec2 containing the new values.
 */
export function set_inplace_vec2(p: vec2, n: vec2) {
	p.x = n.x;
	p.y = n.y;
}

/**
 * Sets the values of a vec3 object.
 * @param p - The vec3 object to modify.
 * @param new_x - The new value for the x coordinate.
 * @param new_y - The new value for the y coordinate.
 * @param new_z - The new value for the z coordinate.
 */
export function set_vec3(p: vec3, new_x: number, new_y: number, new_z: number) {
	p.x = new_x;
	p.y = new_y;
	p.z = new_z;
}

/**
 * Overwrites the values of a vec3 with the values from another vec3.
 * @param to_overwrite - The vec3 to be overwritten.
 * @param data - The vec3 containing the new values.
 */
export function set_inplace_vec3(to_overwrite: vec3, data: vec3) {
	to_overwrite.x = data.x;
	to_overwrite.y = data.y;
	to_overwrite.z = data.z;
}

/// Alternative implementation for Size.Set()
export function setSize(s: Size, new_x: number, new_y: number) {
	s.x = new_x;
	s.y = new_y;
}

/**
 * Calculates the size of an area by subtracting the start coordinates from the end coordinates.
 * @param a The area object containing the start and end coordinates.
 * @returns An object representing the size of the area with properties `x` and `y`.
 */
export function area2size(a: Area) {
	return { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
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

/**
 * Calculates the delta vector from a source point to a target point.
 * @param source The source point.
 * @param target The target point.
 * @returns The delta vector from the source point to the target point.
 */
export function GetDeltaFromSourceToTarget(source: vec2, target: vec2): vec2 {
	let delta = { x: 0, y: 0 };
	const dx = target.x - source.x;
	const dy = target.y - source.y;

	if (target.x === source.x) {
		delta.x = 0;
		delta.y = dy > 0 ? 1 : -1;
	}
	else if (target.y === source.y) {
		delta.x = dx > 0 ? 1 : -1;
		delta.y = 0;
	}
	else {
		const adx = Math.abs(dx);
		const ady = Math.abs(dy);
		if (adx > ady) {
			delta.x = dx > 0 ? 1 : -1;
			delta.y = dy / adx;
		}
		else {
			delta.x = dx / ady;
			delta.y = dy > 0 ? 1 : -1;
		}
	}

	return delta;
}

/**
 * Calculates the length of a line segment defined by two 2D points.
 * @param p1 The first point of the line segment.
 * @param p2 The second point of the line segment.
 * @returns The length of the line segment.
 */
export function LineLength(p1: vec3, p2: vec3): number {
	return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) - 1;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
export function isStorageAvailable(storageType: string): boolean {
	try {
		const storage = window[storageType];
		const testKey = '__test__';
		storage.setItem(testKey, testKey);
		storage.removeItem(testKey);
		return true;
	} catch (error) {
		return error.hasOwnProperty('code') && (
			error.code === 22 || // everything except Firefox
			error.code === 1014 || // Firefox
			error.hasOwnProperty('name') && (
				error.name === 'QuotaExceededError' || // everything except Firefox
				error.name === 'NS_ERROR_DOM_QUOTA_REACHED' // Firefox
			)
		);
	}
}

/**
 * Checks if the localStorage is available in the current environment.
 * @returns {boolean} True if localStorage is available, false otherwise.
 */
export function isLocalStorageAvailable(): boolean {
	return isStorageAvailable('localStorage');
}

/**
 * Checks if the session storage is available in the current browser.
 * @returns A boolean value indicating whether the session storage is available.
 */
export function isSessionStorageAvailable(): boolean {
	return isStorageAvailable('sessionStorage');
}

/**
 * Calculates the direction from a subject position to a target position.
 * @param subjectpos The position of the subject.
 * @param targetpos The position of the target.
 * @returns The direction from the subject position to the target position.
 */
export function getLookAtDirection(subjectpos: vec2, targetpos: vec2): Direction {
	const delta: vec2 = { x: targetpos.x - subjectpos.x, y: targetpos.y - subjectpos.y };
	if (Math.abs(delta.x) >= Math.abs(delta.y)) {
		return delta.x < 0 ? 'left' : 'right';
	} else {
		return delta.y < 0 ? 'up' : 'down';
	}
}

/**
 * Returns the opposite direction of the given direction.
 * @param dir The direction to get the opposite of.
 * @returns The opposite direction of the given direction.
 */
export function getOppositeDirection(dir: Direction): Direction {
	switch (dir) {
		case 'up':
			return 'down';
		case 'right':
			return 'left';
		case 'down':
			return 'up';
		case 'left':
			return 'right';
		default:
			return 'none';
	}
}

// --- Rewind Buffer for Per-Frame Rewind System ---
interface RewindFrame {
	timestamp: number; // ms
	frame: number;
	state: Uint8Array; // compressed snapshot
}

class RewindBuffer {
	private buffer: RewindFrame[] = [];
	private maxFrames: number;
	private frameInterval: number; // ms per frame
	private windowMs: number;
	private currentIdx: number = -1; // -1 = latest

	constructor(targetFPS: number, windowSeconds: number) {
		this.frameInterval = 1000 / targetFPS; // ms per frame
		this.windowMs = windowSeconds * 1000; // Convert seconds to milliseconds
		this.maxFrames = Math.ceil(windowSeconds * targetFPS) + 1; // Include an additional frame for the current frame
	}

	push(frame: number, state: Uint8Array) {
		const now = frame * this.frameInterval; // Use frame-based timestamp
		this.buffer.push({ timestamp: now, frame, state });
		// Remove old frames outside window
		const cutoff = now - this.windowMs;
		while (this.buffer.length > this.maxFrames || (this.buffer.length && this.buffer[0].timestamp < cutoff)) {
			this.buffer.shift();
		}
		this.currentIdx = -1;
	}

	canRewind(): boolean {
		return this.buffer.length > 1 && (this.currentIdx < this.buffer.length - 1);
	}
	canForward(): boolean {
		return this.currentIdx > 0;
	}
	rewind(): RewindFrame | null {
		if (!this.canRewind()) return null;
		if (this.currentIdx === -1) this.currentIdx = this.buffer.length - 1;
		if (this.currentIdx < this.buffer.length - 1) this.currentIdx++;
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}
	forward(): RewindFrame | null {
		if (!this.canForward()) return null;
		this.currentIdx--;
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}
	jumpTo(idx: number): RewindFrame | null {
		if (idx < 0 || idx >= this.buffer.length) return null;
		this.currentIdx = this.buffer.length - 1 - idx;
		return this.buffer[idx];
	}
	getCurrent(): RewindFrame | null {
		if (this.currentIdx === -1) return this.buffer[this.buffer.length - 1];
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}
	getFrames(): RewindFrame[] {
		return this.buffer.slice();
	}
	reset() {
		this.currentIdx = -1;
	}
	public getCurrentIdx(): number { return this.currentIdx; }
}

/**
 * Represents the main game loop and manages the game state.
 */
export class Game<M extends BaseModel = BaseModel, V extends BaseView = BaseView> {
	private _debug: boolean = false;
	/**
	 * Indicates whether debug mode is enabled.
	 */
	public get debug(): boolean { return this._debug; }
	/**
	 * The target frames per second for the game.
	 */
	public targetFPS: number = 50;
	/**
	 * The update interval for the bmsx module.
	 */
	public updateInterval: number;
	/**
	 * The timestamp of the last update.
	 */
	public lastUpdate: number = 0;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltaTime: number = 0;
	/**
	 * The accumulated time in milliseconds.
	 */
	public accumulatedTime: number = 0;

	/**
	 * The timestamp of the last game tick.
	 */
	last_gametick_time!: number;
	/**
	 * The turn counter for the game.
	 */
	_turnCounter!: number;
	/**
	 * The ID of the animation frame request.
	 */
	animationFrameRequestid!: number;
	/**
	 * Indicates whether the game is currently running.
	 */
	public running: boolean;

	/**
	 * Indicates whether the game is currently paused (by the debugger).
	 */
	private _paused: boolean;

	public get paused(): boolean { return this._paused; }
	public set paused(value: boolean) {
		this._paused = value;
		if (this._paused === true) {
			SM.pause();
			this.view.showPauseOverlay();
			if (this.debug) {
				// Show debug information
				gamePaused();
			}
		}
		else if (this._paused === false) {
			this.view.showResumeOverlay();
			gameResumed();
			SM.resume();
		}
	}

	/**
	 * Indicates whether the game was updated.
	 * This property is used to track if any changes were made to the game before rendering a new frame.
	 */
	wasupdated: boolean;

	/**
	 * Indicates whether the game should run a single frame and then pause for debugging purposes.
	 */
	public debug_runSingleFrameAndPause!: boolean;

	/**
	 * Retrieves the model instance of type T.
	 * @returns The model instance of type T.
	 * @template T - The type of the model.
	 */
	public modelAs<T extends BaseModel = BaseModel>(): T { return this.registry.get<T>('model'); }

	public get model(): M { return this.modelAs<M>(); }

	/**
	 * Retrieves the global view of type T.
	 * @returns The global view of type T.
	 */
	public viewAs<T extends BaseView = BaseView>(): T { return this.registry.get<T>('view'); }

	public get view(): V { return this.viewAs<V>(); }

	public get event_emitter(): EventEmitter { return this.registry.get<EventEmitter>('event_emitter'); }

	public get input(): Input { return this.registry.get<Input>('input'); }
	public get registry(): Registry { return Registry.instance; }
	public get sndmaster(): SM { return SM; }

	public emit(event_name: string, emitter: Identifiable, ...args: any[]) {
		this.event_emitter.emit(event_name, emitter, ...args);
	}

	public get<T extends Registerable>(id: Identifier): T {
		return this.registry.get<T>(id);
	}

	public getGameObject<T extends GameObject>(id: Identifier): T {
		return this.model.getGameObject<T>(id);
	}

	public has(id: Identifier): boolean {
		return this.registry.has(id);
	}

	public register(value: Registerable): void {
		this.registry.register(value);
	}

	public deregister(id: Identifier | Registerable): void {
		this.registry.deregister(id);
	}

	public spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void {
		this.model.spawn(o, pos, ignoreSpawnhandler);
	}

	public exile(o: GameObject): void {
		this.model.exile(o);
	}

	public drawImg(options: DrawImgOptions): void {
		this.view.drawImg(options);
	}

	public drawRectangle(options: DrawRectOptions): void {
		this.view.drawRectangle(options);
	}

	public fillRectangle(options: DrawRectOptions): void {
		this.view.fillRectangle(options);
	}

	public drawText(x: number, y: number, textToWrite: string | string[], z: number = 950, font?: BFont, color?: Color, backgroundColor?: Color): void {
		TextWriter.drawText(x, y, textToWrite, z, font, color, backgroundColor);
	}

	public playAudio(id: string): void {
		SM.play(id);
	}

	public stopEffect(): void {
		SM.stopEffect();
	}

	public stopMusic(): void {
		SM.stopMusic();
	}

	public set volume(volume: number) {
		SM.volume = volume;
	}

	public get volume(): number {
		return SM.volume;
	}

	public setInputMap(playerIndex: number, map: InputMap): void {
		this.input.getPlayerInput(playerIndex).setInputMap(map);
	}

	public checkActionTriggered(playerIndex: number, action: string): boolean {
		return this.input.getPlayerInput(playerIndex).checkActionTriggered(action);
	}

	public checkActionsTriggered(playerIndex: number, ...actions: { id: string, def: string }[]): string[] {
		return this.input.getPlayerInput(playerIndex).checkActionsTriggered(...actions);
	}

	public getActionState(playerIndex: number, action: string, window?: number) {
		return this.input.getPlayerInput(playerIndex).getActionState(action, window);
	}

	public getPressedActions(playerIndex: number, query?: ActionStateQuery) {
		return this.input.getPlayerInput(playerIndex).getPressedActions(query);
	}

	public consumeAction(playerIndex: number, actionToConsume: ActionState | string) {
		this.input.getPlayerInput(playerIndex).consumeAction(actionToConsume);
	}

	public consumeActions(playerIndex: number, ...actionsToConsume: (ActionState | string)[]) {
		this.input.getPlayerInput(playerIndex).consumeActions(...actionsToConsume);
	}

	public hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void {
		this.input.hideOnscreenGamepadButtons(gamepad_button_ids);
	}

	public getViewportSize(): Size {
		return this.view.viewportSize;
	}

	private rewindBuffer: RewindBuffer;
	private readonly REWINDBUFFER_LENGTH_SECONDS: number = 60; // Length of the rewind buffer in seconds

	/**
	 * Constructs a new instance of the BMSX class.
	 */
	constructor(rom: RomPack, model: BaseModel, view: BaseView, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false) {
		global = globalThis;
		global['$'] = this;
		window['$'] = this;
		global['$rom'] = rom;
		window['$rom'] = rom;
		this.running = false;
		this._paused = false;
		this.wasupdated = true;
		this.updateInterval = 1000 / this.targetFPS;
		this.rewindBuffer = new RewindBuffer(this.targetFPS, this.REWINDBUFFER_LENGTH_SECONDS);

		this.init_on_boot(rom, model, view, sndcontext, gainnode, debug);
	}

	/**
	 * Inits the game on boot.
	 * @param rom - The ROM pack containing game assets.
	 * @param model - The model object that manages the game state.
	 * @param view - The view object that manages the game display.
	 * @param sndcontext - The audio context used for playing sounds.
	 * @param gainnode - The gain node used for controlling the volume of sounds.
	 * @param debug - Whether to enable debug mode. Defaults to false.
	 */
	private async init_on_boot(rom: RomPack, model: BaseModel, view: BaseView, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false): Promise<Game> {
		this._debug = debug ?? this._debug;

		global['debug'] = this.debug;
		global['$rom'] = rom;

		BaseView.images = rom.images;
		Object.keys(rom.img_assets).forEach((key => {
			const imgAsset = rom.img_assets[key];
			BaseView.imagesMeta[key] = imgAsset.imgmeta;
		}));
		EventEmitter.instance; // Init event emitter
		Input.instance; // Init input module
		if ($.input.isOnscreenGamepadEnabled) {
			$.input.enableOnscreenGamepad();
		}
		$.view.init(); // Init the view. Placed here to ensure that the Game object is available to the view and that the Input module is initialized
		await SM.init(rom['snd_assets'], sndcontext, GameOptions.VolumePercentage, gainnode);
		try {
			await PSG.init(sndcontext, GameOptions.VolumePercentage, gainnode);
		} catch (error) {
			console.error("Failed to initialize PSG:", error);
			// Optionally, provide fallback behavior or notify the user
		}
		SM.volume = 0;

		if (this.debug) {
			// @ts-ignore
			window['model'] = model;
			// @ts-ignore
			window['view'] = view;
			// @ts-ignore
			window['$rom'] = global.$rom;
			// @ts-ignore
			window['$'] = global.$;
			// @ts-ignore
			window['registry'] = global.registry;
			// @ts-ignore
			window['eventEmitter'] = $.event_emitter;

			Input.instance.enableDebugMode();
		}

		// Prevent the user from accidentally closing the game window if not in debug mode
		if (!this.debug) {
			window.addEventListener('beforeunload', e => { e.preventDefault(); return e.returnValue = 'Are you sure you want to exit this awesome game?'; }, true);
		}

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		model.init_on_boot(); // Init the model to populate states (and do other init stuff). Placed here to ensure that the Game object is available to the model

		return this; // Allow chaining
	}

	/**
	 * Gets the current turn counter value.
	 * @returns The current turn counter value.
	 */
	public get turnCounter(): number {
		return this._turnCounter;
	}

	/**
	 * Starts the game loop and sets the `running` flag to `true`.
	 * @returns void
	 */
	public start(): void {
		this.running = true;
		this.lastUpdate = performance.now();
		this.last_gametick_time = performance.now();
		this.run(performance.now());
	}

	/**
	 * Updates the game state with the given delta time.
	 * @param deltaTime - The time elapsed since the last update.
	 * @returns void
	 */
	public update(deltaTime: number): void {
		const game = global.$;
		const model = game.model;
		model.run(deltaTime);
		// --- Rewind snapshot logic ---
		try {
			const snapshot = model.save(false);
			const compressedSnapshot = BinaryCompressor.compressBinary(snapshot, { disableLZ77: false, disableRLE: false });
			// Write the compress % to the console
			// if (game.debug) {
			// 	const compressionRatio = (compressedSnapshot.length / snapshot.length) * 100;
			// 	console.log(`Rewind snapshot compressed from ${snapshot.length} bytes to ${compressedSnapshot.length} bytes (${compressionRatio.toFixed(2)}% of original size)`);
			// }
			this.rewindBuffer.push(this.turnCounter, compressedSnapshot);
		} catch (e) {
			console.warn('Rewind snapshot failed:', e);
		}
		if (game.debug_runSingleFrameAndPause) {
			game.debug_runSingleFrameAndPause = false;
			game.paused = true;
		}
		game.wasupdated = true;
	}

	/**
	 * Runs the game loop and updates the game state.
	 * @param currentTime - The current time in milliseconds.
	 * @returns void
	 */
	public run(currentTime: number): void {
		const game = global.$;
		if (!game.running) return;

		game.deltaTime = currentTime - game.lastUpdate;
		game.lastUpdate = currentTime;
		game.accumulatedTime += game.deltaTime;

		game.wasupdated = false;

		while (game.accumulatedTime >= game.updateInterval) {
			if (!game.paused) {
				Input.instance.pollInput();
				game.update(game.updateInterval);
			}
			game.accumulatedTime -= game.updateInterval;
		}

		if (game.wasupdated) {
			game.view.drawgame();
			window.dispatchEvent(new Event('frame'));
		}

		game.animationFrameRequestid = window.requestAnimationFrame(game.run);
	}

	/**
	 * Stops the game loop and clears the screen, stops all sound effects and music.
	 * @returns void
	 */
	public stop(): void {
		global.$.running = false;
		window.cancelAnimationFrame(this.animationFrameRequestid);
		window.requestAnimationFrame(() => {
			$.view.clear.call($.view);
			$.view.handleResize.call($.view);
			SM.stopEffect();
			SM.stopMusic();
		});
	}

	// --- Rewind API ---
	public canRewind() { return this.rewindBuffer.canRewind(); }
	public canForward() { return this.rewindBuffer.canForward(); }

	private loadRewindFrame(frame: RewindFrame): void {
		this.model.load(frame.state, true);
		window.dispatchEvent(new Event('frame'));
	}

	public rewindFrame(): boolean {
		const frame = this.rewindBuffer.rewind();
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}
	public forwardFrame(): boolean {
		const frame = this.rewindBuffer.forward();
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}
	public jumpToFrame(idx: number): boolean {
		const frame = this.rewindBuffer.jumpTo(idx);
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}
	public getRewindFrames(): RewindFrame[] {
		return this.rewindBuffer.getFrames();
	}
	public resetRewind() {
		this.rewindBuffer.reset();
	}
	public getCurrentRewindFrameIndex(): number {
		const frames = this.rewindBuffer.getFrames();
		const idx = this.rewindBuffer.getCurrentIdx();
		if (idx === -1) return frames.length - 1;
		return frames.length - 1 - idx;
	}
}
