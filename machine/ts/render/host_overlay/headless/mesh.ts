import { clamp } from '../../../common/clamp';
import type { HeadlessHost2DContext } from '../../headless/host_2d';
import { blendPixel } from '../../headless/pixel_ops';
import { hostMeshReflected, writeHostMeshClipMatrix, type HostMeshScene, type HostMeshSceneRenderSubmission } from '../mesh';

export type HeadlessHostMeshTarget = {
	readonly width: number;
	readonly height: number;
	pixels: Uint8Array;
	depth: Float32Array;
	matrix: Float64Array;
	vertices: Float64Array;
	projected: Float64Array;
	codes: Uint8Array;
	clipA: Float64Array;
	clipB: Float64Array;
};

const EMPTY_BYTES = new Uint8Array(0);
const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_NUMBERS = new Float64Array(0);

export function createHeadlessHostMeshTarget(scene: HostMeshScene): HeadlessHostMeshTarget {
	return {
		width: scene.width, height: scene.height,
		pixels: new Uint8Array(scene.width * scene.height * 4), depth: new Float32Array(scene.width * scene.height),
		matrix: new Float64Array(16), vertices: EMPTY_NUMBERS, projected: EMPTY_NUMBERS, codes: EMPTY_BYTES,
		// Six half-space clips add at most six vertices to a triangle.
		clipA: new Float64Array(9 * 4), clipB: new Float64Array(9 * 4),
	};
}

export function disposeHeadlessHostMeshTarget(target: HeadlessHostMeshTarget): void {
	target.pixels = EMPTY_BYTES; target.depth = EMPTY_FLOATS;
	target.matrix = target.vertices = target.projected = target.clipA = target.clipB = EMPTY_NUMBERS;
	target.codes = EMPTY_BYTES;
}

/** Scene-local depth and transparent color storage, rerendered only on publication. */
export function renderHeadlessHostMeshScene(target: HeadlessHostMeshTarget, scene: HostMeshScene): void {
	target.pixels.fill(0); target.depth.fill(0);
	const matrix = target.matrix, halfWidth = target.width * 0.5, halfHeight = target.height * 0.5;
	for (const instance of scene.instances) {
		const mesh = instance.mesh, positions = mesh.positions, count = positions.length / 3;
		if (target.codes.length < count) {
			target.vertices = new Float64Array(count * 4);
			target.projected = new Float64Array(count * 3);
			target.codes = new Uint8Array(count);
		}
		writeHostMeshClipMatrix(matrix, scene, instance);
		const vertices = target.vertices, projected = target.projected, codes = target.codes;
		for (let index = 0; index < count; index++) {
			const source = index * 3, destination = index * 4;
			const x = positions[source], y = positions[source + 1], z = positions[source + 2];
			const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
			const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
			const cz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
			const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
			vertices[destination] = cx; vertices[destination + 1] = cy;
			vertices[destination + 2] = cz; vertices[destination + 3] = cw;
			const code = (cx < -cw ? 1 : 0) | (cx > cw ? 2 : 0) | (cy < -cw ? 4 : 0)
				| (cy > cw ? 8 : 0) | (cz < 0 ? 16 : 0) | (cz > cw ? 32 : 0);
			codes[index] = code;
			if (code === 0) {
				const reciprocal = 1 / cw;
				projected[source] = halfWidth + cx * reciprocal * halfWidth;
				projected[source + 1] = halfHeight - cy * reciprocal * halfHeight;
				projected[source + 2] = cz * reciprocal;
			}
		}
		const reflected = hostMeshReflected(instance), indices = mesh.indices;
		if (indices === undefined) {
			for (let index = 0; index < mesh.drawCount; index += 3)
				drawTriangle(target, index, index + 1, index + 2, mesh.color, mesh.doubleSided, reflected);
		} else {
			for (let index = 0; index < mesh.drawCount; index += 3)
				drawTriangle(target, indices[index], indices[index + 1], indices[index + 2], mesh.color, mesh.doubleSided, reflected);
		}
	}
}

