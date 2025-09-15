import type { Area, Polygon, vec2arr } from 'bmsx/rompack/rompack';
import type { WorldObject } from 'bmsx/core/object/worldobject';
import type { World } from 'bmsx/core/world';
import { new_area } from 'bmsx/utils/utils';
import { Service } from 'bmsx/core/service';
import { Collider2DComponent } from 'bmsx/component/collisioncomponents';

type Shape2D = { kind: 'poly', polys: Polygon[] } | { kind: 'circle', c: { x: number; y: number; r: number } };

/** CollisionManager hosts geometry tests and a per-World broad-phase. */
class Collision2DService extends Service {
	// --- Broad-phase spatial index (per World) ---
	private _bp = new WeakMap<World, Collision2DBroadphaseIndex>();

	constructor() {
		super({ id: 'collision' });
		// No ticking needed; this is a query service. Lifecycle is managed by systems using it.
		this.active = true;
	}

	ensureIndex(world: World, cellSize = 64): Collision2DBroadphaseIndex {
		let idx = this._bp.get(world);
		if (!idx) { idx = new Collision2DBroadphaseIndex(cellSize); this._bp.set(world, idx); }
		return idx;
	}

	rebuildIndex(world: World, cellSize = 64): void {
		const idx = this.ensureIndex(world, cellSize);
		idx.clear();
		for (const o of world.activeObjects) { idx.addOrUpdate(o); }
	}

	queryAABB(world: World, area: Area): WorldObject[] {
		return this.ensureIndex(world).queryAABB(area);
	}

	raycastWorld(world: World, origin: vec2arr, dir: vec2arr, maxDist: number): { obj: WorldObject; t: number }[] {
		return this.ensureIndex(world).raycast(origin, dir, maxDist);
	}

	sweepAABB(world: World, area: Area, delta: vec2arr): WorldObject[] {
		return this.ensureIndex(world).sweepAABB(area, delta);
	}

	/** Rect-rect (AABB) test. */
	detectAABBAreas(a1: Area, a2: Area): boolean {
		return !(a1.start.x > a2.end.x || a1.end.x < a2.start.x || a1.end.y < a2.start.y || a1.start.y > a2.end.y);
	}

	/** Converts Area to polygon list [x0,y0, x1,y1, x2,y2, x3,y3]. */
	areaToPoly(area: Area): Polygon {
		return [area.start.x, area.start.y, area.end.x, area.start.y, area.end.x, area.end.y, area.start.x, area.end.y] as number[];
	}

	/** WorldObject vs WorldObject/Area collision. Polygons if present; fallback to AABB. */
	collides(self: WorldObject, other: WorldObject | Area): boolean {
		if (!self.hittable) return false;
		if ((other as WorldObject)?.id) {
			const o = other as WorldObject;
			if (!o.hittable) return false;
			if (!this.detectAABBAreas(self.hitbox, o.hitbox)) return false;
			const aShape = this.getShape(self);
			const bShape = this.getShape(o);
			return this.shapeIntersects(aShape, bShape);
		} else {
			const a = other as Area;
			if (!this.detectAABBAreas(self.hitbox, a)) return false;
			const aShape = this.getShape(self);
			const bShape: Shape2D = { kind: 'poly', polys: [this.areaToPoly(a)] };
			return this.shapeIntersects(aShape, bShape);
		}
	}

	/** Returns centroid of polygon intersection if any; null otherwise. */
	getCollisionCentroid(a: WorldObject, b: WorldObject): vec2arr | null {
		if (!a.hittable || !b.hittable) return null;
		if (!this.detectAABBAreas(a.hitbox, b.hitbox)) return null;
		const p1 = a.hasHitPolygon ? (a.hitpolygon as Polygon[]) : [this.areaToPoly(a.hitbox)];
		const p2 = b.hasHitPolygon ? (b.hitpolygon as Polygon[]) : [this.areaToPoly(b.hitbox)];
		const points = this.polygonsIntersectionPoints(p1, p2);
		if (!points || points.length === 0) return null;
		return this.getCentroidFromList(points);
	}

