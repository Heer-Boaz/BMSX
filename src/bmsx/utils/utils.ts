import { Area, Direction, vec2, vec2arr, vec3arr, vec3, type Identifier } from '../rompack/rompack';
import { V3 } from '../render/3d/math3d';

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

export function clamp(value: number, min: number, max: number): number {
	// Fast, branch-based clamp for primitive numbers (avoids Math.min/Math.max calls).
	// If you need to handle min > max, add a swap here; that will cost an extra branch.
	if (min > max) { const t = min; min = max; max = t; }
	if (value < min) return min;
	if (value > max) return max;
	return value;
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

export function translate_vec3(a: vec3, b: vec3): vec3 { return V3.add(a, b); }
/**
 * Translates the given vec3 in place by adding the values of another vec3.
 * @param a - The vec3 to be translated.
 * @param b - The vec3 containing the translation values.
 */

export function translate_inplace_vec3(a: vec3, b: vec3): void { V3.addSelf(a, b); }

/**
 * Generates a random integer between the specified minimum and maximum values (inclusive).
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns A random integer between the minimum and maximum values (inclusive).
 */
export function randomInt(min: number, max: number): number {
	// Normalize to integers and handle swapped bounds
	min = Math.trunc(min);
	max = Math.trunc(max);
	if (min > max) { const t = min; min = max; max = t; }

	const range = max - min + 1;
	// Fast path: Math.random is the fastest approach in JS engines and
	// perfectly acceptable for game randomness. Avoid bitwise hacks (|0)
	// because they truncate to 32-bit signed ints.
	return Math.floor(Math.random() * range) + min;
}

/**
 * Secure / unbiased random integer in [min, max] using crypto.getRandomValues.
 * Uses rejection sampling to avoid modulo bias. Slightly slower — use only when
 * uniformity / cryptographic quality is required.
 */
export function randomIntSecure(min: number, max: number): number {
	// Normalize to integers and handle swapped bounds
	min = Math.trunc(min);
	max = Math.trunc(max);
	if (min > max) { const t = min; min = max; max = t; }

	const range = max - min + 1;
	if (range <= 0) return min; // empty range fallback

	// If crypto isn't available, fall back to Math.random
	const cryptoObj = (typeof crypto !== 'undefined' && (crypto as any).getRandomValues) ? crypto as Crypto : null;
	if (!cryptoObj) return randomInt(min, max);

	// Use 32-bit unsigned randoms and rejection sampling
	const maxUint32 = 0xFFFFFFFF;
	const bucketSize = Math.floor((maxUint32 + 1) / range);
	const limit = bucketSize * range;

	const u32 = new Uint32Array(1);
	while (true) {
		cryptoObj.getRandomValues(u32);
		const r = u32[0];
		if (r < limit) {
			return min + Math.floor(r / bucketSize);
		}
		// otherwise retry (rejection sampling)
	}
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

export function new_vec3(x: number, y: number, z: number): vec3 { return V3.of(x, y, z); }

export function to_vec2(v: vec2 | vec2arr): vec2 {
	return Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y };
}

export function to_vec2arr(v: vec2 | vec2arr): vec2arr {
	return Array.isArray(v) ? v : [v.x, v.y];
}

export function to_vec3(v: vec3 | vec3arr): vec3 { return V3.toVec3(v); }

export function to_vec3arr(v: vec3 | vec3arr): vec3arr { return V3.toArr(v); }

/**
 * Creates a copy of a Vector object.
 * @param toCopy - The Vector object to be copied.
 * @returns A new Vector object with the same x, y and z values as the original.
 */
export function shallowCopy<T>(toCopy: T): T {
	if (Array.isArray(toCopy)) {
		return [...toCopy] as T;
	}
	if (typeof toCopy === 'object') {
		return { ...toCopy } as T;
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
export function trunc_vec3(p: vec3): vec3 { return V3.trunc(p); }
/**
 * Multiplies a vec2 or vec3 by a factor.
 * @param toMult The vec2 or vec3 to multiply.
 * @param factor The factor to multiply by.
 * @returns The multiplied vec2 or vec3.
 */
export function multiply_vec(toMult: vec2 | vec3, factor: number): vec2 | vec3 {
	if ('z' in toMult) { return V3.scale(toMult as vec3, factor); }
	else { const { x, y } = toMult as vec2; return { x: x * factor, y: y * factor }; }
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

/**
 * Calculates the overlap area between two areas.
 * @param a The first area.
 * @param b The second area.
 * @returns The overlap area between the two areas.
 */
export function get_overlap_area(a: Area, b: Area): Area {
	const startX = Math.max(a.start.x, b.start.x);
	const startY = Math.max(a.start.y, b.start.y);
	const endX = Math.min(a.end.x, b.end.x);
	const endY = Math.min(a.end.y, b.end.y);
	return new_area(startX, startY, endX, endY);
}


/// Alternative implementation for Point.Set()

export function set_vec2(p: vec2, new_x: number, new_y: number) {
	p.x = new_x;
	p.y = new_y;
}

export function copy_vec2arr(p: vec2arr): vec2arr {
	return [p[0], p[1]];
}

export function copy_vec3(p: vec3): vec3 { return V3.copy(p); }

export function copy_vec2(p: vec2): vec2 {
	return { x: p.x, y: p.y };
}

export function vec2arr_equals(a: vec2arr, b: vec2arr): boolean {
	if (a?.length !== b?.length) return false;
	return a[0] === b[0] && a[1] === b[1];
}

export function vec3arr_equals(a: vec3arr, b: vec3arr): boolean { return V3.equalsArr(a, b); }

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

export function set_vec3(p: vec3, new_x: number, new_y: number, new_z: number) { V3.set(p, new_x, new_y, new_z); }
/**
 * Overwrites the values of a vec3 with the values from another vec3.
 * @param to_overwrite - The vec3 to be overwritten.
 * @param data - The vec3 containing the new values.
 */

export function set_inplace_vec3(to_overwrite: vec3, data: vec3) { V3.assign(to_overwrite, data); }

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
		// Convert window -> unknown -> Record<string, Storage|undefined> to satisfy TS
		const storage = (window as unknown as Record<string, Storage | undefined>)[storageType];
		if (!storage) return false;
		const testKey = '__test__';
		storage.setItem(testKey, testKey);
		storage.removeItem(testKey);
		return true;
	} catch (error) {
		const e = error;
		return e && e.hasOwnProperty('code') && (
			e.code === 22 || // everything except Firefox
			e.code === 1014 || // Firefox
			(e.hasOwnProperty('name') && (
				e.name === 'QuotaExceededError' || // everything except Firefox
				e.name === 'NS_ERROR_DOM_QUOTA_REACHED' // Firefox
			))
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

/**
 * Small utility to create GLSL-like swizzling on vectors.
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

	// Build a safe character class for the regex by escaping special chars
	const charClass = lettersArr.map(ch => ch.replace(/[-\\^\]]/g, "\\$&")).join('');
	const validLettersRe = new RegExp(`^[${charClass}]{1,${maxLen}}$`);

	// Helper to check swizzle token validity (allows removing whitespace)
	const isValidToken = (tok: string) => {
		const s = tok.replace(/\s+/g, '');
		return validLettersRe.test(s);
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
		get(target, prop, _receiver) {
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
		set(target, prop, value, _receiver) {
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

	return new Proxy(vec, handler);
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

// Utility: wrap a Map so `mapLike['id']` resolves to `map.get('id')` and
// assignments delete/set through the same surface. Also exposes standard Map
// methods bound to the underlying map.
export function makeIndexProxy<V>(backing: Map<Identifier, V>): any {
	return new Proxy(backing, {
		get(target, prop, receiver) {
			// Expose Map API (bound) for internal use
			if (prop === 'get') return (target.get).bind(target);
			if (prop === 'set') return (target.set).bind(target);
			if (prop === 'has') return (target.has).bind(target);
			if (prop === 'delete') return (target.delete).bind(target);
			if (prop === 'clear') return (target.clear).bind(target);
			if (prop === 'size') return (target.size);
			if (prop === Symbol.iterator) return (target[Symbol.iterator]).bind(target);
			if (prop === 'entries') return (target.entries).bind(target);
			if (prop === 'keys') return (target.keys).bind(target);
			if (prop === 'values') return (target.values).bind(target);
			if (prop === 'forEach') return (target.forEach).bind(target);
			// Map-like index access: proxy['id'] → map.get('id')
			if (typeof prop === 'string') return target.get(prop as Identifier);
			// Fallback to default behavior
			return Reflect.get(target, prop, receiver);
		},
		set(target, prop, value) {
			if (typeof prop === 'string') { target.set(prop as Identifier, value as V); return true; }
			// Use Reflect to safely handle symbol keys / non-string property keys
			Reflect.set(target, prop as PropertyKey, value);
			return true;
		},
		has(target, prop) {
			if (typeof prop === 'string') return target.has(prop as Identifier);
			// Use Reflect.has for non-string keys (symbols)
			return Reflect.has(target, prop);
		},
		deleteProperty(target, prop) {
			if (typeof prop === 'string') return target.delete(prop as Identifier);
			// Use Reflect.deleteProperty for symbol/non-string keys
			return Reflect.deleteProperty(target, prop);
		},
	});
}

export interface BarRect {
	startX: number;
	endX: number;
	startY: number;
	endY: number;
}

/**
 * Compute a 3D area representing the filled portion of a horizontal bar.
 * - bar: rectangle bounds for the full bar
 * - value: current value to represent (e.g. hp, mana, progress)
 * - maxValue: maximum value for full bar
 * - z: Z coordinate used for both start and end z
 * - reversed: when true the fill expands leftwards from bar.endX
 *
 * The function clamps value to [0, maxValue] internally.
 */
export function computeBarArea(
	bar: BarRect,
	value: number,
	maxValue: number,
	z: number,
	reversed = false,
): ReturnType<typeof new_area3d> {
	const clamped = clamp(value, 0, maxValue);
	const length = bar.endX - bar.startX;
	const filled = (length * clamped) / (maxValue === 0 ? 1 : maxValue);

	if (!reversed) {
		const endX = bar.startX + filled;
		return new_area3d(bar.startX, bar.startY, z, endX, bar.endY, z);
	} else {
		const startX = bar.endX - filled;
		return new_area3d(startX, bar.startY, z, bar.endX, bar.endY, z);
	}
}

/**
 * Compute the filled portion of a 1-dimensional horizontal bar and return it as a 2-element array.
 *
 * The input `bar` is expected to be a vec2arr containing the start and end X coordinates
 * of the full bar: [startX, endX]. The function clamps `value` to the range [0, maxValue],
 * computes the proportion of the bar that should be filled and returns the resulting
 * start and end X coordinates for the filled region as [filledStartX, filledEndX].
 *
 * When `reversed` is false (default) the fill grows from bar[0] (left) towards bar[1] (right).
 * When `reversed` is true the fill grows from bar[1] (right) towards bar[0] (left).
 *
 * Notes:
 * - If `maxValue` is 0, the function treats the denominator as 1 to avoid division by zero.
 * - The returned array is in the same coordinate space as the input `bar`.
 *
 * @param bar - A two-element array [startX, endX] representing the horizontal bar bounds.
 * @param value - Current value to represent (will be clamped to [0, maxValue]).
 * @param maxValue - Maximum value corresponding to a fully filled bar.
 * @param reversed - If true the filled portion is computed from the right edge inward.
 * @returns A two-element array [filledStartX, filledEndX] describing the filled region.
 */
export function computeBarArea2d(
	bar: vec2arr,
	value: number,
	maxValue: number,
	reversed = false
): vec2arr {
	const clamped = clamp(value, 0, maxValue);
	const length = bar[1] - bar[0];
	const filled = (length * clamped) / (maxValue === 0 ? 1 : maxValue);

	if (!reversed) {
		const endX = bar[0] + filled;
		return [bar[0], endX];
	} else {
		const startX = bar[1] - filled;
		return [startX, bar[1]];
	}
}
