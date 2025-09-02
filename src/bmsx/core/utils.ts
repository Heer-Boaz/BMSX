import { Area, Direction, Size, vec2, vec2arr, vec3, vec3arr, Vector } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';

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

export function to_vec2(v: vec2 | vec2arr): vec2 {
    return Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y };
}

export function to_vec2arr(v: vec2 | vec2arr): vec2arr {
    return Array.isArray(v) ? v : [v.x, v.y];
}

export function to_vec3(v: vec3 | vec3arr): vec3 {
    return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
}

export function to_vec3arr(v: vec3 | vec3arr): vec3arr {
    return Array.isArray(v) ? v : [v.x, v.y, v.z];
}

/**
 * Creates a copy of a Vector object.
 * @param toCopy - The Vector object to be copied.
 * @returns A new Vector object with the same x, y and z values as the original.
 */

export function shallowCopy(toCopy: {} | []) {
    if (Array.isArray(toCopy)) {
        return [...toCopy];
    }
    if (typeof toCopy === 'object') {
        return { ...toCopy };
    }
    return toCopy;
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

export function copy_vec2arr(p: vec2arr): vec2arr {
    return [p[0], p[1]];
}

export function copy_vec3(p: vec3): vec3 {
    return { x: p.x, y: p.y, z: p.z };
}

export function copy_vec2(p: vec2): vec2 {
    return { x: p.x, y: p.y };
}

export function vec2arr_equals(a: vec2arr, b: vec2arr): boolean {
    if (a?.length !== b?.length) return false;
    return a[0] === b[0] && a[1] === b[1];
}

export function vec3arr_equals(a: vec3arr, b: vec3arr): boolean {
    if (a?.length !== b?.length) return false;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
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

// --- Pooling interface ---
interface Pool<T> {
    ensure(): T;
    reset(): void;
}

// Growable pool for Float32Array buffers, which avoids frequent allocations and deallocations.
@excludeclassfromsavegame // This class is excluded from savegame serialization
export class Float32ArrayPool implements Pool<Float32Array> {
    private pool: Float32Array[] = [];
    private index: number = 0;

    constructor(private arraySize: number) {
        this.pool.push(new Float32Array(this.arraySize));
    }

    ensure(): Float32Array {
        if (this.index >= this.pool.length) {
            this.pool.push(new Float32Array(this.arraySize));
        }
        return this.pool[this.index++];
    }

    reset(): void {
        this.index = 0;
    }
}


/*
 * Add a small utility to create GLSL-like swizzling on vectors.
 * Usage:
 *   const v = swizzlable({ x: 1, y: 2, z: 3 });
 *   v.xy        // -> swizzled vector [1,2] (swizzlable)
 *   v.xyz.x     // -> 1
 *   v.rg = [5,6]// -> sets x=5, y=6 on the underlying vector
 */
export function swizzlable<T extends Record<string, any> | any[]>(
    vec: T,
    opts?: { map?: Record<string, string | number>; returnArray?: boolean; maxLen?: number }
): T & Record<string, any> {
    // default mapping (unchanged behaviour)
    const defaultMap: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

    // use provided map or fall back to default; values in customMap are property names or indices
    const customMap = opts?.map;
    const lettersArr = Array.from(new Set(customMap ? Object.keys(customMap) : Object.keys(defaultMap)));
    const maxLen = opts?.maxLen ?? 4;
    const validLettersRe = new RegExp(`^[${lettersArr.join('')}] {0,${maxLen}}$`.replace(' ', '\\s'), ''); // placeholder; we'll use alternative check below

    // Helper to check swizzle token validity (allows removing whitespace)
    const isValidToken = (tok: string) => {
        const s = tok.replace(/\s+/g, '');
        if (s.length === 0 || s.length > maxLen) return false;
        for (let i = 0; i < s.length; i++) if (!lettersArr.includes(s[i])) return false;
        return true;
    };

    // Normalize access to numeric/component by letter using customMap or default behavior
    const getComp = (target: any, letter: string) => {
        if (customMap && customMap.hasOwnProperty(letter)) {
            const key = customMap[letter];
            if (typeof key === 'number') {
                return Array.isArray(target) ? target[key] : target[String(key)];
            }
            return target[key];
        }
        // fallback to original numeric-index based behaviour
        const idx = defaultMap[letter];
        if (idx === undefined) return undefined;
        if (Array.isArray(target)) return target[idx];
        switch (idx) {
            case 0: return target.x ?? target.r ?? target[0];
            case 1: return target.y ?? target.g ?? target[1];
            case 2: return target.z ?? target.b ?? target[2];
            case 3: return target.w ?? target.a ?? target[3];
            default: return undefined;
        }
    };

    const setComp = (target: any, letter: string, value: number) => {
        if (customMap && customMap.hasOwnProperty(letter)) {
            const key = customMap[letter];
            if (typeof key === 'number') {
                if (Array.isArray(target)) target[key] = value;
                else target[String(key)] = value;
                return;
            }
            target[key] = value;
            return;
        }
        const idx = defaultMap[letter];
        if (idx === undefined) return;
        if (Array.isArray(target)) {
            target[idx] = value;
            return;
        }
        switch (idx) {
            case 0: if ('x' in target || 'r' in target) { if ('x' in target) target.x = value; else target.r = value; } else target[0] = value; break;
            case 1: if ('y' in target || 'g' in target) { if ('y' in target) target.y = value; else target.g = value; } else target[1] = value; break;
            case 2: if ('z' in target || 'b' in target) { if ('z' in target) target.z = value; else target.b = value; } else target[2] = value; break;
            case 3: if ('w' in target || 'a' in target) { if ('w' in target) target.w = value; else target.a = value; } else target[3] = value; break;
        }
    };

    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (typeof prop === 'string') {
                // If direct property exists on target, return it (preserve numbers and methods)
                if (prop in target && !isValidToken(prop)) {
                    return target[prop];
                }
                // Swizzle pattern: sequence of valid letters
                const letters = prop.replace(/\s+/g, '');
                if (isValidToken(letters)) {
                    const comps: any[] = [];
                    for (let i = 0; i < letters.length; i++) {
                        const ch = letters[i];
                        comps.push(getComp(target, ch));
                    }
                    // single component -> return value
                    if (comps.length === 1) return comps[0];
                    // multi-component -> return either a plain array or another swizzlable
                    if (opts?.returnArray) return comps;
                    return swizzlable(comps);
                }
            }
            // fallback to default behaviour
            return target[prop];
        },
        set(target, prop, value, receiver) {
            if (typeof prop === 'string') {
                const letters = prop.replace(/\s+/g, '');
                if (isValidToken(letters)) {
                    // Accept value as array-like or object with component names
                    const vals: any[] = [];
                    if (Array.isArray(value)) {
                        for (let i = 0; i < value.length; i++) vals.push(value[i]);
                    } else if (typeof value === 'object' && value !== null) {
                        for (let i = 0; i < letters.length; i++) {
                            const ch = letters[i];
                            // try common component names on the provided object
                            const propNames = [
                                ch === 'x' || ch === 'r' ? 'x' : undefined,
                                ch === 'y' || ch === 'g' ? 'y' : undefined,
                                ch === 'z' || ch === 'b' ? 'z' : undefined,
                                ch === 'w' || ch === 'a' ? 'w' : undefined
                            ].filter(Boolean);
                            let found = false;
                            for (const pn of propNames) {
                                if (value[pn] !== undefined) { vals.push(value[pn]); found = true; break; }
                            }
                            if (!found) {
                                // fallback numeric index on the provided object
                                if (value[i] !== undefined) { vals.push(value[i]); found = true; }
                            }
                            if (!found) vals.push(undefined);
                        }
                    } else {
                        // single primitive value -> broadcast to all components
                        for (let i = 0; i < letters.length; i++) vals.push(value as number);
                    }
                    // write back into target using mapping or default behaviour
                    for (let i = 0; i < letters.length; i++) {
                        const ch = letters[i];
                        if (vals[i] === undefined) continue;
                        setComp(target, ch, vals[i]);
                    }
                    return true;
                }
            }
            // default set
            target[prop] = value;
            return true;
        }
    };

    return new Proxy(vec as any, handler);
}
// ------- small utils -------
export function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a && b && typeof a === 'object') {
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
            return true;
        }
        const ak = Object.keys(a), bk = Object.keys(b);
        if (ak.length !== bk.length) return false;
        for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
        return true;
    }
    return false;
}
export function deepClone<T>(v: T): T {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone) as T;
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, deepClone(val)])) as T;
}

