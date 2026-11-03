import { appendAffine3, type Affine3 } from '../../../../../machine/ts/common/affine3';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { HostMesh, HostMeshScene, hostMeshReflected, type HostMeshInstance } from '../../../../../machine/ts/render/host_overlay/mesh';
import { clamp } from '../../../../../machine/ts/common/clamp';
import type { ModelRenderPart, ModelRenderResources } from '../../../../common/model_resources';
import type { SceneSourceObject } from '../model';
import type { SceneTransformPreview } from '../transform_proposal';

import type { SceneViewportCamera, SceneViewportPoint } from './camera';
import type { ViewportCanvasQuad } from './canvas_geometry';

export type ViewportModel<Owner, Model = string> = {
	readonly entry: Owner; readonly model: Model; readonly sceneIndex?: number;
	readonly world: Readonly<Affine3>; readonly attachment: Readonly<Affine3>; readonly presentation: Readonly<Affine3>;
};
type ModelFrame<Owner, Model> = { readonly models: readonly ViewportModel<Owner, Model>[] };
type ModelAssets<Model> = { readonly revision: number; get(id: Model): ModelRenderResources | undefined };
type CanvasFrame<Owner> = { readonly items: readonly ViewportCanvasQuad<Owner>[]; readonly revision: number; readonly packetRevision: number };

type Placement<Owner, Model> = { source: ViewportModel<Owner, Model>; readonly part: ModelRenderPart; readonly affine: Affine3;
	readonly streams: Map<Float32Array, Float64Array>; readonly draws: Draw<Owner>[]; initialized: boolean; placedWorld: Readonly<Affine3> | undefined };
