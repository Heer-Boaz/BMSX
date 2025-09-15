import type { Area, Polygon, vec2arr } from 'bmsx/rompack/rompack';
import type { WorldObject } from 'bmsx/core/object/worldobject';
import type { World } from 'bmsx/core/world';
import { new_area } from 'bmsx/utils/utils';
import { Service } from 'bmsx/core/service';

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
      const selfPolys = self.hasHitPolygon ? (self.hitpolygon as Polygon[]) : [this.areaToPoly(self.hitbox)];
      const otherPolys = o.hasHitPolygon ? (o.hitpolygon as Polygon[]) : [this.areaToPoly(o.hitbox)];
      return this.polygonsIntersect(selfPolys, otherPolys);
    } else {
      const a = other as Area;
      if (!this.detectAABBAreas(self.hitbox, a)) return false;
      const selfPolys = self.hasHitPolygon ? (self.hitpolygon as Polygon[]) : [this.areaToPoly(self.hitbox)];
      return this.polygonsIntersect(selfPolys, [this.areaToPoly(a)]);
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