function drawTriangle(target: HeadlessHostMeshTarget, a: number, b: number, c: number,
	color: number, doubleSided: boolean, reflected: boolean): void {
	const codes = target.codes, ca = codes[a], cb = codes[b], cc = codes[c], mask = ca | cb | cc;
	if (mask === 0) { rasterTriangle(target, target.projected, a * 3, b * 3, c * 3, color, doubleSided, reflected); return; }
	if ((ca & cb & cc) !== 0) return;
	let source = target.clipA, destination = target.clipB, count = 3;
	const vertices = target.vertices;
	for (let component = 0; component < 4; component++) {
		source[component] = vertices[a * 4 + component];
		source[4 + component] = vertices[b * 4 + component];
		source[8 + component] = vertices[c * 4 + component];
	}
	for (let plane = 0; plane < 6; plane++) {
		if ((mask & (1 << plane)) === 0) continue;
		const component = plane >> 1, sign = (plane & 1) === 0 ? 1 : -1;
		let previous = 0, da = source[component] * sign + (plane === 4 ? 0 : source[3]), output = 0;
		for (let index = 1; index <= count; index++) {
			const next = index === count ? 0 : index * 4;
			const db = source[next + component] * sign + (plane === 4 ? 0 : source[next + 3]);
			if (da >= 0) {
				for (let field = 0; field < 4; field++) destination[output * 4 + field] = source[previous + field];
				output++;
			}
			if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
				// Always interpolate outside -> inside: the opposite traversal of
				// a shared edge produces the same intersection coordinates.
				const outside = da < 0 ? previous : next, inside = da < 0 ? next : previous;
				const distance = da < 0 ? da : db, other = da < 0 ? db : da, t = distance / (distance - other);
				const offset = output * 4;
				for (let field = 0; field < 4; field++) {
					const value = source[outside + field];
					destination[offset + field] = value + (source[inside + field] - value) * t;
				}
				destination[offset + component] = plane === 4 ? 0 : destination[offset + 3] * -sign;
				output++;
			}
			previous = next; da = db;
		}
		if (output < 3) return;
		count = output;
		const swap = source; source = destination; destination = swap;
	}
	const halfWidth = target.width * 0.5, halfHeight = target.height * 0.5;
	for (let index = 0; index < count; index++) {
		const offset = index * 4, reciprocal = 1 / source[offset + 3];
		source[offset] = halfWidth + source[offset] * reciprocal * halfWidth;
		source[offset + 1] = halfHeight - source[offset + 1] * reciprocal * halfHeight;
		source[offset + 2] *= reciprocal;
	}
	for (let index = 1; index < count - 1; index++)
		rasterTriangle(target, source, 0, index * 4, (index + 1) * 4, color, doubleSided, reflected);
}