	// ---- Shapes and contact helpers ----
	private getShape(obj: WorldObject): Shape2D {
		const col = obj.getFirstComponent(Collider2DComponent);
		const wc = col?.worldCircle ?? null;
		if (wc) return { kind: 'circle', c: wc };
		const polys = col?.worldPolygons ?? null;
		if (polys && polys.length > 0) return { kind: 'poly', polys };
		return { kind: 'poly', polys: [this.areaToPoly(obj.hitbox)] };
	}

	private shapeIntersects(a: Shape2D, b: Shape2D): boolean {
		if (a.kind === 'circle' && b.kind === 'circle') return this.circleCircleOverlap(a.c, b.c);
		if (a.kind === 'circle' && b.kind === 'poly') return this.circlePolyOverlap(a.c, b.polys);
		if (a.kind === 'poly' && b.kind === 'circle') return this.circlePolyOverlap(b.c, a.polys);
		if (a.kind === 'poly' && b.kind === 'poly') return this.polygonsIntersect(a.polys, b.polys);
		return false;
	}

	private circleCircleOverlap(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): boolean {
		const dx = a.x - b.x, dy = a.y - b.y; const rr = a.r + b.r; return (dx * dx + dy * dy) <= (rr * rr);
	}

	private circlePolyOverlap(c: { x: number; y: number; r: number }, polys: Polygon[]): boolean {
		for (const poly of polys) {
			const n = poly.length;
			// Edge normals
			for (let i = 0; i < n; i += 2) {
				const j = (i + 2 === n) ? 0 : i + 2;
				const ex = poly[j] - poly[i];
				const ey = poly[j + 1] - poly[i + 1];
				const nx = -ey, ny = ex;
				const len = Math.hypot(nx, ny) || 1; const ax = nx / len, ay = ny / len;
				let pmin = Infinity, pmax = -Infinity;
				for (let k = 0; k < n; k += 2) { const proj = poly[k] * ax + poly[k + 1] * ay; if (proj < pmin) pmin = proj; if (proj > pmax) pmax = proj; }
				const cproj = c.x * ax + c.y * ay; const cmin = cproj - c.r, cmax = cproj + c.r;
				const sep = Math.max(pmin - cmax, cmin - pmax);
				if (sep > 0) return false;
			}
			// Axis to closest vertex
			let vx = poly[0], vy = poly[1]; let bestd = (vx - c.x) ** 2 + (vy - c.y) ** 2;
			for (let k = 2; k < n; k += 2) { const dx = poly[k] - c.x, dy = poly[k + 1] - c.y; const d = dx * dx + dy * dy; if (d < bestd) { bestd = d; vx = poly[k]; vy = poly[k + 1]; } }
			const ax = vx - c.x, ay = vy - c.y; const l = Math.hypot(ax, ay) || 1; const ux = ax / l, uy = ay / l;
			let pmin = Infinity, pmax = -Infinity;
			for (let k = 0; k < n; k += 2) { const v = poly[k] * ux + poly[k + 1] * uy; if (v < pmin) pmin = v; if (v > pmax) pmax = v; }
			const cproj = c.x * ux + c.y * uy; const cmin = cproj - c.r, cmax = cproj + c.r;
			const sep = Math.max(pmin - cmax, cmin - pmax);
			if (sep > 0) return false;
		}
		return true;
	}

