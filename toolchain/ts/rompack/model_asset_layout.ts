// Model payload offsets are resource-relative bytes. The directories and every
// geometry stream are word-aligned; the rich section retains the other GLTF
// fields without making guest geometry readers deserialize an object graph.
export const MODEL_ASSET_HEADER_BYTE_LENGTH = 24;
export const MODEL_MESH_BYTE_LENGTH = 8;
export const MODEL_PRIMITIVE_BYTE_LENGTH = 24;

export const MODEL_ASSET_HEADER = {
	richOffset: 0,
	richLength: 4,
	meshDirectoryOffset: 8,
	meshCount: 12,
	primitiveDirectoryOffset: 16,
	primitiveCount: 20,
} as const;

export const MODEL_MESH = {
	firstPrimitive: 0,
	primitiveCount: 4,
} as const;

export const MODEL_PRIMITIVE = {
	positionsOffset: 0,
	// Count individual f32 scalars, not XYZ triples.
	positionScalarCount: 4,
	// Zero is absent; a present empty index stream still has a resource offset.
	indicesOffset: 8,
	indexCount: 12,
	// GLTF component codes 5121/5123/5125 retain the authored index width.
	indexComponentType: 16,
	// 0xffffffff denotes an absent material; material zero remains zero.
	materialIndex: 20,
} as const;
