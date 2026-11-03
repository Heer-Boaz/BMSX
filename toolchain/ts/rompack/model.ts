import type { Affine3 } from '../../../machine/ts/common/affine3';
import type { GLTFIndexArray, GLTFModel } from './gltf';

// Static-renderer capabilities, not restrictions on importing rich models.
export const MODEL_STATIC_FEATURE = {
	texture: 1, alpha: 2, vertexColor: 4, morph: 8, skin: 16, textureLayout: 32,
} as const;

export type ModelTexture = { readonly width: number; readonly height: number; readonly stream: Uint8Array };
/** Image slots retain source identity; unused images have no native stream. */
export type ModelTextures = readonly (ModelTexture | undefined)[];
export type ModelPrimitive = {
	readonly positions: Float32Array;
	readonly indices: GLTFIndexArray | undefined;
	readonly indexComponentType: 5121 | 5123 | 5125 | undefined;
	readonly materialIndex: number | undefined;
	readonly pageTexcoords: Uint16Array | undefined;
};
export type ModelMesh = { readonly primitives: readonly ModelPrimitive[] };
export type ModelPart = { readonly node: number; readonly mesh: number; readonly affine: Readonly<Affine3> };
export type ModelScene = { readonly firstPart: number; readonly partCount: number; readonly features: number };
export type ModelMaterial = { readonly command: number; readonly doubleSided: boolean; readonly textureIndex: number | undefined };

/** One immutable packed generation. Rendering consumes its compiled directories;
 * source retains the rich import for inspection, not a second rendering plan. */
export type ModelAsset = {
	readonly name: string;
	readonly meshes: readonly ModelMesh[];
	readonly parts: readonly ModelPart[];
	readonly scenes: readonly ModelScene[];
	readonly defaultScene: number | undefined;
	readonly materials: readonly ModelMaterial[];
	readonly textures: ModelTextures;
	readonly source: GLTFModel;
};