	private contactCircleCircle(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) {
		const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy); const rr = a.r + b.r; if (dist >= rr) return undefined;
		const depth = rr - dist; const nx = dist > 1e-8 ? dx / dist : 1, ny = dist > 1e-8 ? dy / dist : 0; const point = { x: b.x + nx * (b.r), y: b.y + ny * (b.r) };
		return { normal: { x: nx, y: ny }, depth, point };
	}

	private contactCirclePoly(c: { x: number; y: number; r: number }, poly: { polys: Polygon[] }) {
		let bestAxis: { x: number; y: number } | null = null; let bestOverlap = Infinity;
		const testAxis = (ax: number, ay: number) => {
			const p = poly.polys[0]; const n = p.length;
			let pmin = Infinity, pmax = -Infinity;
			for (let i = 0; i < n; i += 2) { const proj = p[i] * ax + p[i + 1] * ay; if (proj < pmin) pmin = proj; if (proj > pmax) pmax = proj; }
			const cproj = c.x * ax + c.y * ay; const cmin = cproj - c.r, cmax = cproj + c.r;
			const sep = Math.max(pmin - cmax, cmin - pmax);
			if (sep > 0) return false;
			const overlap = -sep; if (overlap < bestOverlap) { bestOverlap = overlap; bestAxis = { x: ax, y: ay }; }
			return true;
		};
		for (const p of poly.polys) {
			const n = p.length;
			for (let i = 0; i < n; i += 2) { const j = (i + 2 === n) ? 0 : i + 2; const nx = -(p[j + 1] - p[i + 1]); const ny = (p[j] - p[i]); const l = Math.hypot(nx, ny) || 1; if (!testAxis(nx / l, ny / l)) return undefined; }
			let vx = p[0], vy = p[1]; let bd = (vx - c.x) ** 2 + (vy - c.y) ** 2;
			for (let k = 2; k < n; k += 2) { const dx = p[k] - c.x, dy = p[k + 1] - c.y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; vx = p[k]; vy = p[k + 1]; } }
			const ax = vx - c.x, ay = vy - c.y; const l = Math.hypot(ax, ay) || 1; if (!testAxis(ax / l, ay / l)) return undefined;
		}
		if (!bestAxis) return undefined; return { normal: bestAxis, depth: bestOverlap };
	}

	private contactPolyPoly(a: Shape2D, b: Shape2D) {
		if (a.kind !== 'poly' || b.kind !== 'poly') return undefined;
		let bestAxis: { x: number; y: number } | null = null; let bestOverlap = Infinity;
		const testAxesFrom = (ps: Polygon[]) => {
			for (const p of ps) {
				const n = p.length;
				for (let i = 0; i < n; i += 2) {
					const j = (i + 2 === n) ? 0 : i + 2; const nx = -(p[j + 1] - p[i + 1]); const ny = (p[j] - p[i]); const l = Math.hypot(nx, ny) || 1; const ax = nx / l, ay = ny / l;
					let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
					for (const pa of a.polys) for (let k = 0; k < pa.length; k += 2) { const proj = pa[k] * ax + pa[k + 1] * ay; if (proj < minA) minA = proj; if (proj > maxA) maxA = proj; }
					for (const pb of b.polys) for (let k = 0; k < pb.length; k += 2) { const proj = pb[k] * ax + pb[k + 1] * ay; if (proj < minB) minB = proj; if (proj > maxB) maxB = proj; }
					const sep = Math.max(minA - maxB, minB - maxA);
					if (sep > 0) return false;
					const overlap = -sep; if (overlap < bestOverlap) { bestOverlap = overlap; bestAxis = { x: ax, y: ay }; }
				}
			}
			return true;
		};
		if (!testAxesFrom(a.polys)) return undefined;
		if (!testAxesFrom(b.polys)) return undefined;
		if (!bestAxis) return undefined; return { normal: bestAxis, depth: bestOverlap };
	}

	// Casts
	segmentCastWorld(world: World, p0: vec2arr, p1: vec2arr) {
		const minx = Math.min(p0[0], p1[0]), miny = Math.min(p0[1], p1[1]); const maxx = Math.max(p0[0], p1[0]), maxy = Math.max(p0[1], p1[1]);
		const cover = new_area(minx, miny, maxx, maxy);
		const cand = this.queryAABB(world, cover);
		const hits: { obj: WorldObject; t: number }[] = [];
		const rx = p1[0] - p0[0], ry = p1[1] - p0[1];
		const len = Math.hypot(rx, ry) || 1;
		for (const o of cand) {
			const s = this.getShape(o);
			let bestT = Infinity;
			if (s.kind === 'poly') {
				for (const poly of s.polys) {
					const n = poly.length;
					for (let i = 0; i < n; i += 2) {
						const j = (i + 2 === n) ? 0 : i + 2;
						const ax = poly[i], ay = poly[i + 1];
						const bx = poly[j], by = poly[j + 1];
						const t = raySegmentIntersect(p0[0], p0[1], rx, ry, ax, ay, bx, by);
						if (t !== null && t >= 0 && t <= len && t < bestT) bestT = t;
					}
				}
			} else if (s.kind === 'circle') {
				const t = rayCircleIntersect(p0[0], p0[1], rx, ry, s.c.x, s.c.y, s.c.r);
				if (t !== null && t >= 0 && t <= len && t < bestT) bestT = t;
			}
			if (bestT !== Infinity) hits.push({ obj: o, t: bestT });
		}
		hits.sort((a, b) => a.t - b.t); return hits;
	}

	circleCastWorld(world: World, origin: vec2arr, radius: number, dir: vec2arr, maxDist: number) {
		const end: vec2arr = [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist];
		const minx = Math.min(origin[0], end[0]) - radius, miny = Math.min(origin[1], end[1]) - radius; const maxx = Math.max(origin[0], end[0]) + radius, maxy = Math.max(origin[1], end[1]) + radius;
		const cover = new_area(minx, miny, maxx, maxy); const cand = this.queryAABB(world, cover); const hits: { obj: WorldObject; t: number }[] = [];
		const rx = end[0] - origin[0], ry = end[1] - origin[1]; const len = Math.hypot(rx, ry) || 1;
		// Exact: cast circle vs shapes by casting ray against Minkowski-summed shapes (circle-center path)
		for (const o of cand) {
			const s = this.getShape(o);
			let bestT = Infinity;
			if (s.kind === 'poly') {
				// Inflate each edge by radius: equivalent to ray vs segment at distance r → use ray vs segment then subtract r along normal approx (use supporting offset via normals). Simplification: test ray vs edges offset by circle radius along edge normals.
				for (const poly of s.polys) {
					const n = poly.length;
					for (let i = 0; i < n; i += 2) {
						const j = (i + 2 === n) ? 0 : i + 2;
						// Offset endpoints outward by normal*radius
						const ex = poly[j] - poly[i]; const ey = poly[j + 1] - poly[i + 1];
						const l = Math.hypot(ex, ey) || 1; const nx = -(ey / l), ny = (ex / l);
						const ax = poly[i] + nx * radius, ay = poly[i + 1] + ny * radius;
						const bx = poly[j] + nx * radius, by = poly[j + 1] + ny * radius;
						const t = raySegmentIntersect(origin[0], origin[1], rx, ry, ax, ay, bx, by);
						if (t !== null && t >= 0 && t <= len && t < bestT) bestT = t;
					}
				}
			} else if (s.kind === 'circle') {
				// Circle cast vs circle → ray vs circle of radius (r + s.r)
				const t = rayCircleIntersect(origin[0], origin[1], rx, ry, s.c.x, s.c.y, s.c.r + radius);
				if (t !== null && t >= 0 && t <= len && t < bestT) bestT = t;
			}
			if (bestT !== Infinity) hits.push({ obj: o, t: bestT });
		}
		hits.sort((a, b) => a.t - b.t); return hits;
	}
	/** Compute contact info (normal, depth, point) using SAT/GJK approximations where possible. */
	getContact2D(a: WorldObject, b: WorldObject): { normal?: { x: number; y: number }, depth?: number, point?: { x: number; y: number } } | undefined {
		// Early reject by AABB
		if (!this.detectAABBAreas(a.hitbox, b.hitbox)) return undefined;
		const as = this.getShape(a);
		const bs = this.getShape(b);
		// Circle-circle
		if (as.kind === 'circle' && bs.kind === 'circle') return this.contactCircleCircle(as.c, bs.c);
		// Circle-poly
		if (as.kind === 'circle' && bs.kind === 'poly') return this.contactCirclePoly(as.c, bs);
		if (as.kind === 'poly' && bs.kind === 'circle') {
			const c = this.contactCirclePoly(bs.c, as);
			if (c?.normal) c.normal = { x: -c.normal.x, y: -c.normal.y };
			return c;
		}
		// Poly-poly
		return this.contactPolyPoly(as, bs);
	}

	/** Any intersection between two polygon sets. */
	polygonsIntersect(polys1: Polygon[], polys2: Polygon[]): boolean {
		for (const p1 of polys1) for (const p2 of polys2) if (this.singlePolygonsIntersect(p1, p2)) return true;
		return false;
	}

	/** All intersection points between two polygon sets. */
	polygonsIntersectionPoints(polys1: Polygon[], polys2: Polygon[]): vec2arr[] | null {
		const out: vec2arr[] = [];
		for (const p1 of polys1) for (const p2 of polys2) out.push(...this.singlePolygonsIntersectionPoints(p1, p2));
		return out.length > 0 ? out : null;
	}

	/** Centroid of list of points. */
	getCentroidFromList(points: vec2arr[]): vec2arr {
		if (!points || points.length === 0) return [0, 0];
		let sx = 0, sy = 0;
		for (const [x, y] of points) { sx += x; sy += y; }
		return [sx / points.length, sy / points.length];
	}

	/** Poly AABB. */
	polygonAABB(poly: { x: number; y: number }[]): Area {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const p of poly) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
		return new_area(minX, minY, maxX, maxY);
	}

	// Internal helpers
	private singlePolygonsIntersect(poly1: Polygon, poly2: Polygon): boolean {
		function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
		function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
			return cx >= Math.min(ax, bx) && cx <= Math.max(ax, bx) && cy >= Math.min(ay, by) && cy <= Math.max(ay, by);
		}
		const n1 = poly1.length, n2 = poly2.length;
		for (let i = 0; i < n1; i += 2) {
			const ax = poly1[i], ay = poly1[i + 1];
			const ni = (i + 2 === n1) ? 0 : i + 2;
			const bx = poly1[ni], by = poly1[ni + 1];
			for (let j = 0; j < n2; j += 2) {
				const cx = poly2[j], cy = poly2[j + 1];
				const nj = (j + 2 === n2) ? 0 : j + 2;
				const dx = poly2[nj], dy = poly2[nj + 1];
				const o1 = orient(ax, ay, bx, by, cx, cy);
				const o2 = orient(ax, ay, bx, by, dx, dy);
				const o3 = orient(cx, cy, dx, dy, ax, ay);
				const o4 = orient(cx, cy, dx, dy, bx, by);
				if (o1 * o2 < 0 && o3 * o4 < 0) return true;
				if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
				if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
				if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
				if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
			}
		}
		function pointInPoly(px: number, py: number, poly: Polygon): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
				const xi = poly[i], yi = poly[i + 1];
				const xj = poly[j], yj = poly[j + 1];
				if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
			}
			return inside;
		}
		if (pointInPoly(poly1[0], poly1[1], poly2)) return true;
		if (pointInPoly(poly2[0], poly2[1], poly1)) return true;
		return false;
	}

	private singlePolygonsIntersectionPoints(poly1: Polygon, poly2: Polygon): vec2arr[] {
		function edgeIntersection(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): vec2arr | null {
			const a1 = by - ay, b1 = ax - bx, c1 = a1 * ax + b1 * ay;
			const a2 = dy - cy, b2 = cx - dx, c2 = a2 * cx + b2 * cy;
			const det = a1 * b2 - a2 * b1;
			if (Math.abs(det) < 1e-12) return null;
			const x = (b2 * c1 - b1 * c2) / det;
			const y = (a1 * c2 - a2 * c1) / det;
			if (
				Math.min(ax, bx) - 1e-8 <= x && x <= Math.max(ax, bx) + 1e-8 &&
				Math.min(ay, by) - 1e-8 <= y && y <= Math.max(ay, by) + 1e-8 &&
				Math.min(cx, dx) - 1e-8 <= x && x <= Math.max(cx, dx) + 1e-8 &&
				Math.min(cy, dy) - 1e-8 <= y && y <= Math.max(cy, dy) + 1e-8
			) return [x, y] as vec2arr;
			return null;
		}
		function pointInPoly(px: number, py: number, poly: Polygon): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
				const xi = poly[i], yi = poly[i + 1];
				const xj = poly[j], yj = poly[j + 1];
				if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
			}
			return inside;
		}
		const n1 = poly1.length, n2 = poly2.length;
		const out: vec2arr[] = [];
		for (let i = 0; i < n1; i += 2) {
			const ax = poly1[i], ay = poly1[i + 1];
			const ni = (i + 2 === n1) ? 0 : i + 2;
			const bx = poly1[ni], by = poly1[ni + 1];
			for (let j = 0; j < n2; j += 2) {
				const cx = poly2[j], cy = poly2[j + 1];
				const nj = (j + 2 === n2) ? 0 : j + 2;
				const dx = poly2[nj], dy = poly2[nj + 1];
				const pt = edgeIntersection(ax, ay, bx, by, cx, cy, dx, dy);
				if (pt) out.push(pt);
			}
		}
		for (let i = 0; i < n1; i += 2) if (pointInPoly(poly1[i], poly1[i + 1], poly2)) out.push([poly1[i], poly1[i + 1]]);
		for (let j = 0; j < n2; j += 2) if (pointInPoly(poly2[j], poly2[j + 1], poly1)) out.push([poly2[j], poly2[j + 1]]);
		return out;
	}
}