/** Pixel-centre top-left coverage and linearly interpolated post-divide depth. */
function rasterTriangle(target: HeadlessHostMeshTarget, points: Float64Array, a: number, b: number, c: number,
	color: number, doubleSided: boolean, reflected: boolean): void {
	const x0 = points[a], y0 = points[a + 1], z0 = points[a + 2];
	let x1 = points[b], y1 = points[b + 1], z1 = points[b + 2];
	let x2 = points[c], y2 = points[c + 1], z2 = points[c + 2];
	let area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
	if (area === 0 || !doubleSided && (area < 0) === reflected) return;
	if (area < 0) {
		let swap = x1; x1 = x2; x2 = swap;
		swap = y1; y1 = y2; y2 = swap;
		swap = z1; z1 = z2; z2 = swap;
		area = -area;
	}
	const startX = Math.max(0, Math.trunc(Math.min(x0, x1, x2))), startY = Math.max(0, Math.trunc(Math.min(y0, y1, y2)));
	const endX = Math.min(target.width, Math.trunc(Math.max(x0, x1, x2)) + 1);
	const endY = Math.min(target.height, Math.trunc(Math.max(y0, y1, y2)) + 1);
	const dx0 = x2 - x1, dy0 = y2 - y1, dx1 = x0 - x2, dy1 = y0 - y2, dx2 = x1 - x0, dy2 = y1 - y0;
	const include0 = dy0 < 0 || dy0 === 0 && dx0 > 0, include1 = dy1 < 0 || dy1 === 0 && dx1 > 0;
	const include2 = dy2 < 0 || dy2 === 0 && dx2 > 0;
	const dzdx = (-dy0 * z0 - dy1 * z1 - dy2 * z2) / area;
	const dzdy = (dx0 * z0 + dx1 * z1 + dx2 * z2) / area;
	const red = (color >>> 16) & 255, green = (color >>> 8) & 255, blue = color & 255;
	const pixels = target.pixels, depth = target.depth, width = target.width;
	for (let y = startY; y < endY; y++) {
		const px = startX + 0.5, py = y + 0.5;
		let e0 = dx0 * (py - y1) - dy0 * (px - x1), e1 = dx1 * (py - y2) - dy1 * (px - x2);
		let e2 = dx2 * (py - y0) - dy2 * (px - x0), z = z0 + (px - x0) * dzdx + (py - y0) * dzdy;
		let sample = y * width + startX;
		for (let x = startX; x < endX; x++, sample++, e0 -= dy0, e1 -= dy1, e2 -= dy2, z += dzdx) {
			if (e0 < 0 || e0 === 0 && !include0 || e1 < 0 || e1 === 0 && !include1 || e2 < 0 || e2 === 0 && !include2) continue;
			// The comparison and storage consume the same depth32float value.
			const fragmentDepth = Math.fround(z);
			if (fragmentDepth > depth[sample]) {
				depth[sample] = fragmentDepth;
				const offset = sample * 4;
				pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue; pixels[offset + 3] = 255;
			}
		}
	}
}

/** Composite the actual scene command at its ordered UI position; scene depth stays private. */
export function drawHeadlessHostMeshScene(context: HeadlessHost2DContext, command: HostMeshSceneRenderSubmission): void {
	const source = context.meshScenes.get(command.scene), { scale, offsetX, offsetY } = context.transform;
	const originX = command.left * scale + offsetX, originY = command.top * scale + offsetY;
	const xx = (command.right - command.left) * scale, yy = (command.bottom - command.top) * scale;
	if (xx === 0 || yy === 0) return;
	const left = Math.min(originX, originX + xx), right = Math.max(originX, originX + xx);
	const top = Math.min(originY, originY + yy), bottom = Math.max(originY, originY + yy), clip = context.clip;
	let startX = Math.max(clip.left, Math.trunc(left)), endX = Math.min(clip.right, Math.trunc(right) + 1);
	let startY = Math.max(clip.top, Math.trunc(top)), endY = Math.min(clip.bottom, Math.trunc(bottom) + 1);
	if (startX + 0.5 < left) startX++;
	if (startY + 0.5 < top) startY++;
	if (endX - 0.5 >= right) endX--;
	if (endY - 0.5 >= bottom) endY--;
	const stepX = source.width / xx, stepY = source.height / yy;
	const firstX = (startX + 0.5 - originX) * stepX, pixels = source.pixels;
	for (let y = startY; y < endY; y++) {
		const row = clamp(Math.trunc((y + 0.5 - originY) * stepY), 0, source.height - 1) * source.width;
		let u = firstX, offset = (y * context.width + startX) * 4;
		for (let x = startX; x < endX; x++, u += stepX, offset += 4) {
			const from = (row + clamp(Math.trunc(u), 0, source.width - 1)) * 4;
			blendPixel(context.target, offset, pixels[from], pixels[from + 1], pixels[from + 2], pixels[from + 3]);
		}
	}
}
