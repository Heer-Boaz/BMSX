import { affine3FromTRS, appendAffine3, type Affine3 } from '../../../machine/ts/common/affine3';
import type { GLTFModel, GLTFNode } from './gltf';

// These are software-renderer capabilities, not restrictions on model assets.
// Rich models always pack; binding a scene to the static-unlit renderer admits
// its aggregate capabilities once, before it can enter a render pass.
export const MODEL_STATIC_FEATURE = {
	texture: 1, alpha: 2, vertexColor: 4, morph: 8, skin: 16,
} as const;

export type ModelStaticPart = { node: number; mesh: number; affine: Affine3 };
export type ModelStaticScene = { firstPart: number; partCount: number; features: number };
export type ModelStaticMaterial = { command: number; color: number; doubleSided: boolean; features: number };

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
export function prepareModelStaticScenes(model: GLTFModel) {
	const materials: ModelStaticMaterial[] = (model.materials ?? []).map(material => {
		let features = 0;
		if (material.baseColorTexture !== undefined) features |= MODEL_STATIC_FEATURE.texture;
		if (material.alphaMode !== undefined && material.alphaMode !== 'OPAQUE') features |= MODEL_STATIC_FEATURE.alpha;
		const color = material.baseColorFactor;
		const r = Math.round((color?.[0] ?? 1) * 255), g = Math.round((color?.[1] ?? 1) * 255), b = Math.round((color?.[2] ?? 1) * 255);
		return { command: (0x20000000 | (r & 255) | ((g & 255) << 8) | ((b & 255) << 16)) >>> 0,
			color: (0xff000000 | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0,
			doubleSided: material.doubleSided === true, features };
	});
	const meshFeatures: number[] = [];
	for (const mesh of model.meshes) {
		let combined = 0;
		for (const primitive of mesh.primitives) {
			let features = primitive.materialIndex === undefined ? 0 : materials[primitive.materialIndex].features;
			if (primitive.colors !== undefined) features |= MODEL_STATIC_FEATURE.vertexColor;
			if (primitive.morphPositions?.length || primitive.morphNormals?.length || primitive.morphTangents?.length)
				features |= MODEL_STATIC_FEATURE.morph;
			combined |= features;
		}
		meshFeatures.push(combined);
	}
	const scenes: ModelStaticScene[] = [], parts: ModelStaticPart[] = [];
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
