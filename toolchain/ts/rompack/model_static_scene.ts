import { affine3FromTRS, appendAffine3, type Affine3 } from '../../../machine/ts/common/affine3';
import type { GLTFModel, GLTFNode } from './gltf';
import { MODEL_STATIC_FEATURE, type ModelPart, type ModelScene, type ModelMaterial, type ModelTextures } from './model';

// These are software-renderer capabilities, not restrictions on model assets.
// Rich models always pack; binding a scene to the static-unlit renderer admits
// its aggregate capabilities once, before it can enter a render pass.
type PreparedMaterial = ModelMaterial & { readonly features: number };

function nodeAffine(node: GLTFNode): Affine3 {
	const matrix = node.matrix;
	if (matrix !== undefined) return {
		xx: matrix[0], xy: matrix[1], xz: matrix[2], yx: matrix[4], yy: matrix[5], yz: matrix[6],
		zx: matrix[8], zy: matrix[9], zz: matrix[10], ox: matrix[12], oy: matrix[13], oz: matrix[14],
	};
	const t = node.translation, q = node.rotation, s = node.scale;
	return affine3FromTRS(t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0,
		q?.[0] ?? 0, q?.[1] ?? 0, q?.[2] ?? 0, q?.[3] ?? 1, s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1);
}

/** Compile immutable scene placement, keeping mesh streams shared and unbaked. */
export function prepareModelStaticScenes(model: GLTFModel, textures: ModelTextures) {
	const materials: PreparedMaterial[] = (model.materials ?? []).map(material => {
		let features = 0;
		const textured = material.baseColorTexture !== undefined;
		const textureIndex = textured ? model.textures[material.baseColorTexture].source : undefined;
		if (textured) {
			features |= MODEL_STATIC_FEATURE.texture;
			const image = textures[textureIndex];
			if (image === undefined || image.width > 256 || image.height > 256) features |= MODEL_STATIC_FEATURE.textureLayout;
		}
		if (material.alphaMode !== undefined && material.alphaMode !== 'OPAQUE') features |= MODEL_STATIC_FEATURE.alpha;
		const color = material.baseColorFactor;
		// Quantize directly to the destination representation. An intermediate
		// RGB8 color would round texture gains twice (notably beside 0 and 1).
		const scale = textured ? 128 : 255;
		const cr = Math.round((color?.[0] ?? 1) * scale), cg = Math.round((color?.[1] ?? 1) * scale), cb = Math.round((color?.[2] ?? 1) * scale);
		return { command: ((textured ? 0x24000000 : 0x20000000) | (cr & 255) | ((cg & 255) << 8) | ((cb & 255) << 16)) >>> 0,
			doubleSided: material.doubleSided === true, features, textureIndex };
	});
	const meshFeatures: number[] = [];
	for (const mesh of model.meshes) {
		let combined = 0;
		for (const primitive of mesh.primitives) {
			let features = primitive.materialIndex === undefined ? 0 : materials[primitive.materialIndex].features;
			if ((features & MODEL_STATIC_FEATURE.texture) !== 0) {
				const material = model.materials[primitive.materialIndex];
				const uvSet = material.baseColorTexCoord ?? 0;
				const uv = uvSet === 0 ? primitive.texcoords : uvSet === 1 ? primitive.texcoords1 : undefined;
				// The static pass binds one page per primitive. Tiled coordinates
				// require geometry subdivision, not wrapping each vertex separately.
				if (uv === undefined || uv.some(value => value < 0 || value > 1)) features |= MODEL_STATIC_FEATURE.textureLayout;
			}
			if (primitive.colors !== undefined) features |= MODEL_STATIC_FEATURE.vertexColor;
			if (primitive.morphPositions?.length || primitive.morphNormals?.length || primitive.morphTangents?.length)
				features |= MODEL_STATIC_FEATURE.morph;
			combined |= features;
		}
		meshFeatures.push(combined);
	}
	const scenes: ModelScene[] = [], parts: ModelPart[] = [];
	for (const scene of model.scenes ?? []) {
		const firstPart = parts.length;
		let features = 0;
		const visit = (index: number, parent?: Affine3) => {
			const node = model.nodes[index];
			if (node.visible === false) return;
			const local = nodeAffine(node);
			const world = parent === undefined ? local : { ...parent };
			if (parent !== undefined) appendAffine3(world, local);
			if (node.mesh !== undefined) {
				const partFeatures = meshFeatures[node.mesh] | (node.skin === undefined ? 0 : MODEL_STATIC_FEATURE.skin);
				parts.push({ node: index, mesh: node.mesh, affine: world });
				features |= partFeatures;
			}
			for (const child of node.children ?? []) visit(child, world);
		};
		for (const node of scene.nodes) visit(node);
		scenes.push({ firstPart, partCount: parts.length - firstPart, features });
	}
	return { materials, scenes, parts };
}
