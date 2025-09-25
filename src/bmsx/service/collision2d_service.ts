import type { Area, Polygon, vec2arr } from '../rompack/rompack';
import type { WorldObject } from '../core/object/worldobject';
import type { World } from '../core/world';
import { new_area } from '../utils/utils';
import { Service } from '../core/service';
import { Collider2DComponent } from '../component/collisioncomponents';

type Shape2D = { kind: 'poly', polys: Polygon[] } | { kind: 'circle', c: { x: number; y: number; r: number } };

type ColliderTarget = WorldObject | Collider2DComponent;
type ColliderHandle = { owner: WorldObject; collider: Collider2DComponent };
type RaycastHit2D = { collider: Collider2DComponent; colliderId: string; obj: WorldObject; distance: number; point: vec2arr };
type SweepHit2D = { collider: Collider2DComponent; colliderId: string; obj: WorldObject; distance: number; point: vec2arr };

const EPS = 1e-8;
const EPS_PARALLEL = 1e-12;

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
		for (const o of world.objects({ scope: 'active' })) {
			for (const col of o.getComponents(Collider2DComponent)) {
				if (!col.enabled) continue;
				idx.addOrUpdate(col);
			}
		}
	}

	queryAABB(world: World, area: Area): Collider2DComponent[] {
		return this.ensureIndex(world).queryAABB(area);
	}

	raycastWorld(world: World, origin: vec2arr, dir: vec2arr, maxDist: number): RaycastHit2D[] {
		const mag = Math.hypot(dir[0], dir[1]);
		if (mag <= EPS) return [];
		const ndir: vec2arr = [dir[0] / mag, dir[1] / mag];
		const hits = this.ensureIndex(world).raycast(origin, dir, maxDist);
		return hits.map(hit => {
			const distance = hit.t;
			return {
				collider: hit.collider,
				colliderId: hit.collider.id,
				obj: hit.obj,
				distance,
				point: [origin[0] + ndir[0] * distance, origin[1] + ndir[1] * distance] as vec2arr,
			};
		});
	}

	sweepAABB(world: World, area: Area, delta: vec2arr): Collider2DComponent[] {
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

	private isArea(v: unknown): v is Area { return !!v && typeof v === 'object' && 'start' in (v as Record<string, unknown>) && 'end' in (v as Record<string, unknown>); }

	private resolveCollider(target: ColliderTarget): ColliderHandle | null {
		if (target instanceof Collider2DComponent) {
			const owner = target.parent;
			if (!owner) return null;
			return { owner, collider: target };
		}
		const col = target.getFirstComponent(Collider2DComponent);
		if (!col) return null;
		return { owner: target, collider: col };
	}

	/** Collider vs Collider/Area collision. Polygons if present; fallback to AABB. */
	collides(self: ColliderTarget, other: ColliderTarget | Area): boolean {
		const aHandle = this.resolveCollider(self);
		if (!aHandle) return false;
		const { collider: a } = aHandle;
		if (!a.hittable) return false;
		if (!a.enabled) return false;
		if (this.isArea(other)) {
			if (!this.detectAABBAreas(a.worldArea, other)) return false;
			const aShape = this.getShape(a);
			const bShape: Shape2D = { kind: 'poly', polys: [this.areaToPoly(other)] };
			return this.shapeIntersects(aShape, bShape);
		}
		const bHandle = this.resolveCollider(other);
		if (!bHandle) return false;
		const { collider: b } = bHandle;
		if (!b.hittable || !b.enabled) return false;
		if (!this.detectAABBAreas(a.worldArea, b.worldArea)) return false;
		const aShape = this.getShape(a);
		const bShape = this.getShape(b);
		return this.shapeIntersects(aShape, bShape);
	}

	/** Returns centroid of polygon intersection if any; null otherwise. */
	getCollisionCentroid(a: ColliderTarget, b: ColliderTarget): vec2arr | null {
		const ah = this.resolveCollider(a);
		const bh = this.resolveCollider(b);
		if (!ah || !bh) return null;
		const { collider: ac } = ah;
		const { collider: bc } = bh;
		if (!ac.hittable || !bc.hittable) return null;
		if (!this.detectAABBAreas(ac.worldArea, bc.worldArea)) return null;
		const p1 = (ac.worldPolygons ?? [this.areaToPoly(ac.worldArea)]) as Polygon[];
		const p2 = (bc.worldPolygons ?? [this.areaToPoly(bc.worldArea)]) as Polygon[];
		const points = this.polygonsIntersectionPoints(p1, p2);
		if (!points || points.length === 0) return null;
		return this.getCentroidFromList(points);
	}

	// ---- Shapes and contact helpers ----
	private getShape(col: Collider2DComponent): Shape2D {
		const wc = col.worldCircle;
		if (wc) return { kind: 'circle', c: wc };
		const polys = col.worldPolygons;
		if (polys && polys.length > 0) return { kind: 'poly', polys };
		return { kind: 'poly', polys: [this.areaToPoly(col.worldArea)] };
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
		const depth = rr - dist; const nx = dist > EPS ? dx / dist : 1, ny = dist > EPS ? dy / dist : 0; const point = { x: b.x + nx * (b.r), y: b.y + ny * (b.r) };
		return { normal: { x: nx, y: ny }, depth, point };
	}

	private contactCirclePoly(c: { x: number; y: number; r: number }, poly: { polys: Polygon[] }) {
		let bestAxis: { x: number; y: number } | null = null;
		let bestOverlap = Infinity;
		const testAxis = (p: Polygon, ax: number, ay: number) => {
			let pmin = Infinity, pmax = -Infinity;
			for (let i = 0; i < p.length; i += 2) {
				const proj = p[i] * ax + p[i + 1] * ay;
				if (proj < pmin) pmin = proj;
				if (proj > pmax) pmax = proj;
			}
			const cproj = c.x * ax + c.y * ay;
			const cmin = cproj - c.r;
			const cmax = cproj + c.r;
			const sep = Math.max(pmin - cmax, cmin - pmax);
			if (sep > 0) return false;
			const overlap = -sep;
			if (overlap < bestOverlap) {
				bestOverlap = overlap;
				bestAxis = { x: ax, y: ay };
			}
			return true;
		};
		for (const p of poly.polys) {
			const n = p.length;
			for (let i = 0; i < n; i += 2) {
				const j = (i + 2 === n) ? 0 : i + 2;
				const nx = -(p[j + 1] - p[i + 1]);
				const ny = p[j] - p[i];
				const edgeLen = Math.hypot(nx, ny);
				if (edgeLen <= EPS) continue;
				if (!testAxis(p, nx / edgeLen, ny / edgeLen)) return undefined;
			}
			let vx = p[0], vy = p[1];
			let bd = (vx - c.x) ** 2 + (vy - c.y) ** 2;
			for (let k = 2; k < n; k += 2) {
				const dx = p[k] - c.x;
				const dy = p[k + 1] - c.y;
				const d = dx * dx + dy * dy;
				if (d < bd) { bd = d; vx = p[k]; vy = p[k + 1]; }
			}
			const ax = vx - c.x;
			const ay = vy - c.y;
			const axisLen = Math.hypot(ax, ay);
			if (axisLen > EPS && !testAxis(p, ax / axisLen, ay / axisLen)) return undefined;
		}
		if (!bestAxis) return undefined;
		return { normal: bestAxis, depth: bestOverlap };
	}

	private contactPolyPoly(a: Shape2D, b: Shape2D) {
		if (a.kind !== 'poly' || b.kind !== 'poly') return undefined;
		const contactPair = (pa: Polygon, pb: Polygon) => {
			let bestAxis: { x: number; y: number } | null = null;
			let bestOverlap = Infinity;
			const testAxesFrom = (p: Polygon) => {
				const n = p.length;
				for (let i = 0; i < n; i += 2) {
					const j = (i + 2 === n) ? 0 : i + 2;
					const nx = -(p[j + 1] - p[i + 1]);
					const ny = p[j] - p[i];
					const edgeLen = Math.hypot(nx, ny);
					if (edgeLen <= EPS) continue;
					const ax = nx / edgeLen;
					const ay = ny / edgeLen;
					let minA = Infinity, maxA = -Infinity;
					for (let k = 0; k < pa.length; k += 2) {
						const proj = pa[k] * ax + pa[k + 1] * ay;
						if (proj < minA) minA = proj;
						if (proj > maxA) maxA = proj;
					}
					let minB = Infinity, maxB = -Infinity;
					for (let k = 0; k < pb.length; k += 2) {
						const proj = pb[k] * ax + pb[k + 1] * ay;
						if (proj < minB) minB = proj;
						if (proj > maxB) maxB = proj;
					}
					const sep = Math.max(minA - maxB, minB - maxA);
					if (sep > 0) return false;
					const overlap = -sep;
					if (overlap < bestOverlap) {
						bestOverlap = overlap;
						bestAxis = { x: ax, y: ay };
					}
				}
				return true;
			};
			if (!testAxesFrom(pa)) return undefined;
			if (!testAxesFrom(pb)) return undefined;
			return bestAxis ? { normal: bestAxis, depth: bestOverlap } : undefined;
		};
		let best: { normal: { x: number; y: number }; depth: number } | undefined;
		for (const pa of a.polys) {
			for (const pb of b.polys) {
				const c = contactPair(pa, pb);
				if (c && (!best || c.depth < best.depth)) best = c;
			}
		}
		return best;
	}

	// Casts
	segmentCastWorld(world: World, p0: vec2arr, p1: vec2arr): SweepHit2D[] {
		const minx = Math.min(p0[0], p1[0]), miny = Math.min(p0[1], p1[1]); const maxx = Math.max(p0[0], p1[0]), maxy = Math.max(p0[1], p1[1]);
		const cover = new_area(minx, miny, maxx, maxy);
		const cand = this.queryAABB(world, cover);
		const hits: SweepHit2D[] = [];
		const rx = p1[0] - p0[0], ry = p1[1] - p0[1];
		const len = Math.hypot(rx, ry);
		if (len <= EPS) return [];
		const ndir: vec2arr = [rx / len, ry / len];
		for (const col of cand) {
			const owner = col.parent;
			if (!owner) continue;
			const s = this.getShape(col);
			let bestT = Infinity;
			if (s.kind === 'poly') {
				for (const poly of s.polys) {
					const n = poly.length;
					for (let i = 0; i < n; i += 2) {
						const j = (i + 2 === n) ? 0 : i + 2;
						const ax = poly[i], ay = poly[i + 1];
						const bx = poly[j], by = poly[j + 1];
						const t = raySegmentIntersect(p0[0], p0[1], rx, ry, ax, ay, bx, by);
						if (t !== null && t >= 0 && t <= 1 && t < bestT) bestT = t;
					}
				}
			} else if (s.kind === 'circle') {
				const t = rayCircleIntersect(p0[0], p0[1], rx, ry, s.c.x, s.c.y, s.c.r);
				if (t !== null && t >= 0 && t <= 1 && t < bestT) bestT = t;
			}
			if (bestT !== Infinity) {
				const distance = bestT * len;
				hits.push({
					collider: col,
					colliderId: col.id,
					obj: owner,
					distance,
					point: [p0[0] + ndir[0] * distance, p0[1] + ndir[1] * distance] as vec2arr,
				});
			}
		}
		hits.sort((a, b) => a.distance - b.distance); return hits;
	}

	circleCastWorld(world: World, origin: vec2arr, radius: number, dir: vec2arr, maxDist: number): SweepHit2D[] {
		const end: vec2arr = [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist];
		const minx = Math.min(origin[0], end[0]) - radius, miny = Math.min(origin[1], end[1]) - radius; const maxx = Math.max(origin[0], end[0]) + radius, maxy = Math.max(origin[1], end[1]) + radius;
		const cover = new_area(minx, miny, maxx, maxy);
		const cand = this.queryAABB(world, cover);
		const hits: SweepHit2D[] = [];
		const rx = end[0] - origin[0], ry = end[1] - origin[1];
		const segLen = Math.hypot(rx, ry);
		if (segLen <= EPS) return [];
		const ndir: vec2arr = [rx / segLen, ry / segLen];
		for (const col of cand) {
			const owner = col.parent;
			if (!owner) continue;
			const s = this.getShape(col);
			let bestT = Infinity;
			if (s.kind === 'poly') {
				for (const poly of s.polys) {
					const n = poly.length;
					for (let i = 0; i < n; i += 2) {
						const j = (i + 2 === n) ? 0 : i + 2;
						const ex = poly[j] - poly[i];
						const ey = poly[j + 1] - poly[i + 1];
						const edgeLen = Math.hypot(ex, ey);
						if (edgeLen <= EPS) continue;
						const nx = -(ey / edgeLen);
						const ny = ex / edgeLen;
						const ax = poly[i] + nx * radius, ay = poly[i + 1] + ny * radius;
						const bx = poly[j] + nx * radius, by = poly[j + 1] + ny * radius;
						const t = raySegmentIntersect(origin[0], origin[1], rx, ry, ax, ay, bx, by);
						if (t !== null && t >= 0 && t <= 1 && t < bestT) bestT = t;
					}
					for (let k = 0; k < n; k += 2) {
						const t = rayCircleIntersect(origin[0], origin[1], rx, ry, poly[k], poly[k + 1], radius);
						if (t !== null && t >= 0 && t <= 1 && t < bestT) bestT = t;
					}
				}
			} else {
				const t = rayCircleIntersect(origin[0], origin[1], rx, ry, s.c.x, s.c.y, s.c.r + radius);
				if (t !== null && t >= 0 && t <= 1 && t < bestT) bestT = t;
			}
			if (bestT !== Infinity) {
				const distance = bestT * segLen;
				hits.push({
					collider: col,
					colliderId: col.id,
					obj: owner,
					distance,
					point: [origin[0] + ndir[0] * distance, origin[1] + ndir[1] * distance] as vec2arr,
				});
			}
		}
		hits.sort((a, b) => a.distance - b.distance); return hits;
	}
	/** Compute contact info (normal, depth, point) using SAT/GJK approximations where possible. */
	getContact2D(a: ColliderTarget, b: ColliderTarget): { normal?: { x: number; y: number }, depth?: number, point?: { x: number; y: number } } | undefined {
		const ah = this.resolveCollider(a);
		const bh = this.resolveCollider(b);
		if (!ah || !bh) return undefined;
		const { collider: ac } = ah;
		const { collider: bc } = bh;
		// Early reject by AABB
		if (!this.detectAABBAreas(ac.worldArea, bc.worldArea)) return undefined;
		const as = this.getShape(ac);
		const bs = this.getShape(bc);
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
				if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || EPS_PARALLEL) + xi)) inside = !inside;
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
			if (Math.abs(det) < EPS_PARALLEL) return null;
			const x = (b2 * c1 - b1 * c2) / det;
			const y = (a1 * c2 - a2 * c1) / det;
			if (
				Math.min(ax, bx) - EPS <= x && x <= Math.max(ax, bx) + EPS &&
				Math.min(ay, by) - EPS <= y && y <= Math.max(ay, by) + EPS &&
				Math.min(cx, dx) - EPS <= x && x <= Math.max(cx, dx) + EPS &&
				Math.min(cy, dy) - EPS <= y && y <= Math.max(cy, dy) + EPS
			) return [x, y] as vec2arr;
			return null;
		}
		function pointInPoly(px: number, py: number, poly: Polygon): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
				const xi = poly[i], yi = poly[i + 1];
				const xj = poly[j], yj = poly[j + 1];
				if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || EPS_PARALLEL) + xi)) inside = !inside;
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
	if (Math.abs(det) < EPS_PARALLEL) return null; // Parallel
	const inv = 1 / det;
	const dx = px - ax, dy = py - ay;
	const t = (-sy * dx + sx * dy) * inv;
	const u = (-ry * dx + rx * dy) * inv;
	if (u < -EPS || u > 1 + EPS) return null;
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

