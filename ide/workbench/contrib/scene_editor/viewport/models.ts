import { appendAffine3, type Affine3 } from '../../../../../machine/ts/common/affine3';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { HostMeshScene, hostMeshReflected, type HostMeshInstance } from '../../../../../machine/ts/render/host_overlay/mesh';
import { WorkspaceModelAssets, type WorkspaceModelPart } from '../../../../workspace/model_assets';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { SceneSourceObject } from '../model';
import type { SceneVisualReadModel } from '../visual_projection';
import type { SceneViewportCamera, SceneViewportPoint } from './camera';

type Placement = { readonly part: WorkspaceModelPart; readonly affine: Affine3; readonly streams: Map<Float32Array, Float64Array> };
type Draw = HostMeshInstance & { entry: SceneSourceObject; vertices: Float64Array; reflected: boolean;
	minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
export type SceneViewportModelBounds = { originX: number; originY: number; originZ: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type Hit = SceneViewportPoint & { entry: SceneSourceObject | undefined };

/** Retained asset placements, raster submission and triangle picking share the same occurrences and geometry. */
export class SceneViewportModels {
	public readonly scene = new HostMeshScene(1, 1);
	public readonly represented = new Set<SceneSourceObject>();
	private readonly assets: WorkspaceModelAssets;
	private readonly modelIds = new Set<string>();
	private readonly placements: Placement[] = [];
	private readonly draws: Draw[] = [];
	private readonly affine: Affine3 = { xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };
	private readonly rayOrigin = new Float64Array(3);
	private readonly rayDirection = new Float64Array(3);
	private readonly hit: Hit = { entry: undefined, originX: 0, originY: 0, originZ: 0, x: 0, y: 0, z: 0 };
	private source: SceneVisualReadModel | undefined;
	private catalogRevision = -1;
	private cameraRevision = -1;
	private projectedRevision = -1;
	public constructor(private readonly catalog: WorkspaceSourceCatalog, private readonly contextId: string) { this.assets = new WorkspaceModelAssets(catalog); }
	public prepare(source: SceneVisualReadModel | undefined): void {
		if (source === this.source && this.catalogRevision === this.catalog.revision) return;
		this.source = source; this.catalogRevision = this.catalog.revision;
		this.modelIds.clear(); this.represented.clear();
		if (source !== undefined) for (const model of source.models) this.modelIds.add(model.model);
		this.assets.update(this.contextId, this.modelIds);
		let placementCount = 0, drawCount = 0, changed = false;
		if (source !== undefined) for (const model of source.models) {
			const asset = this.assets.get(model.model, model.sceneIndex); if (asset === undefined) continue;
			for (const part of asset.parts) {
				Object.assign(this.affine, model.affine); appendAffine3(this.affine, part.affine);
				const affine = this.affine;
				let placement = this.placements[placementCount++], moved = false, linearChanged = false;
				if (placement === undefined || placement.part !== part) {
					placement = { part, affine: { ...affine }, streams: new Map() }; this.placements[placementCount - 1] = placement; moved = linearChanged = true;
				} else {
					const previous = placement.affine;
					linearChanged = previous.xx !== affine.xx || previous.xy !== affine.xy || previous.xz !== affine.xz
						|| previous.yx !== affine.yx || previous.yy !== affine.yy || previous.yz !== affine.yz
						|| previous.zx !== affine.zx || previous.zy !== affine.zy || previous.zz !== affine.zz;
					moved = linearChanged || previous.ox !== affine.ox || previous.oy !== affine.oy || previous.oz !== affine.oz;
					if (moved) Object.assign(previous, affine);
				}
				// Keep translation separate: large world origins must not erase small drawable vertex offsets.
				// A glTF position accessor may be shared by material primitives. Transform each lane once per placement change.
				if (linearChanged) for (const [positions, vertices] of placement.streams) this.transform(positions, vertices, affine);
				for (const mesh of part.meshes) {
					if (mesh.drawCount === 0) continue;
					let vertices = placement.streams.get(mesh.positions);
					if (vertices === undefined) {
						vertices = new Float64Array(mesh.positions.length); placement.streams.set(mesh.positions, vertices);
						this.transform(mesh.positions, vertices, affine);
					}
					let draw = this.draws[drawCount];
					const replaced = draw === undefined || draw.mesh !== mesh || draw.vertices !== vertices;
					if (replaced) {
						draw = { ...affine, mesh, entry: model.entry, vertices, reflected: false,
							minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
						this.draws[drawCount] = draw; this.scene.instances[drawCount] = draw;
					}
					draw.entry = model.entry;
					if (replaced || moved) { Object.assign(draw, affine); draw.reflected = hostMeshReflected(draw); changed = true; }
					if (replaced || linearChanged) { this.measure(draw); }
					drawCount++; this.represented.add(model.entry);
				}
			}
		}
		if (drawCount !== this.draws.length) changed = true;
		this.placements.length = placementCount; this.draws.length = this.scene.instances.length = drawCount;
		if (changed) this.scene.changed();
	}
	private transform(positions: Float32Array, vertices: Float64Array, a: Readonly<Affine3>): void {
		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i], y = positions[i + 1], z = positions[i + 2];
			vertices[i] = a.xx * x + a.yx * y + a.zx * z;
			vertices[i + 1] = a.xy * x + a.yy * y + a.zy * z;
			vertices[i + 2] = a.xz * x + a.yz * y + a.zz * z;
		}
	}
	private measure(draw: Draw): void {
		let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		const vertices = draw.vertices, indices = draw.mesh.indices, count = draw.mesh.drawCount;
		for (let i = 0; i < count; i++) {
			const offset = (indices === undefined ? i : indices[i]) * 3, x = vertices[offset], y = vertices[offset + 1], z = vertices[offset + 2];
			minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
			maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
		}
		draw.minX = minX; draw.minY = minY; draw.minZ = minZ; draw.maxX = maxX; draw.maxY = maxY; draw.maxZ = maxZ;
	}
	public project(camera: SceneViewportCamera, bounds: Readonly<RectBounds>): boolean {
		if (camera.mode !== '3d' || bounds.left >= bounds.right || bounds.top >= bounds.bottom) return false;
		this.scene.resize(bounds.right - bounds.left, bounds.bottom - bounds.top);
		if (camera.spaceRevision !== this.cameraRevision) {
			this.cameraRevision = camera.spaceRevision; this.scene.clipFromOrigin.set(camera.clipFromOrigin);
			this.scene.originX = camera.originX; this.scene.originY = camera.originY; this.scene.originZ = camera.originZ; this.scene.changed();
		}
		if (this.projectedRevision === this.scene.revision) return false;
		this.projectedRevision = this.scene.revision; return true;
	}
	public frameBounds(selected: ReadonlySet<SceneSourceObject> | undefined, target: SceneViewportModelBounds): boolean {
		let count = 0;
		target.originX = target.originY = target.originZ = 0;
		target.minX = target.minY = target.minZ = Infinity; target.maxX = target.maxY = target.maxZ = -Infinity;
		for (const draw of this.draws) {
			if (selected !== undefined && !selected.has(draw.entry)) continue;
			if (count === 0) { target.originX = draw.ox; target.originY = draw.oy; target.originZ = draw.oz; }
			const x = draw.ox - target.originX, y = draw.oy - target.originY, z = draw.oz - target.originZ;
			target.minX = Math.min(target.minX, x + draw.minX); target.minY = Math.min(target.minY, y + draw.minY); target.minZ = Math.min(target.minZ, z + draw.minZ);
			target.maxX = Math.max(target.maxX, x + draw.maxX); target.maxY = Math.max(target.maxY, y + draw.maxY); target.maxZ = Math.max(target.maxZ, z + draw.maxZ); count++;
		}
		return count !== 0;
	}
	/** World-space triangles keep flattened but drawable affines pickable; no inverse-transform substitute. */
	public pick(x: number, y: number, camera: SceneViewportCamera): Readonly<Hit> | undefined {
		camera.rayDirection3D(x, y, this.rayDirection);
		const o = this.rayOrigin, d = this.rayDirection, hit = this.hit; hit.entry = undefined; let nearestDepth = 0;
		for (const draw of this.draws) {
			camera.eyeRelativeTo(draw.ox, draw.oy, draw.oz, o);
			let near = 0, far = Infinity;
			for (let axis = 0; axis < 3; axis++) {
				const min = axis === 0 ? draw.minX : axis === 1 ? draw.minY : draw.minZ;
				const max = axis === 0 ? draw.maxX : axis === 1 ? draw.maxY : draw.maxZ;
				if (d[axis] === 0) { if (o[axis] < min || o[axis] > max) { far = -Infinity; break; } }
				else {
					const first = (min - o[axis]) / d[axis], second = (max - o[axis]) / d[axis];
					near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second));
				}
			}
			if (far < near) continue;
			const vertices = draw.vertices, indices = draw.mesh.indices, count = draw.mesh.drawCount;
			for (let i = 0; i < count; i += 3) {
				const a = (indices === undefined ? i : indices[i]) * 3, b = (indices === undefined ? i + 1 : indices[i + 1]) * 3, c = (indices === undefined ? i + 2 : indices[i + 2]) * 3;
				const e1x = vertices[b] - vertices[a], e1y = vertices[b + 1] - vertices[a + 1], e1z = vertices[b + 2] - vertices[a + 2];
				const e2x = vertices[c] - vertices[a], e2y = vertices[c + 1] - vertices[a + 1], e2z = vertices[c + 2] - vertices[a + 2];
				const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
				const det = e1x * px + e1y * py + e1z * pz;
				if (det === 0 || (!draw.mesh.doubleSided && (draw.reflected ? det >= 0 : det <= 0))) continue;
				const tx = o[0] - vertices[a], ty = o[1] - vertices[a + 1], tz = o[2] - vertices[a + 2], reciprocal = 1 / det;
				const u = (tx * px + ty * py + tz * pz) * reciprocal; if (!(u >= 0 && u <= 1)) continue;
				const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
				const v = (d[0] * qx + d[1] * qy + d[2] * qz) * reciprocal; if (!(v >= 0 && u + v <= 1)) continue;
				const distance = (e2x * qx + e2y * qy + e2z * qz) * reciprocal; if (!(distance >= 0)) continue;
				const hx = o[0] + d[0] * distance, hy = o[1] + d[1] * distance, hz = o[2] + d[2] * distance;
				const depth = camera.depth(hx, hy, hz, draw.ox, draw.oy, draw.oz);
				if (depth < camera.near) continue;
				const rasterDepth = Math.fround(camera.near / depth); if (!(rasterDepth > nearestDepth)) continue;
				nearestDepth = rasterDepth;
				hit.originX = draw.ox; hit.originY = draw.oy; hit.originZ = draw.oz;
				hit.entry = draw.entry; hit.x = hx; hit.y = hy; hit.z = hz;
			}
		}
		return hit.entry === undefined ? undefined : hit;
	}
	public dispose(): void {
		this.scene.dispose(); this.assets.dispose(); this.draws.length = this.placements.length = 0;
		this.represented.clear(); this.modelIds.clear(); this.source = undefined;
	}
}
