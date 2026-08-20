import type { Polygon, RectBounds } from '../../../machine/ts/common/rect';

const GEO_COLLISION_BIN_MAGIC = 0x32443247; // "G2D2" little-endian
const GEO_COLLISION_BIN_VERSION = 2;
const GEO_COLLISION_SHAPE_KIND_AABB = 1;
const GEO_COLLISION_SHAPE_KIND_CONVEX_POLY = 3;
const GEO_COLLISION_SHAPE_KIND_COMPOUND = 4;
const GEO_COLLISION_VARIANT_HEADER_BYTES = 32;
const GEO_COLLISION_SHAPE_DESCRIPTOR_BYTES = 16;

export type AabbCollisionShapePiece = { kind: 'aabb'; bounds: RectBounds };

export type CollisionShapePiece =
	| AabbCollisionShapePiece
	| { kind: 'convex_poly'; vertices: Polygon };

export type CollisionShapeVariant = {
	bounds: RectBounds;
	pieces?: readonly CollisionShapePiece[];
};

export type CollisionShapeVariants = {
	original: CollisionShapeVariant;
	fliph: CollisionShapeVariant;
	flipv: CollisionShapeVariant;
	fliphv: CollisionShapeVariant;
};

export function convexCollisionPiece(vertices: Polygon): CollisionShapePiece {
	return { kind: 'convex_poly', vertices };
}

export function aabbCollisionPiece(bounds: RectBounds): AabbCollisionShapePiece {
	return { kind: 'aabb', bounds };
}

function polygonBounds(vertices: Polygon): RectBounds {
	let left = vertices[0];
	let top = vertices[1];
	let right = left;
	let bottom = top;
	for (let index = 2; index < vertices.length; index += 2) {
		const x = vertices[index];
		const y = vertices[index + 1];
		if (x < left) left = x;
		if (x > right) right = x;
		if (y < top) top = y;
		if (y > bottom) bottom = y;
	}
	return { left, top, right, bottom };
}

export function encodeCollisionShapeVariants(variants: CollisionShapeVariants): Uint8Array {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;

	const append = (bytes: Uint8Array): number => {
		chunks.push(bytes);
		byteLength += bytes.byteLength;
		return byteLength - bytes.byteLength;
	};

	const header = new Uint8Array(GEO_COLLISION_VARIANT_HEADER_BYTES);
	append(header);

	const appendBounds = (bounds: RectBounds): number => {
		const bytes = new Uint8Array(16);
		const view = new DataView(bytes.buffer);
		view.setFloat32(0, bounds.left, true);
		view.setFloat32(4, bounds.top, true);
		view.setFloat32(8, bounds.right, true);
		view.setFloat32(12, bounds.bottom, true);
		return append(bytes);
	};

	const appendVertices = (vertices: Polygon): number => {
		const bytes = new Uint8Array(vertices.length * 4);
		const view = new DataView(bytes.buffer);
		for (let index = 0; index < vertices.length; index += 1) {
			view.setFloat32(index * 4, vertices[index], true);
		}
		return append(bytes);
	};

	const writeDescriptor = (
		target: Uint8Array,
		kind: number,
		dataCount: number,
		descriptorOffset: number,
		dataOffset: number,
		boundsOffset: number,
	): void => {
		const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
		view.setUint32(0, kind, true);
		view.setUint32(4, dataCount, true);
		view.setUint32(8, dataOffset - descriptorOffset, true);
		view.setUint32(12, boundsOffset - descriptorOffset, true);
	};

	const encodePiece = (descriptor: Uint8Array, descriptorOffset: number, piece: CollisionShapePiece): void => {
		if (piece.kind === 'aabb') {
			const boundsOffset = appendBounds(piece.bounds);
			writeDescriptor(
				descriptor,
				GEO_COLLISION_SHAPE_KIND_AABB,
				4,
				descriptorOffset,
				boundsOffset,
				boundsOffset,
			);
			return;
		}
		const verticesOffset = appendVertices(piece.vertices);
		const boundsOffset = appendBounds(polygonBounds(piece.vertices));
		writeDescriptor(
			descriptor,
			GEO_COLLISION_SHAPE_KIND_CONVEX_POLY,
			piece.vertices.length >> 1,
			descriptorOffset,
			verticesOffset,
			boundsOffset,
		);
	};

	const encodeVariant = (variant: CollisionShapeVariant): number => {
		const descriptor = new Uint8Array(GEO_COLLISION_SHAPE_DESCRIPTOR_BYTES);
		const descriptorOffset = append(descriptor);
		const pieces = variant.pieces;
		if (pieces === undefined || pieces.length === 0) {
			const boundsOffset = appendBounds(variant.bounds);
			writeDescriptor(
				descriptor,
				GEO_COLLISION_SHAPE_KIND_AABB,
				4,
				descriptorOffset,
				boundsOffset,
				boundsOffset,
			);
			return descriptorOffset;
		}
		if (pieces.length === 1) {
			encodePiece(descriptor, descriptorOffset, pieces[0]);
			return descriptorOffset;
		}

		const pieceDescriptors = new Uint8Array(pieces.length * GEO_COLLISION_SHAPE_DESCRIPTOR_BYTES);
		const pieceDescriptorsOffset = append(pieceDescriptors);
		for (let index = 0; index < pieces.length; index += 1) {
			const begin = index * GEO_COLLISION_SHAPE_DESCRIPTOR_BYTES;
			encodePiece(
				pieceDescriptors.subarray(begin, begin + GEO_COLLISION_SHAPE_DESCRIPTOR_BYTES),
				pieceDescriptorsOffset + begin,
				pieces[index],
			);
		}
		const boundsOffset = appendBounds(variant.bounds);
		writeDescriptor(
			descriptor,
			GEO_COLLISION_SHAPE_KIND_COMPOUND,
			pieces.length,
			descriptorOffset,
			pieceDescriptorsOffset,
			boundsOffset,
		);
		return descriptorOffset;
	};

	const originalOffset = encodeVariant(variants.original);
	const fliphOffset = encodeVariant(variants.fliph);
	const flipvOffset = encodeVariant(variants.flipv);
	const fliphvOffset = encodeVariant(variants.fliphv);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, GEO_COLLISION_BIN_MAGIC, true);
	headerView.setUint32(4, GEO_COLLISION_BIN_VERSION, true);
	headerView.setUint32(8, originalOffset, true);
	headerView.setUint32(12, fliphOffset, true);
	headerView.setUint32(16, flipvOffset, true);
	headerView.setUint32(20, fliphvOffset, true);

	const result = new Uint8Array(byteLength);
	let outputOffset = 0;
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		result.set(chunk, outputOffset);
		outputOffset += chunk.byteLength;
	}
	return result;
}
