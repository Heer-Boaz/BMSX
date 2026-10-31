import type { Affine3 } from '../../common/affine3';

export type HostMeshData = {
	positions: Float32Array;
	indices?: Uint8Array | Uint16Array | Uint32Array;
	indexComponentType?: 5121 | 5123 | 5125;
	color: number;
	doubleSided: boolean;
};

/** Immutable host-owned geometry; its provider retains the source generation. */
export class HostMesh {
	private readonly release = new Set<() => void>();
	public readonly positions: Float32Array;
	public readonly indices: Uint8Array | Uint16Array | Uint32Array | undefined;
	public readonly indexComponentType: 5121 | 5123 | 5125 | undefined;
	public readonly drawCount: number;
	public readonly color: number;
	public readonly doubleSided: boolean;
	public constructor(data: HostMeshData) {
		this.positions = data.positions; this.indices = data.indices;
		this.indexComponentType = data.indexComponentType;
		const count = data.indices === undefined ? data.positions.length / 3 : data.indices.length;
		this.drawCount = count - count % 3;
		this.color = data.color; this.doubleSided = data.doubleSided;
	}
	public onDispose(listener: () => void): () => void {
		this.release.add(listener);
		return () => this.release.delete(listener);
	}
	public dispose(): void {
		for (const listener of this.release) listener();
		this.release.clear();
	}
}

export type HostMeshInstance = Affine3 & { readonly mesh: HostMesh };

/** One retained viewport, not another authored scene graph or a pixel resource. */
export class HostMeshScene {
	private readonly release = new Set<() => void>();
	public readonly instances: HostMeshInstance[] = [];
	/** Column-major homogeneous clip coordinates: -w<=x,y<=w, 0<=z<=w; reversed Z. */
	public readonly clipFromOrigin = new Float64Array(16);
	public originX = 0;
	public originY = 0;
	public originZ = 0;
	public revision = 0;
	public constructor(public width: number, public height: number) {}
	public resize(width: number, height: number): void {
		if (this.width === width && this.height === height) return;
		this.width = width; this.height = height;
		this.changed();
	}
	/** Publish coherent camera, instance or membership edits. Idle drawing does not publish. */
	public changed(): void { this.revision++; }
	public onDispose(listener: () => void): () => void {
		this.release.add(listener);
		return () => this.release.delete(listener);
	}
	public dispose(): void {
		for (const listener of this.release) listener();
		this.release.clear();
		this.instances.length = 0;
	}
}

export type HostMeshSceneRenderSubmission = {
	scene: HostMeshScene;
	left: number; top: number; right: number; bottom: number;
};

/** Combine full Number affines with the camera before the GPU's f32 publication. */
export function writeHostMeshClipMatrix(target: Float32Array | Float64Array, scene: HostMeshScene, instance: HostMeshInstance, offset = 0): void {
	const clip = scene.clipFromOrigin;
	const ox = instance.ox - scene.originX, oy = instance.oy - scene.originY, oz = instance.oz - scene.originZ;
	for (let row = 0; row < 4; row++) {
		const a = clip[row], b = clip[row + 4], c = clip[row + 8];
		target[offset + row] = a * instance.xx + b * instance.xy + c * instance.xz;
		target[offset + row + 4] = a * instance.yx + b * instance.yy + c * instance.yz;
		target[offset + row + 8] = a * instance.zx + b * instance.zy + c * instance.zz;
		target[offset + row + 12] = a * ox + b * oy + c * oz + clip[row + 12];
	}
}

export function hostMeshReflected(instance: HostMeshInstance): boolean {
	return instance.xx * (instance.yy * instance.zz - instance.zy * instance.yz)
		+ instance.yx * (instance.zy * instance.xz - instance.xy * instance.zz)
		+ instance.zx * (instance.xy * instance.yz - instance.yy * instance.xz) < 0;
}

/** Backends retain immutable geometry uploads until the owning resource retires. */
export class HostMeshBuffers<T> {
	private readonly entries = new Map<HostMesh, { value: T; unbind: () => void }>();
	public constructor(private readonly create: (mesh: HostMesh) => T, private readonly destroy: (value: T) => void) {}
	public get(mesh: HostMesh): T {
		let entry = this.entries.get(mesh);
		if (entry === undefined) {
			entry = { value: this.create(mesh), unbind: mesh.onDispose(() => { this.destroy(entry.value); this.entries.delete(mesh); }) };
			this.entries.set(mesh, entry);
		}
		return entry.value;
	}
	public dispose(): void {
		for (const entry of this.entries.values()) { entry.unbind(); this.destroy(entry.value); }
		this.entries.clear();
	}
}

/** Material primitives can share a source accessor without duplicating its upload. */
export class HostMeshPositionBuffers<T> {
	private readonly entries = new Map<Float32Array, { value: T; references: number }>();
	public constructor(private readonly create: (positions: Float32Array) => T, private readonly destroy: (value: T) => void) {}
	public retain(positions: Float32Array): T {
		let entry = this.entries.get(positions);
		if (entry === undefined) {
			entry = { value: this.create(positions), references: 0 };
			this.entries.set(positions, entry);
		}
		entry.references++;
		return entry.value;
	}
	public release(positions: Float32Array): void {
		const entry = this.entries.get(positions)!;
		if (--entry.references === 0) { this.destroy(entry.value); this.entries.delete(positions); }
	}
}

/** A scene target owns its depth storage; only published scene changes rerender. */
export class HostMeshSceneTargets<T> {
	private readonly entries = new Map<HostMeshScene, { value: T; revision: number; width: number; height: number; unbind: () => void }>();
	public constructor(private readonly create: (scene: HostMeshScene) => T,
		private readonly render: (value: T, scene: HostMeshScene) => void, private readonly destroy: (value: T) => void) {}
	public get(scene: HostMeshScene): T {
		let entry = this.entries.get(scene);
		if (entry === undefined) {
			const value = this.create(scene);
			this.render(value, scene);
			entry = { value, revision: scene.revision, width: scene.width, height: scene.height,
				unbind: scene.onDispose(() => { this.destroy(entry.value); this.entries.delete(scene); }) };
			this.entries.set(scene, entry);
		} else if (entry.revision !== scene.revision) {
			if (entry.width !== scene.width || entry.height !== scene.height) {
				this.destroy(entry.value); entry.value = this.create(scene);
				entry.width = scene.width; entry.height = scene.height;
			}
			this.render(entry.value, scene);
			entry.revision = scene.revision;
		}
		return entry.value;
	}
	public dispose(): void {
		for (const entry of this.entries.values()) { entry.unbind(); this.destroy(entry.value); }
		this.entries.clear();
	}
}