type Draw<Owner> = HostMeshInstance & { entry: Owner; vertices: Float64Array; reflected: boolean;
	minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type CanvasDraw<Owner> = { quad: ViewportCanvasQuad<Owner>; draw: Draw<Owner>; initialized: boolean };
export type SceneViewportGeometryBounds = { originX: number; originY: number; originZ: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type Hit<Owner> = SceneViewportPoint & { entry: Owner | undefined };

/** Retained asset placements, raster submission and triangle picking share the same occurrences and geometry. */
export class SceneViewportGeometry<Owner = SceneSourceObject, Model = string> {
	public readonly scene = new HostMeshScene(1, 1);
	public readonly represented = new Set<Owner>();
	private readonly placements: Placement<Owner, Model>[] = [];
	private readonly draws: Draw<Owner>[] = [];
	private readonly canvasDraws: CanvasDraw<Owner>[] = [];
	private canvasRevision = -1;
	private canvasPacketRevision = -1;
	private readonly affine: Affine3 = { xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };
	private readonly rayOrigin = new Float64Array(3);
	private readonly rayDirection = new Float64Array(3);
	private readonly hit: Hit<Owner> = { entry: undefined, originX: 0, originY: 0, originZ: 0, x: 0, y: 0, z: 0 };
	private source: ModelFrame<Owner, Model> | undefined;
	private assetsRevision = -1;
	private frameRevision = -1;
	private preview: SceneTransformPreview<Owner> | undefined;
	private previewRevision: number | undefined = -1;
	private cameraRevision = -1;
	private projectedRevision = -1;
	public constructor(private readonly assets: ModelAssets<Model>, private readonly canvas: CanvasFrame<Owner>) {}
	public prepare(source: ModelFrame<Owner, Model> | undefined, preview?: SceneTransformPreview<Owner>, revision = 0): void {
		const rebound = source !== this.source || this.assetsRevision !== this.assets.revision || revision !== this.frameRevision;
		this.frameRevision = revision;
		if (!rebound && preview === this.preview && this.previewRevision === preview?.revision && this.canvasRevision === this.canvas.revision) return;
		this.preview = preview; this.previewRevision = preview?.revision;
		const canvasChanged = this.canvasRevision !== this.canvas.revision; this.canvasRevision = this.canvas.revision;
		this.represented.clear();
		if (rebound) {
			this.source = source; this.assetsRevision = this.assets.revision;
			let count = 0;
			if (source !== undefined) for (const model of source.models) {
				const asset = this.assets.get(model.model)?.get(model.sceneIndex); if (asset === undefined) continue;
				for (const part of asset.parts) {
					let placement = this.placements[count];
					if (placement === undefined || placement.part !== part) {
						placement = { source: model, part, affine: { ...this.affine }, streams: new Map(), draws: [], initialized: false, placedWorld: undefined };
						this.placements[count] = placement;
					} else placement.source = model;
					let drawCount = 0;
					for (const mesh of part.meshes) {
						if (mesh.drawCount === 0) continue;
						let vertices = placement.streams.get(mesh.positions);
						if (vertices === undefined) {
							vertices = new Float64Array(mesh.positions.length); placement.streams.set(mesh.positions, vertices);
						}
						let draw = placement.draws[drawCount];
						if (draw === undefined || draw.mesh !== mesh) {
							draw = { ...placement.affine, mesh, entry: model.entry, vertices, reflected: false,
								minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
							placement.draws[drawCount] = draw;
						}
						draw.entry = model.entry; drawCount++;
					}
					placement.draws.length = drawCount; count++;
				}
			}
			this.placements.length = count;
		}
		let count = 0, changed = false;
		for (const placement of this.placements) {
			const model = placement.source, overridden = preview !== undefined && preview.worlds.has(model.entry);
			const world = overridden ? preview!.worlds.get(model.entry) as Readonly<Affine3> | undefined : model.world;
			if (world === undefined) { this.represented.delete(model.entry); continue; }
			const previous = placement.affine;
			let linearChanged = false, moved = false;
			if (rebound || overridden || placement.placedWorld !== world) {
				const affine = this.affine;
				affine.xx = world.xx; affine.xy = world.xy; affine.xz = world.xz;
				affine.yx = world.yx; affine.yy = world.yy; affine.yz = world.yz;
				affine.zx = world.zx; affine.zy = world.zy; affine.zz = world.zz;
				affine.ox = world.ox; affine.oy = world.oy; affine.oz = world.oz;
				appendAffine3(affine, model.attachment); appendAffine3(affine, model.presentation); appendAffine3(affine, placement.part.affine);
				linearChanged = !placement.initialized || previous.xx !== affine.xx || previous.xy !== affine.xy || previous.xz !== affine.xz
					|| previous.yx !== affine.yx || previous.yy !== affine.yy || previous.yz !== affine.yz
					|| previous.zx !== affine.zx || previous.zy !== affine.zy || previous.zz !== affine.zz;
				moved = linearChanged || previous.ox !== affine.ox || previous.oy !== affine.oy || previous.oz !== affine.oz;
				if (moved) Object.assign(previous, affine);
				placement.placedWorld = world;
			}
			// Translation stays separate, so a drag never recomputes shared linear vertex lanes.
			if (linearChanged) for (const [positions, vertices] of placement.streams) this.transform(positions, vertices, previous);
			for (const draw of placement.draws) {
				if (moved) { Object.assign(draw, previous); draw.reflected = hostMeshReflected(draw); changed = true; }
				if (linearChanged) this.measure(draw);
				if (this.draws[count] !== draw) changed = true;
				this.draws[count] = draw; this.scene.instances[count] = draw; count++;
			}
			placement.initialized = true;
			if (placement.draws.length !== 0) this.represented.add(model.entry);
		}
		// Canvas coordinates are Y-down pixels on the editor's XY plane. Keep
		// their origin separate from glyph/region offsets, just like model nodes.
		if (canvasChanged) {
			if (this.canvasPacketRevision !== this.canvas.packetRevision) {
				this.canvasPacketRevision = this.canvas.packetRevision; this.prepareCanvasMeshes();
			}
			for (const retained of this.canvasDraws) {
				const { draw, quad } = retained, a = quad.affine;
				const linearChanged = !retained.initialized || draw.xx !== a.xx || draw.xy !== -a.xy || draw.yx !== a.yx || draw.yy !== -a.yy;
				draw.entry = quad.source.entry;
				draw.xx = a.xx; draw.xy = -a.xy; draw.xz = 0; draw.yx = a.yx; draw.yy = -a.yy; draw.yz = 0;
				draw.zx = draw.zy = 0; draw.zz = 1; draw.ox = a.ox; draw.oy = -a.oy; draw.oz = 0;
				if (linearChanged) { this.transform(draw.mesh.positions, draw.vertices, draw); this.measure(draw); }
				retained.initialized = true;
			}
			changed = true;
		}
		for (const { draw } of this.canvasDraws) {
			this.draws[count] = this.scene.instances[count] = draw; count++; this.represented.add(draw.entry);
		}
		if (count !== this.draws.length) changed = true;
		this.draws.length = this.scene.instances.length = count;
		if (changed) this.scene.changed();
	}
	/** Consecutive packets sharing one component pose/material form one draw.
	 * Glyph count never becomes a uniform upload/draw-call count. Only packet
	 * publication examines vertex/UV layout; camera and translation skip it. */
	private prepareCanvasMeshes(): void {
		const items = this.canvas.items; let count = 0;
		for (let first = 0; first < items.length;) {
			const quad = items[first], color = (quad.color | 0xff000000) >>> 0;
			const bitmap = quad.kind === 'sprite' ? quad.bitmap : undefined;
			let end = first + 1;
			while (end < items.length) {
				const next = items[end];
				if (next.source.entry !== quad.source.entry || next.affine !== quad.affine || next.color !== quad.color
					|| (next.kind === 'sprite' ? next.bitmap : undefined) !== bitmap) break;
				end++;
			}
			let retained = this.canvasDraws[count];
			const old = retained?.draw.mesh, quads = end - first;
			let changed = old === undefined || old.positions.length !== quads * 12 || old.color !== color || old.texture?.bitmap !== bitmap;
			if (!changed) for (let index = first; index < end; index++) {
				const item = items[index], positions = old!.positions, uv = old!.texture?.uvs, base = (index - first) * 4;
				for (let corner = 0; corner < 4; corner++) {
					const right = corner === 1 || corner === 2, bottom = corner >= 2, at = (base + corner) * 3;
					if (positions[at] !== Math.fround(item.offsetX + (right ? item.width : 0)) || positions[at + 1] !== Math.fround(item.offsetY + (bottom ? item.height : 0))
						|| item.kind === 'sprite' && (uv![(base + corner) * 2] !== Math.fround(right ? item.u1 : item.u0)
							|| uv![(base + corner) * 2 + 1] !== Math.fround(bottom ? item.v1 : item.v0))) { changed = true; break; }
				}
				if (changed) break;
			}
			if (changed) {
				old?.dispose();
				const positions = new Float32Array(quads * 12), uvs = bitmap === undefined ? undefined : new Float32Array(quads * 8);
				const indices = new Uint32Array(quads * 6);
				for (let index = first; index < end; index++) {
					const item = items[index], base = (index - first) * 4, triangle = (index - first) * 6;
					for (let corner = 0; corner < 4; corner++) {
						const right = corner === 1 || corner === 2, bottom = corner >= 2, at = (base + corner) * 3;
						positions[at] = item.offsetX + (right ? item.width : 0); positions[at + 1] = item.offsetY + (bottom ? item.height : 0);
						if (item.kind === 'sprite') { uvs![(base + corner) * 2] = right ? item.u1 : item.u0; uvs![(base + corner) * 2 + 1] = bottom ? item.v1 : item.v0; }
					}
					indices[triangle] = base; indices[triangle + 1] = base + 1; indices[triangle + 2] = base + 2;
					indices[triangle + 3] = base; indices[triangle + 4] = base + 2; indices[triangle + 5] = base + 3;
				}
				const mesh = new HostMesh({ positions, indices, indexComponentType: 5125, color, doubleSided: true, layered: true,
					texture: bitmap === undefined ? undefined : { bitmap, uvs: uvs! } });
				retained = { quad, initialized: false, draw: { ...this.affine, mesh, entry: quad.source.entry,
					vertices: new Float64Array(positions.length), reflected: false, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } };
				this.canvasDraws[count] = retained;
			} else retained!.quad = quad;
			count++; first = end;
		}
		for (let index = count; index < this.canvasDraws.length; index++) this.canvasDraws[index].draw.mesh.dispose();
		this.canvasDraws.length = count;
	}
	private transform(positions: Float32Array, vertices: Float64Array, a: Readonly<Affine3>): void {
		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i], y = positions[i + 1], z = positions[i + 2];
			vertices[i] = a.xx * x + a.yx * y + a.zx * z;
			vertices[i + 1] = a.xy * x + a.yy * y + a.zy * z;
			vertices[i + 2] = a.xz * x + a.yz * y + a.zz * z;
		}
	}
	private measure(draw: Draw<Owner>): void {
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
	public frameBounds(selected: ReadonlySet<Owner> | undefined, target: SceneViewportGeometryBounds): boolean {
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
	public pick(x: number, y: number, camera: SceneViewportCamera): Readonly<Hit<Owner>> | undefined {
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
				const rasterDepth = Math.fround(camera.near / depth);
				if (draw.mesh.layered ? rasterDepth < nearestDepth : rasterDepth <= nearestDepth) continue;
				const texture = draw.mesh.texture;
				if (texture !== undefined) {
					const uv = texture.uvs, image = texture.bitmap.image, ta = a / 3 * 2, tb = b / 3 * 2, tc = c / 3 * 2;
					// Ray barycentrics are perspective-correct. Convert to screen
					// weights for the same affine UVs that the renderer samples.
					const wa = (1 - u - v) * camera.depth(vertices[a], vertices[a + 1], vertices[a + 2], draw.ox, draw.oy, draw.oz) / depth;
					const wb = u * camera.depth(vertices[b], vertices[b + 1], vertices[b + 2], draw.ox, draw.oy, draw.oz) / depth;
					const wc = v * camera.depth(vertices[c], vertices[c + 1], vertices[c + 2], draw.ox, draw.oy, draw.oz) / depth;
					const x = clamp(Math.trunc((uv[ta] * wa + uv[tb] * wb + uv[tc] * wc) * image.width), 0, image.width - 1);
					const y = clamp(Math.trunc((uv[ta + 1] * wa + uv[tb + 1] * wb + uv[tc + 1] * wc) * image.height), 0, image.height - 1);
					if (image.pixels[(y * image.width + x) * 4 + 3] === 0) continue;
				}
				// Models establish depth; the following canvas batches resolve by
				// painter order, just like the render pass, not rounded coplanarity.
				if (!draw.mesh.layered) nearestDepth = rasterDepth;
				hit.originX = draw.ox; hit.originY = draw.oy; hit.originZ = draw.oz;
				hit.entry = draw.entry; hit.x = hx; hit.y = hy; hit.z = hz;
			}
		}
		return hit.entry === undefined ? undefined : hit;
	}
	public dispose(): void {
		for (const { draw } of this.canvasDraws) draw.mesh.dispose(); this.canvasDraws.length = 0;
		this.scene.dispose(); this.draws.length = this.placements.length = 0;
		this.represented.clear(); this.source = undefined; this.preview = undefined;
	}
}