// Geometric helpers
function raySegmentIntersect(px: number, py: number, rx: number, ry: number, ax: number, ay: number, bx: number, by: number): number | null {
	// Solve p + t r = a + u (b-a)
	const sx = bx - ax, sy = by - ay;
	const det = (-rx * sy + ry * sx);
	if (Math.abs(det) < 1e-12) return null; // Parallel
	const inv = 1 / det;
	const dx = px - ax, dy = py - ay;
	const t = (-sy * dx + sx * dy) * inv;
	const u = (-ry * dx + rx * dy) * inv;
	if (u < -1e-8 || u > 1 + 1e-8) return null;
	return t;
}

function rayCircleIntersect(px: number, py: number, rx: number, ry: number, cx: number, cy: number, r: number): number | null {
	// Ray: P = p + t*r; solve |(p + t r) - c|^2 = r^2
	const dx = px - cx, dy = py - cy;
	const a = rx * rx + ry * ry;
	const b = 2 * (rx * dx + ry * dy);
	const c = dx * dx + dy * dy - r * r;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return null;
	const s = Math.sqrt(disc);
	const t1 = (-b - s) / (2 * a);
	const t2 = (-b + s) / (2 * a);
	const t = Math.min(t1, t2);
	return t >= 0 ? t : (Math.max(t1, t2) >= 0 ? Math.max(t1, t2) : null);
}