/** Simple uniform grid broad-phase keyed by Collider2DComponent. */
class Collision2DBroadphaseIndex {
	private cellSize: number;
	private cells = new Map<string, Set<Collider2DComponent>>();
	private colliderKeys = new WeakMap<Collider2DComponent, string[]>();

	constructor(cellSize = 64) { this.cellSize = cellSize; }

	clear(): void { this.cells.clear(); this.colliderKeys = new WeakMap(); }

	private key(cx: number, cy: number): string { return cx + ',' + cy; }
	private cellCoordsForArea(a: Area): { cx0: number; cy0: number; cx1: number; cy1: number } {
		const cs = this.cellSize;
		const cx0 = Math.floor(a.start.x / cs), cy0 = Math.floor(a.start.y / cs);
		const cx1 = Math.floor(a.end.x / cs), cy1 = Math.floor(a.end.y / cs);
		return { cx0, cy0, cx1, cy1 };
	}

	addOrUpdate(col: Collider2DComponent): void {
		const prev = this.colliderKeys.get(col);
		if (prev) {
			for (const k of prev) {
				const s = this.cells.get(k);
				if (s) { s.delete(col); if (s.size === 0) this.cells.delete(k); }
			}
		}
		const area = col.worldArea;
		const { cx0, cy0, cx1, cy1 } = this.cellCoordsForArea(area);
		const keys: string[] = [];
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const k = this.key(cx, cy);
				let s = this.cells.get(k);
				if (!s) { s = new Set(); this.cells.set(k, s); }
				s.add(col); keys.push(k);
			}
		}
		this.colliderKeys.set(col, keys);
	}

	remove(col: Collider2DComponent): void {
		const prev = this.colliderKeys.get(col); if (!prev) return;
		for (const k of prev) {
			const s = this.cells.get(k);
			if (s) { s.delete(col); if (s.size === 0) this.cells.delete(k); }
		}
		this.colliderKeys.delete(col);
	}

	queryAABB(a: Area): Collider2DComponent[] {
		const { cx0, cy0, cx1, cy1 } = this.cellCoordsForArea(a);
		const out: Collider2DComponent[] = [];
		const seen = new Set<Collider2DComponent>();
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const s = this.cells.get(this.key(cx, cy));
				if (!s) continue;
				for (const col of s) {
					if (!seen.has(col) && Collision2DSystem.detectAABBAreas(col.worldArea, a)) { seen.add(col); out.push(col); }
				}
			}
		}
		return out;
	}

	/** Raycast using an AABB cover for candidates, returns sorted hits by t along the ray (0..maxDist). */
	raycast(origin: vec2arr, dir: vec2arr, maxDist: number): { collider: Collider2DComponent; obj: WorldObject; t: number }[] {
		const mag = Math.hypot(dir[0], dir[1]);
		if (mag <= EPS) return [];
		const ndir: vec2arr = [dir[0] / mag, dir[1] / mag];
		const end: vec2arr = [origin[0] + ndir[0] * maxDist, origin[1] + ndir[1] * maxDist];
		const minx = Math.min(origin[0], end[0]);
		const miny = Math.min(origin[1], end[1]);
		const maxx = Math.max(origin[0], end[0]);
		const maxy = Math.max(origin[1], end[1]);
		const cover = new_area(minx, miny, maxx, maxy);
		const candidates = this.queryAABB(cover);
		const hits: { collider: Collider2DComponent; obj: WorldObject; t: number }[] = [];
		for (const col of candidates) {
			const owner = col.parent;
			if (!owner) continue;
			const t = this.rayAABB(origin, ndir, col.worldArea);
			if (t !== null && t >= 0 && t <= maxDist) hits.push({ collider: col, obj: owner, t });
		}
		hits.sort((a, b) => a.t - b.t);
		return hits;
	}

	/** Sweeps a moving AABB by delta and returns possible overlaps based on expanded cover. */
	sweepAABB(a: Area, delta: vec2arr): Collider2DComponent[] {
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
		const hit = tmin >= 0 ? tmin : tmax;
		return hit >= 0 ? hit : null;
	}
}
