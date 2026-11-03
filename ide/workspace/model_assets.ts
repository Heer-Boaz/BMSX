import type { Affine3 } from '../../machine/ts/common/affine3';
import { HostMesh } from '../../machine/ts/render/host_overlay/mesh';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { GX_GPU_TEXTURE_MODE_DIRECT16 } from '../../machine/ts/spec/gx/gp0';
import { MODEL_STATIC_FEATURE, type ModelAsset } from '../../toolchain/ts/rompack/model';
import { decodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { decodeGxTextureImage } from '../../toolchain/ts/rompack/gx_texture_codec';
import type { WorkspaceSourceCatalog, WorkspaceSourceContext } from './source_catalog';

export type WorkspaceModelPart = { readonly affine: Readonly<Affine3>; readonly meshes: readonly HostMesh[] };
export type WorkspaceModelScene = { readonly parts: readonly WorkspaceModelPart[] };
type Binding = {
	readonly provider: WorkspaceSourceContext;
	readonly model: ModelAsset;
	readonly rom: Uint8Array;
	readonly meshes: Map<number, readonly HostMesh[]>;
	readonly scenes: Map<number, WorkspaceModelScene>;
	readonly textures: Map<number, HostBitmap>;
	readonly texcoords: Map<Uint16Array, Float32Array>;
	epoch: number;
};

/** A reader's immutable model generations and shared primitive resources. No guest decoding or World. */
export class WorkspaceModelAssets {
	private readonly bindings = new Map<string, Binding>();
	private epoch = 0;
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public get revision(): number { return this.epoch; }
	public update(contextId: string, modelIds: ReadonlySet<string>): void {
		const epoch = ++this.epoch;
		for (const id of modelIds) {
			const resolved = this.catalog.resolveAsset(contextId, 'model', id);
			if (resolved === undefined) continue;
			const provider = this.catalog.getContext(resolved.contextId), mounted = provider.previewRom;
			if (mounted === null) continue;
			const previous = this.bindings.get(id), model = resolved.value;
			if (previous?.provider === provider && previous.model === model && previous.rom === mounted.bytes) {
				previous.epoch = epoch; continue;
			}
			if (previous !== undefined) this.retire(previous);
			this.bindings.set(id, { provider, model, rom: mounted.bytes, epoch,
				meshes: new Map(), scenes: new Map(), textures: new Map(), texcoords: new Map() });
		}
		for (const [id, binding] of this.bindings) if (binding.epoch !== epoch) {
			this.retire(binding); this.bindings.delete(id);
		}
	}
	/** Only the chosen scene's actual shader requirements govern availability. */
	public get(id: string, selected?: number): WorkspaceModelScene | undefined {
		const binding = this.bindings.get(id);
		if (binding === undefined) return;
		const index = selected ?? binding.model.defaultScene;
		if (index === undefined) return;
		const source = binding.model.scenes[index];
		if (source === undefined || (source.features & ~MODEL_STATIC_FEATURE.texture) !== 0) return;
		let scene = binding.scenes.get(index);
		if (scene !== undefined) return scene;
		const parts: WorkspaceModelPart[] = [], model = binding.model;
		for (let partIndex = source.firstPart; partIndex < source.firstPart + source.partCount; partIndex++) {
			const part = model.parts[partIndex];
			let meshes = binding.meshes.get(part.mesh);
			if (meshes === undefined) {
				meshes = binding.model.meshes[part.mesh].primitives.map(primitive => {
					const material = primitive.materialIndex === undefined ? undefined : model.materials[primitive.materialIndex];
					let texture;
					if (material?.textureIndex !== undefined) {
						const image = model.textures[material.textureIndex];
						let bitmap = binding.textures.get(material.textureIndex);
						if (bitmap === undefined) {
							const decoded = decodeGxTextureImage(decodeImgDecStream(image.stream, 0, image.stream.length).payload,
								{ mode: GX_GPU_TEXTURE_MODE_DIRECT16, wordWidth: image.width, height: image.height });
							bitmap = new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba });
							binding.textures.set(material.textureIndex, bitmap);
						}
						const words = primitive.pageTexcoords;
						let uvs = binding.texcoords.get(words);
						if (uvs === undefined) {
							uvs = new Float32Array(words.length * 2);
							for (let index = 0; index < words.length; index++) {
								uvs[index * 2] = ((words[index] & 255) + 0.5) / image.width;
								uvs[index * 2 + 1] = ((words[index] >>> 8) + 0.5) / image.height;
							}
							binding.texcoords.set(words, uvs);
						}
						texture = { bitmap, uvs };
					}
					return new HostMesh({ positions: primitive.positions, indices: primitive.indices, indexComponentType: primitive.indexComponentType,
						gxCommand: material === undefined ? 0x20ffffff : material.command, doubleSided: material === undefined ? false : material.doubleSided, texture });
				});
				binding.meshes.set(part.mesh, meshes);
			}
			parts.push({ affine: part.affine, meshes });
		}
		scene = { parts }; binding.scenes.set(index, scene); return scene;
	}
	private retire(binding: Binding): void {
		for (const meshes of binding.meshes.values()) for (const mesh of meshes) mesh.dispose();
		for (const bitmap of binding.textures.values()) bitmap.dispose();
	}
	public dispose(): void { for (const binding of this.bindings.values()) this.retire(binding); this.bindings.clear(); }
}