export const Collision2DSystem = new Collision2DService();

/** Simple uniform grid broad-phase. */
class Collision2DBroadphaseIndex {
	private cellSize: number;
	// key -> set of objects
	private cells = new Map<string, Set<WorldObject>>();
	// object -> keys it occupies
	private objKeys = new WeakMap<WorldObject, string[]>();

	constructor(cellSize = 64) { this.cellSize = cellSize; }

	clear(): void { this.cells.clear(); this.objKeys = new WeakMap(); }

	private key(cx: number, cy: number): string { return cx + ',' + cy; }
	private cellCoordsForArea(a: Area): { cx0: number; cy0: number; cx1: number; cy1: number } {
		const cs = this.cellSize;
		const cx0 = Math.floor(a.start.x / cs), cy0 = Math.floor(a.start.y / cs);
		const cx1 = Math.floor(a.end.x / cs), cy1 = Math.floor(a.end.y / cs);
		return { cx0, cy0, cx1, cy1 };
	}

	addOrUpdate(o: WorldObject): void {
		// Remove from previous keys
		const prev = this.objKeys.get(o);
		if (prev) {
			for (const k of prev) {
				const s = this.cells.get(k);
				if (s) { s.delete(o); if (s.size === 0) this.cells.delete(k); }
			}
		}
		// Insert at new keys
		const hb = o.hitbox;
		const { cx0, cy0, cx1, cy1 } = this.cellCoordsForArea(hb);
		const keys: string[] = [];
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const k = this.key(cx, cy);
				let s = this.cells.get(k);
				if (!s) { s = new Set(); this.cells.set(k, s); }
				s.add(o); keys.push(k);
			}
		}
		this.objKeys.set(o, keys);
	}

	remove(o: WorldObject): void {
		const prev = this.objKeys.get(o); if (!prev) return;
		for (const k of prev) {
			const s = this.cells.get(k); if (s) { s.delete(o); if (s.size === 0) this.cells.delete(k); }
		}
		this.objKeys.delete(o);
	}

	queryAABB(a: Area): WorldObject[] {
		const { cx0, cy0, cx1, cy1 } = this.cellCoordsForArea(a);
		const out: WorldObject[] = [];
		const seen = new Set<WorldObject>();
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const s = this.cells.get(this.key(cx, cy));
				if (!s) continue;
				for (const o of s) {
					if (!seen.has(o) && Collision2DSystem.detectAABBAreas(o.hitbox, a)) { seen.add(o); out.push(o); }
				}
			}
		}
		return out;
	}

	/** Raycast using an AABB cover for candidates, returns sorted hits by t along the ray (0..maxDist). */
	raycast(origin: vec2arr, dir: vec2arr, maxDist: number): { obj: WorldObject; t: number }[] {
		const end: vec2arr = [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist];
		const minx = Math.min(origin[0], end[0]);
		const miny = Math.min(origin[1], end[1]);
		const maxx = Math.max(origin[0], end[0]);
		const maxy = Math.max(origin[1], end[1]);
		const cover = new_area(minx, miny, maxx, maxy);
		const candidates = this.queryAABB(cover);
		const hits: { obj: WorldObject; t: number }[] = [];
		for (const o of candidates) {
			const t = this.rayAABB(origin, dir, o.hitbox);
			if (t !== null && t >= 0 && t <= maxDist) hits.push({ obj: o, t });
		}
		hits.sort((a, b) => a.t - b.t);
		return hits;
	}

	/** Sweeps a moving AABB by delta and returns possible overlaps based on expanded cover. */
	sweepAABB(a: Area, delta: vec2arr): WorldObject[] {
		const dx = delta[0], dy = delta[1];
		const minx = Math.min(a.start.x, a.start.x + dx);
		const miny = Math.min(a.start.y, a.start.y + dy);
		const maxx = Math.max(a.end.x, a.end.x + dx);
		const maxy = Math.max(a.end.y, a.end.y + dy);
		const cover = new_area(minx, miny, maxx, maxy);
		return this.queryAABB(cover);
	}

	// Slab ray/AABB intersection; returns t or null when no hit.
	private rayAABB(origin: vec2arr, dir: vec2arr, a: Area): number | null {
		const invx = dir[0] !== 0 ? 1 / dir[0] : Number.POSITIVE_INFINITY;
		const invy = dir[1] !== 0 ? 1 / dir[1] : Number.POSITIVE_INFINITY;
		let tmin = (a.start.x - origin[0]) * invx;
		let tmax = (a.end.x - origin[0]) * invx;
		if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
		let tymin = (a.start.y - origin[1]) * invy;
		let tymax = (a.end.y - origin[1]) * invy;
		if (tymin > tymax) [tymin, tymax] = [tymax, tymin];
		if ((tmin > tymax) || (tymin > tmax)) return null;
		tmin = Math.max(tmin, tymin);
		tmax = Math.min(tmax, tymax);
		return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
	}
}