/**
 * Calculates the X coordinate for centering a block of text on the screen.
 *
 * This method determines the longest line of text from `this.fullTextLines`,
 * calculates its width in pixels, and then computes the X coordinate needed
 * to center this line on a screen with a fixed width of 256 pixels.
 *
 * @param fullTextLines - The array of text lines to be centered.
 * @param charWidth - The width of each character in pixels.
 * @param blockWidth - The total width of the block to center the text within.
 * @returns The X coordinate for centering the text block.
 */
export function calculateCenteredBlockX(fullTextLines: string[], charWidth: number, blockWidth: number): number {
    const longestLine = fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
    const longestLineWidth = longestLine.length * charWidth;
    return (blockWidth - longestLineWidth) / 2;
}

/**
 * Splits a given text into an array of strings, where each string represents a line of text
 * that does not exceed the maximum number of characters per line. The method also respects
 * newline characters in the input text.
 *
 * @param text - The input text to be wrapped into lines.
 * @param maxLineLength - The maximum number of characters allowed per line.
 * @returns An array of strings, where each string is a line of text.
 */
export function wrapText(text: string, maxLineLength: number): string[] {
    const words = text.match(/(\S+|\n)/g) || [];
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        if (word === '\n') {
            lines.push(currentLine.trim());
            currentLine = '';
            lines.push('');
        } else {
            const tentativeLine = currentLine ? currentLine + ' ' + word : word;
            if (tentativeLine.length <= maxLineLength) {
                currentLine = tentativeLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine.trim());
                    currentLine = word;
                } else {
                    lines.push(word);
                    currentLine = '';
                }
            }
        }
    }

    if (currentLine.trim()) {
        lines.push(currentLine.trim());
    }

    return lines;
}
