import type { Affine3 } from '../../machine/ts/common/affine3';
import { HostMesh } from '../../machine/ts/render/host_overlay/mesh';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { GX_GPU_TEXTURE_MODE_DIRECT16 } from '../../machine/ts/spec/gx/gp0';
import { MODEL_STATIC_FEATURE, type ModelAsset } from '../../toolchain/ts/rompack/model';
import { decodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { decodeGxTextureImage } from '../../toolchain/ts/rompack/gx_texture_codec';

export type ModelRenderPart = { readonly affine: Readonly<Affine3>; readonly meshes: readonly HostMesh[] };
export type ModelRenderScene = { readonly parts: readonly ModelRenderPart[] };
/** Immutable packed model resources shared by authored and installed-world readers. */
export class ModelRenderResources {
	private readonly meshes = new Map<number, readonly HostMesh[]>();
	private readonly scenes = new Map<number, ModelRenderScene>();
	private readonly textures = new Map<number, HostBitmap>();
	private readonly texcoords = new Map<Uint16Array, Float32Array>();
	public constructor(private readonly model: ModelAsset) {}
	/** Only the chosen scene's actual shader requirements govern availability. */
	public get(selected?: number): ModelRenderScene | undefined {
		const binding = this;
		const index = selected ?? binding.model.defaultScene;
		if (index === undefined) return;
		const source = binding.model.scenes[index];
		if (source === undefined || (source.features & ~MODEL_STATIC_FEATURE.texture) !== 0) return;
		let scene = binding.scenes.get(index);
		if (scene !== undefined) return scene;
		const parts: ModelRenderPart[] = [], model = binding.model;
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
	public dispose(): void {
		for (const meshes of this.meshes.values()) for (const mesh of meshes) mesh.dispose();
		for (const bitmap of this.textures.values()) bitmap.dispose();
		this.meshes.clear(); this.scenes.clear(); this.textures.clear(); this.texcoords.clear();
	}
}
