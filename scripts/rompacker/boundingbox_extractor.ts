// @ts-ignore
const { createCanvas } = require('canvas');
import type { Image } from 'canvas';
import type { Area, Polygon, vec2arr } from '../../src/bmsx/rompack/rompack';
import type { ImageResource } from './rompacker.rompack';
import earcut from 'earcut';

/**
 * Dedicated class for extracting bounding boxes and related operations from images.
 */
export class BoundingBoxExtractor {
	private static readonly DEFAULT_ALPHA_T = 32;

	/**
	 * Extracts the tightest bounding box around non-transparent pixels in an image.
	 */
	static extractBoundingBox(image: Image, opts?: { alphaThreshold?: number }): Area {
		const canvas = createCanvas(image.width, image.height);
		const context = canvas.getContext('2d');
		context.drawImage(image, 0, 0, image.width, image.height);
		const imageData = context.getImageData(0, 0, image.width, image.height);
		const data = imageData.data;
		const ALPHA_T = opts?.alphaThreshold ?? this.DEFAULT_ALPHA_T;

		let startx = image.width, starty = image.height, endx = 0, endy = 0;
		let totalWeightX = 0, totalWeightY = 0;
		let totalAlpha = 0;

		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < image.width; x++) {
				const index = (y * image.width + x) * 4;
				const alpha = data[index + 3];
				if (alpha >= ALPHA_T) {
					startx = Math.min(startx, x);
					starty = Math.min(starty, y);
					endx = Math.max(endx, x);
					endy = Math.max(endy, y);
					totalWeightX += x * alpha;
					totalWeightY += y * alpha;
					totalAlpha += alpha;
				}
			}
		}
		return { start: { x: ~~startx, y: ~~starty }, end: { x: ~~endx, y: ~~endy } };
	}

	/**
	 * Extracts concave hull polygons for each contiguous non-transparent region (shape) in the image.
	 * Uses BFS for connected-component labeling and Andrew's monotone chain for concave hull extraction.
	 * Returns an array of polygons (each as an array of {x, y} points), one for each detected shape.
	 *
	 * @param image The image to analyze.
	 * @returns Array of concave hull polygons, one per detected shape.
	 */
	static extractConcaveHull(
		image: Image,
		opts?: { alphaThreshold?: number; thicken?: number; closeGaps?: boolean }
	): Polygon[] {
		const width = image.width;
		const height = image.height;
		const canvas = createCanvas(width, height);
		const context = canvas.getContext('2d');
		context.drawImage(image, 0, 0);
		const data = context.getImageData(0, 0, width, height).data;
		const ALPHA_T = opts?.alphaThreshold ?? this.DEFAULT_ALPHA_T;

	let mask = new Uint8Array(width * height);
		for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
			mask[i] = data[p] >= ALPHA_T ? 1 : 0;
		}

		const thicken = Math.max(0, opts?.thicken ?? 0) | 0;
		// @ts-ignore
		if (thicken > 0) mask = this.dilate(mask, width, height, thicken);
		if (opts?.closeGaps) {
			// @ts-ignore
			mask = this.dilate(mask, width, height, 1);
			// @ts-ignore
			mask = this.erode(mask, width, height, 1);
		}

		const index = (x: number, y: number) => y * width + x;
		const on = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[index(x, y)] === 1;
		const isBorder = (x: number, y: number) => {
			if (!on(x, y)) return false;
			return (
				x === 0 ||
				y === 0 ||
				x === width - 1 ||
				y === height - 1 ||
				!on(x - 1, y) ||
				!on(x + 1, y) ||
				!on(x, y - 1) ||
				!on(x, y + 1)
			);
		};

		const trace = (sx: number, sy: number): vec2arr[] => {
			const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
			let px = sx;
			let py = sy;
			let dir = 0;
			const pts: vec2arr[] = [];
			let guard = width * height * 8;
			do {
				pts.push([px, py]);
				visited[index(px, py)] = 1;
				let found = false;
				for (let k = 0; k < 8; k++) {
					const ndir = (dir + 6 + k) & 7;
					const [dx, dy] = dirs[ndir];
					const nx = px + dx;
					const ny = py + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					const nidx = index(nx, ny);
					if (visited[nidx]) continue;
					if (!isBorder(nx, ny)) continue;
					px = nx;
					py = ny;
					dir = ndir;
					found = true;
					break;
				}
				if (!found) break;
			} while ((px !== sx || py !== sy) && --guard > 0);
			return pts;
		};

	const visited = new Uint8Array(width * height);
		const polygons: Polygon[] = [];
		let hasMask = false;
		let minx = width;
		let miny = height;
		let maxx = -1;
		let maxy = -1;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = index(x, y);
				if (!on(x, y)) continue;
				hasMask = true;
				if (x < minx) minx = x;
				if (y < miny) miny = y;
				if (x > maxx) maxx = x;
				if (y > maxy) maxy = y;
				if (visited[idx] || !isBorder(x, y)) continue;
				const pts = trace(x, y);
				for (const [bx, by] of pts) visited[index(bx, by)] = 1;
				if (pts.length < 3) continue;
				const flat = new Array<number>(pts.length * 2);
				for (let i = 0; i < pts.length; i++) {
					flat[i * 2] = pts[i][0];
					flat[i * 2 + 1] = pts[i][1];
				}
				polygons.push(flat);
			}
		}

		if (polygons.length === 0 && hasMask && minx <= maxx && miny <= maxy) {
			polygons.push([minx, miny, maxx, miny, maxx, maxy, minx, maxy]);
		}
		return polygons;
	}

	private static dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
		let src = mask.slice();
		let dst = new Uint8Array(width * height);
		for (let pass = 0; pass < radius; pass++) {
			dst.fill(0);
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					let v = 0;
					for (let dy = -1; dy <= 1 && v === 0; dy++) {
						for (let dx = -1; dx <= 1 && v === 0; dx++) {
							const nx = x + dx;
							const ny = y + dy;
							if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
								if (src[ny * width + nx] === 1) v = 1;
							}
						}
					}
					dst[y * width + x] = v as 0 | 1;
				}
			}
			src = dst.slice();
		}
		return src;
	}

	private static erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
		let src: Uint8Array = mask.slice();
		let dst = new Uint8Array(width * height);
		for (let pass = 0; pass < radius; pass++) {
			dst.fill(0);
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					let keep = 1;
					for (let dy = -1; dy <= 1 && keep === 1; dy++) {
						for (let dx = -1; dx <= 1 && keep === 1; dx++) {
							const nx = x + dx;
							const ny = y + dy;
							keep = nx >= 0 && ny >= 0 && nx < width && ny < height ? src[ny * width + nx] : 0;
						}
					}
					dst[y * width + x] = keep as 0 | 1;
				}
			}
			src = dst.slice();
		}
		return src;
	}

	static extractConvexHull(
		image: Image,
		opts?: {
			alphaThreshold?: number;
			thicken?: number;
			closeGaps?: boolean;
			mode?: 'convex' | 'concave';
			k?: number;
		}
	): Polygon {
		const { width: w, height: h } = image;
		const canvas = createCanvas(w, h);
		const context = canvas.getContext('2d');
		context.drawImage(image, 0, 0);
		const data = context.getImageData(0, 0, w, h).data;
		const ALPHA_T = opts?.alphaThreshold ?? this.DEFAULT_ALPHA_T;

		let mask = new Uint8Array(w * h) as Uint8Array<ArrayBufferLike>;
		for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = data[p] >= ALPHA_T ? 1 : 0;
		const thicken = Math.max(0, opts?.thicken ?? 0) | 0;
		if (thicken > 0) mask = this.dilate(mask, w, h, thicken);
		if (opts?.closeGaps) {
			mask = this.dilate(mask, w, h, 1);
			mask = this.erode(mask, w, h, 1);
		}

		const index = (x: number, y: number) => y * w + x;
		const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[index(x, y)] === 1;
		const isBoundary = (x: number, y: number) =>
			on(x, y) && (
				x === 0 ||
				y === 0 ||
				x === w - 1 ||
				y === h - 1 ||
				!on(x - 1, y) ||
				!on(x + 1, y) ||
				!on(x, y - 1) ||
				!on(x, y + 1)
			);

		const pts: vec2arr[] = [];
		let minx = w;
		let miny = h;
		let maxx = -1;
		let maxy = -1;
		let onCount = 0;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				if (mask[index(x, y)]) {
					onCount++;
					if (x < minx) minx = x;
					if (y < miny) miny = y;
					if (x > maxx) maxx = x;
					if (y > maxy) maxy = y;
				}
				if (isBoundary(x, y)) pts.push([x, y]);
			}
		}
		if (pts.length === 0) return [];

		const bboxArea = Math.max(1, (maxx - minx + 1) * (maxy - miny + 1));
		const fillRatio = onCount / bboxArea;
		const wantConcave = opts?.mode === 'concave' || (fillRatio < 0.32 && pts.length >= 6);
		if (wantConcave) {
			const k0 = Math.max(3, Math.min(20, opts?.k ?? 8));
			const hullPts = this.concaveHullK(pts, k0);
			if (hullPts.length >= 3) {
				const out = new Array<number>(hullPts.length * 2);
				for (let i = 0; i < hullPts.length; i++) {
					out[i * 2] = hullPts[i][0];
					out[i * 2 + 1] = hullPts[i][1];
				}
				return out;
			}
		}

		return this.computeConvexPolygon(pts).flat();
	}

	public static calculateCenterPoint(boundingBox: Area): vec2arr {
		const middlex = (boundingBox.start.x + boundingBox.end.x) / 2;
		const middley = (boundingBox.start.y + boundingBox.end.y) / 2;
		return [~~middlex, ~~middley];
	}

	private static computeConvexPolygon(points: vec2arr[]): vec2arr[] {
		if (points.length <= 1) return points.slice();
		const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const lower: vec2arr[] = [];
		for (const p of sorted) {
			while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
				lower.pop();
			}
			lower.push(p);
		}
		const upper: vec2arr[] = [];
		for (let i = sorted.length - 1; i >= 0; i--) {
			const p = sorted[i];
			while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
				upper.pop();
			}
			upper.push(p);
		}
		upper.pop();
		lower.pop();
		return lower.concat(upper);
	}

	private static concaveHullK(points: vec2arr[], kStart: number): vec2arr[] {
		if (points.length < 4) return points.slice();
		const key = (p: vec2arr) => `${p[0]}|${p[1]}`;
		const dist2 = (a: vec2arr, b: vec2arr) => {
			const dx = a[0] - b[0];
			const dy = a[1] - b[1];
			return dx * dx + dy * dy;
		};
		const kNearest = (pts: vec2arr[], q: vec2arr, k: number) => pts.slice().sort((a, b) => dist2(a, q) - dist2(b, q)).slice(0, k);
		const minY = points.reduce((m, p) => (p[1] < m[1] || (p[1] === m[1] && p[0] < m[0])) ? p : m, points[0]);
		for (let k = kStart; k <= Math.min(points.length - 1, 35); k++) {
			const used = new Set<string>();
			const hull: vec2arr[] = [minY];
			used.add(key(minY));
			let current = minY;
			let prev: vec2arr = [minY[0] - 1, minY[1]];
			let guard = points.length * 20;
			while (guard-- > 0) {
				const neighbors = kNearest(points, current, k);
				const vx = current[0] - prev[0];
				const vy = current[1] - prev[1];
				neighbors.sort((a, b) => {
					const ax = a[0] - current[0];
					const ay = a[1] - current[1];
					const bx = b[0] - current[0];
					const by = b[1] - current[1];
					const ca = Math.atan2(vx * ay - vy * ax, vx * ax + vy * ay);
					const cb = Math.atan2(vx * by - vy * bx, vx * bx + vy * by);
					return cb - ca;
				});
				let advanced = false;
				for (const candidate of neighbors) {
					const candKey = key(candidate);
					if (used.has(candKey) && !(candidate[0] === minY[0] && candidate[1] === minY[1])) continue;
					const a = current;
					const b = candidate;
					let ok = true;
					for (let i = 1; i < hull.length; i++) {
						const c = hull[i - 1];
						const d = hull[i];
						const adjacent = (a[0] === c[0] && a[1] === c[1]) || (b[0] === d[0] && b[1] === d[1]);
						if (!adjacent && this.segsIntersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) {
							ok = false;
							break;
						}
					}
					if (!ok) continue;
					if (candidate[0] === minY[0] && candidate[1] === minY[1]) {
						if (hull.length >= 3) return hull;
						continue;
					}
					hull.push(candidate);
					used.add(candKey);
					prev = current;
					current = candidate;
					advanced = true;
					break;
				}
				if (!advanced) break;
			}
		}
		return this.computeConvexPolygon(points);
	}

	/**
	 * Cross product of OA and OB vectors (for concave hull orientation test).
	 */
	private static cross(o: vec2arr, a: vec2arr, b: vec2arr): number {
		return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	}

	/**
	 * Note: This module is intended for pack-time/tooling usage (e.g., rom pack build scripts).
	 * Avoid calling this at runtime for performance. SpriteColliderSyncSystem assumes polygons
	 * are already convex (or triangulated) by the pack pipeline.
	 */
	private static area2(poly: Polygon): number {
		let a = 0; const n = poly.length;
		for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
			a += (poly[j] * poly[i + 1] - poly[i] * poly[j + 1]);
		}
		return a * 0.5;
	}

	private static isCCW(poly: Polygon): boolean { return this.area2(poly) > 0; }

	private static pointInTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
		// Barycentric technique
		const v0x = cx - ax, v0y = cy - ay;
		const v1x = bx - ax, v1y = by - ay;
		const v2x = px - ax, v2y = py - ay;
		const den = v0x * v1y - v1x * v0y || 1e-12;
		const u = (v2x * v1y - v1x * v2y) / den;
		const v = (v0x * v2y - v2x * v0y) / den;
		return (u >= -1e-8) && (v >= -1e-8) && (u + v <= 1 + 1e-8);
	}

	private static isConvex(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
		// z of cross((b-a),(c-b)) > 0 for CCW
		return ((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) > 0;
	}

	/** Triangulate a simple polygon (no self-intersect, no holes) into triangles using ear clipping. */
	// @ts-ignore
	private static triangulatePolygon(poly: Polygon): Polygon[] {
		const n = poly.length / 2;
		if (n < 3) return [];
		const idx: number[] = Array.from({ length: n }, (_, i) => i);
		// Ensure CCW
		if (!this.isCCW(poly)) idx.reverse();

		const tris: Polygon[] = [];
		let guard = 0;
		while (idx.length > 3 && guard++ < 10000) {
			let earFound = false;
			const m = idx.length;
			for (let s = 0; s < m; s++) {
				const i0 = idx[(s + m - 1) % m], i1 = idx[s], i2 = idx[(s + 1) % m];
				const ax = poly[i0 * 2], ay = poly[i0 * 2 + 1];
				const bx = poly[i1 * 2], by = poly[i1 * 2 + 1];
				const cx = poly[i2 * 2], cy = poly[i2 * 2 + 1];
				if (!this.isConvex(ax, ay, bx, by, cx, cy)) continue;
				// Check no other point inside
				let contains = false;
				for (let t = 0; t < m; t++) {
					const vi = idx[t]; if (vi === i0 || vi === i1 || vi === i2) continue;
					const px = poly[vi * 2], py = poly[vi * 2 + 1];
					if (this.pointInTri(px, py, ax, ay, bx, by, cx, cy)) { contains = true; break; }
				}
				if (contains) continue;
				// Ear
				tris.push([ax, ay, bx, by, cx, cy]);
				idx.splice(s, 1);
				earFound = true; break;
			}
			if (!earFound) break; // degenerate
		}
		if (idx.length === 3) {
			const a = idx[0], b = idx[1], c = idx[2];
			tris.push([poly[a * 2], poly[a * 2 + 1], poly[b * 2], poly[b * 2 + 1], poly[c * 2], poly[c * 2 + 1]]);
		}
		return tris;
	}

	static decomposeConcaveToConvex(poly: Polygon[], res: ImageResource): Polygon[] {
		const convexes: Polygon[] = [];
		const rings = poly
			.map(p => this.sanitizePolygon(p))
			.filter(p => (p?.length ?? 0) >= 6);

		for (const grp of this.groupRings(rings)) {
			const tris = this.triangulateWithHoles(grp);
			const signedSrc = Math.abs(this.polyArea(grp.outer)) - grp.holes.reduce((s, h) => s + Math.abs(this.polyArea(h)), 0);
			const aTris = tris.reduce((s, t) => s + Math.abs(this.polyArea(t)), 0);
			const absErr = Math.abs(signedSrc - aTris);
			const relErr = signedSrc > 1e-6 ? absErr / signedSrc : 0;
		// Extra validation: compare with mask area from source image when available
		let maskRelErr = 0;
		const maybeCanvas = res?.img as unknown as { getContext?: (type: '2d') => CanvasRenderingContext2D; width: number; height: number; };
		if (maybeCanvas?.getContext) {
			try {
				const ctx = maybeCanvas.getContext('2d');
				const w = maybeCanvas.width, h = maybeCanvas.height;
				const data = ctx.getImageData(0, 0, w, h).data;
				let on = 0; for (let i = 3; i < data.length; i += 4) if (data[i] >= this.DEFAULT_ALPHA_T) on++;
				const maskArea = on; // unit squares
				maskRelErr = maskArea > 1e-6 ? Math.abs(maskArea - aTris) / maskArea : 0;
			} catch { }
			}
			if (!(aTris > 0) || (absErr > 2 && relErr > 1e-2) || (maskRelErr > 0.2)) {
				// Fallback to convex hull fan of all ring points
				const all: number[] = grp.outer.concat(...grp.holes);
				const hull = this.convexHullFromPoly(all);
				const fanTris = this.triangulateFan(hull);
				const aFan = fanTris.reduce((s, t) => s + Math.abs(this.polyArea(t)), 0);
				const rid = (res.name ?? String(res.id) ?? '<unknown>');
				console.warn(`[rompacker] Warning: triangulation area mismatch for resource '${rid}': src=${signedSrc.toFixed(3)} tris=${aTris.toFixed(3)} fallback=${aFan.toFixed(3)}`);
				convexes.push(...fanTris);
			} else {
				convexes.push(...tris);
			}
		}
		return convexes;
	}

	private static polyArea(poly: Polygon): number {
		let a = 0; const n = poly.length;
		for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
			a += (poly[j] * poly[i + 1] - poly[i] * poly[j + 1]);
		}
		return a * 0.5;
	}

	private static sanitizePolygon(poly: Polygon): Polygon {
		if (!poly || poly.length < 6) return poly;
		const eps = 1e-6;
		const n = poly.length;
		const tmp: number[] = [];
		// Remove duplicate/near-duplicate consecutive points
		for (let i = 0; i < n; i += 2) {
			const x = poly[i], y = poly[i + 1];
			const px = tmp.length >= 2 ? tmp[tmp.length - 2] : NaN;
			const py = tmp.length >= 2 ? tmp[tmp.length - 1] : NaN;
			if (isNaN(px) || Math.hypot(x - px, y - py) > eps) { tmp.push(x, y); }
		}
		// Remove non-consecutive duplicates (keep first occurrence)
		const seen = new Set<string>();
		const out: number[] = [];
		for (let i = 0; i < tmp.length; i += 2) {
			const x = tmp[i], y = tmp[i + 1];
			const k = `${x}|${y}`;
			if (seen.has(k)) continue; // drop repeats
			seen.add(k); out.push(x, y);
		}
		// Drop A-B-A spikes and colinear points with intersection guard
		function colinear(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
			return Math.abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) <= eps;
		}
		const clean: number[] = [];
		const m = out.length;
		if (m < 6) return out;
		for (let i = 0; i < m; i += 2) {
			const i0 = (i - 2 + m) % m, i1 = i, i2 = (i + 2) % m;
			const ax = out[i0], ay = out[i0 + 1];
			const bx = out[i1], by = out[i1 + 1];
			const cx = out[i2], cy = out[i2 + 1];
			// A-B-A spike
			if (Math.hypot(ax - cx, ay - cy) <= eps) continue;
			// Colinear removal when safe
			if (!colinear(ax, ay, bx, by, cx, cy)) { clean.push(bx, by); }
		}
		return clean.length >= 6 ? clean : out;
	}

	private static convexHullFromPoly(poly: Polygon): Polygon {
		// Monotone chain on set of points from the polygon
		const pts: { x: number; y: number }[] = [];
		for (let i = 0; i < poly.length; i += 2) pts.push({ x: poly[i], y: poly[i + 1] });
		// Unique points
		const key = (p: { x: number; y: number }) => `${p.x}|${p.y}`;
		const map = new Map<string, { x: number; y: number }>();
		for (const p of pts) map.set(key(p), p);
		const uniq = Array.from(map.values()).sort((a, b) => a.x - b.x || a.y - b.y);
		if (uniq.length < 3) return poly;
		const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
		const lower: any[] = [];
		for (const p of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
		const upper: any[] = [];
		for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
		upper.pop(); lower.pop(); const hull = lower.concat(upper);
		const out: number[] = [];
		for (const p of hull) out.push(p.x, p.y);
		return out;
	}

	private static triangulateFan(poly: Polygon): Polygon[] {
		// Triangle fan from vertex 0
		const tris: Polygon[] = [];
		if (!poly || poly.length < 6) return tris;
		for (let i = 2; i < poly.length - 2; i += 2) {
			tris.push([poly[0], poly[1], poly[i], poly[i + 1], poly[i + 2], poly[i + 3]]);
		}
		return tris;
	}

	private static orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
		return (bx - ax) * (cy - ay) - (by - ay) * (cx - bx);
	}
	private static onSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
		return Math.min(ax, bx) - 1e-8 <= cx && cx <= Math.max(ax, bx) + 1e-8 && Math.min(ay, by) - 1e-8 <= cy && cy <= Math.max(ay, by) + 1e-8;
	}
	private static segsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
		const o1 = this.orient(ax, ay, bx, by, cx, cy);
		const o2 = this.orient(ax, ay, bx, by, dx, dy);
		const o3 = this.orient(cx, cy, dx, dy, ax, ay);
		const o4 = this.orient(cx, cy, dx, dy, bx, by);
		if (o1 * o2 < 0 && o3 * o4 < 0) return true;
		if (Math.abs(o1) < 1e-12 && this.onSeg(ax, ay, bx, by, cx, cy)) return true;
		if (Math.abs(o2) < 1e-12 && this.onSeg(ax, ay, bx, by, dx, dy)) return true;
		if (Math.abs(o3) < 1e-12 && this.onSeg(cx, cy, dx, dy, ax, ay)) return true;
		if (Math.abs(o4) < 1e-12 && this.onSeg(cx, cy, dx, dy, bx, by)) return true;
		return false;
	}

	// @ts-ignore
	private static isSelfIntersecting(poly: Polygon): boolean {
		const n = poly.length;
		for (let i = 0; i < n; i += 2) {
			const i2 = (i + 2) % n;
			const ax = poly[i], ay = poly[i + 1];
			const bx = poly[i2], by = poly[i2 + 1];
			for (let j = i + 4; j < n; j += 2) {
				const j2 = (j + 2) % n;
				// Skip adjacent segments and wrap-around adjacency
				if (i === 0 && j2 === 0) continue;
				const cx = poly[j], cy = poly[j + 1];
				const dx = poly[j2], dy = poly[j2 + 1];
				if (this.segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return true;
			}
		}
		return false;
	}

	private static reverseRing(poly: Polygon): Polygon {
		const out: number[] = [];
		for (let i = poly.length - 2; i >= 0; i -= 2) out.push(poly[i], poly[i + 1]);
		return out;
	}

	private static pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, eps = 1e-9): boolean {
		const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
		if (Math.abs(cross) > eps) return false;
		const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
		if (dot < -eps) return false;
		const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
		if (dot - len2 > eps) return false;
		return true;
	}

	private static pointInPolyInclusive(px: number, py: number, poly: Polygon): boolean {
		for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
			const ax = poly[j], ay = poly[j + 1];
			const bx = poly[i], by = poly[i + 1];
			if (this.pointOnSegment(px, py, ax, ay, bx, by)) return true;
		}
		let inside = false;
		for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
			const xi = poly[i], yi = poly[i + 1];
			const xj = poly[j], yj = poly[j + 1];
			const cut = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
			if (cut) inside = !inside;
		}
		return inside;
	}

	private static sampleInside(r: Polygon): [number, number] {
		let area = 0;
		let cx = 0;
		let cy = 0;
		for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
			const x0 = r[j], y0 = r[j + 1];
			const x1 = r[i], y1 = r[i + 1];
			const cross = x0 * y1 - x1 * y0;
			area += cross;
			cx += (x0 + x1) * cross;
			cy += (y0 + y1) * cross;
		}
		if (Math.abs(area) > 1e-12) {
			cx /= (3 * area);
			cy /= (3 * area);
			if (this.pointInPolyInclusive(cx, cy, r)) return [cx, cy];
		}
		let sx = 0;
		let sy = 0;
		const n = r.length / 2;
		for (let i = 0; i < r.length; i += 2) {
			sx += r[i];
			sy += r[i + 1];
		}
		cx = sx / n + 0.0013;
		cy = sy / n + 0.0017;
		return [cx, cy];
	}

	private static groupRings(rings: Polygon[]): { outer: Polygon; holes: Polygon[] }[] {
		if (rings.length === 0) return [];
		const areaAbs = rings.map(r => Math.abs(this.polyArea(r)));
		const parent = new Array<number>(rings.length).fill(-1);
		const probe: [number, number][] = rings.map(r => this.sampleInside(r));
		for (let i = 0; i < rings.length; i++) {
			const [px, py] = probe[i];
			let best = -1;
			let bestArea = Infinity;
			for (let j = 0; j < rings.length; j++) {
				if (i === j) continue;
				if (this.pointInPolyInclusive(px, py, rings[j]) && areaAbs[j] < bestArea) {
					best = j;
					bestArea = areaAbs[j];
				}
			}
			parent[i] = best;
		}
		const depth = new Array<number>(rings.length).fill(0);
		for (let i = 0; i < rings.length; i++) {
			let d = 0;
			let p = parent[i];
			while (p !== -1) {
				d++;
				p = parent[p];
			}
			depth[i] = d;
		}
		const groups: { outer: Polygon; holes: Polygon[] }[] = [];
		const outerToGroup = new Map<number, number>();
		for (let i = 0; i < rings.length; i++) {
			if ((depth[i] & 1) !== 0) continue;
			let ring = rings[i];
			if (!this.isCCW(ring)) ring = this.reverseRing(ring);
			const gi = groups.push({ outer: ring, holes: [] }) - 1;
			outerToGroup.set(i, gi);
		}
		const evenAncestor = (i: number): number => {
			let p = parent[i];
			while (p !== -1 && (depth[p] & 1) === 1) p = parent[p];
			return p;
		};
		for (let i = 0; i < rings.length; i++) {
			if ((depth[i] & 1) === 0) continue;
			const ea = evenAncestor(i);
			const gi = outerToGroup.get(ea);
			if (gi === undefined) continue;
			let ring = rings[i];
			if (this.isCCW(ring)) ring = this.reverseRing(ring);
			groups[gi].holes.push(ring);
		}
		return groups;
	}

	private static triangulateWithHoles(g: { outer: Polygon; holes: Polygon[] }): Polygon[] {
		const verts: number[] = [];
		const holesIdx: number[] = [];
		const pushRing = (r: Polygon) => { for (let i = 0; i < r.length; i++) verts.push(r[i]); };
		pushRing(g.outer);
		let idx = g.outer.length / 2;
		for (const h of g.holes) { holesIdx.push(idx); pushRing(h); idx += h.length / 2; }
		const triIdx = earcut(verts, holesIdx, 2);
		const out: Polygon[] = [];
		for (let i = 0; i < triIdx.length; i += 3) {
			const a = triIdx[i] * 2, b = triIdx[i + 1] * 2, c = triIdx[i + 2] * 2;
			out.push([verts[a], verts[a + 1], verts[b], verts[b + 1], verts[c], verts[c + 1]]);
		}
		return out;
	}
}
