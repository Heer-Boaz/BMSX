import type { vec2 as FormatVec2, vec2arr as FormatVec2Arr, vec3 as FormatVec3, vec3arr as FormatVec3Arr } from '../rompack/format';

export class Vec2 {
	constructor(public x = 0, public y = 0) {}

	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}

	lengthSquared(): number {
		return this.x * this.x + this.y * this.y;
	}

	normalized(): Vec2 {
		const len = this.length();
		if (len > 0) {
			return new Vec2(this.x / len, this.y / len);
		}
		return new Vec2(0, 0);
	}

	dot(other: Vec2): number {
		return this.x * other.x + this.y * other.y;
	}
}

export class Vec3 {
	constructor(public x = 0, public y = 0, public z = 0) {}

	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}

	lengthSquared(): number {
		return this.x * this.x + this.y * this.y + this.z * this.z;
	}

	normalized(): Vec3 {
		const len = this.length();
		if (len > 0) {
			return new Vec3(this.x / len, this.y / len, this.z / len);
		}
		return new Vec3(0, 0, 0);
	}

	dot(other: Vec3): number {
		return this.x * other.x + this.y * other.y + this.z * other.z;
	}

	cross(other: Vec3): Vec3 {
		return new Vec3(
			this.y * other.z - this.z * other.y,
			this.z * other.x - this.x * other.z,
			this.x * other.y - this.y * other.x,
		);
	}
}

export class Vec4 {
	constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}
}

export type vec2 = FormatVec2;
export type vec3 = FormatVec3;
export type vec2arr = FormatVec2Arr;
export type vec3arr = FormatVec3Arr;

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
	a.x += b.x;
	a.y += b.y;
	a.z += b.z;
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
	return { x, y, z };
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
export function multiply_vec(toMult: vec2 | vec3, factor: number): vec2 | vec3 {
	if ('z' in toMult) {
		return { x: toMult.x * factor, y: toMult.y * factor, z: toMult.z * factor };
	}
	const { x, y } = toMult as vec2;
	return { x: x * factor, y: y * factor };
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

export function multiply_vec3(toMult: vec3, factor: number): vec3 {
	return { x: toMult.x * factor, y: toMult.y * factor, z: toMult.z * factor };
}

export function dot_vec3(a: vec3, b: vec3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross_vec3(a: vec3, b: vec3): vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

export function norm_vec3(a: vec3): vec3 {
	const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
	if (len > 0) {
		return { x: a.x / len, y: a.y / len, z: a.z / len };
	}
	return { x: 0, y: 0, z: 0 };
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
	return a[0] === b[0] && a[1] === b[1];
}

export function vec3arr_equals(a: vec3arr, b: vec3arr): boolean {
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

/**
 * Calculates the length of a line segment defined by two 2D points.
 * @param p1 The first point of the line segment.
 * @param p2 The second point of the line segment.
 * @returns The length of the line segment.
 */
export function line_length(p1: vec3, p2: vec3): number {
	return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) - 1;
}
