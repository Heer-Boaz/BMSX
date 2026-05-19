#include "render/3d/mesh/vertex_stream.h"

#include "machine/devices/vdp/fixed_point.h"

#include <vector>

namespace bmsx {
namespace {

struct ResolvedMeshMaterial {
	std::array<f32, 4> color{1.0f, 1.0f, 1.0f, 1.0f};
	MeshDrawMaterial draw{};
};

enum class SkinVectorKind {
	Position,
	Normal,
};

void accumulateWeightedVector(Vec3& weighted, const Vec3& transformed, f32 weight) {
	weighted.x += transformed.x * weight;
	weighted.y += transformed.y * weight;
	weighted.z += transformed.z * weight;
}

std::array<f32, 4> packetColorAsLinear(u32 color) {
	return {
		static_cast<f32>((color >> 16u) & 0xffu) / 255.0f,
		static_cast<f32>((color >> 8u) & 0xffu) / 255.0f,
		static_cast<f32>(color & 0xffu) / 255.0f,
		static_cast<f32>((color >> 24u) & 0xffu) / 255.0f,
	};
}

size_t meshMorphTargetCount(const VdpMeshSourceMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	size_t morphCount = entry.morphCount;
	if (morphCount > mesh.morphPositions->size()) {
		morphCount = mesh.morphPositions->size();
	}
	return morphCount;
}

bool meshHasSkinningSource(const VdpMeshSourceMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	const size_t influenceCount = (mesh.positions->size() / 3u) * 4u;
	return entry.jointCount != 0u && mesh.jointIndices->size() >= influenceCount && mesh.jointWeights->size() >= influenceCount;
}

template<SkinVectorKind Kind>
void writeSkinnedVectorInto(Vec3& out,
							const std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT>& jointMatrices,
							const VdpMeshSourceMesh& mesh,
							size_t vertexIndex,
							f32 x,
							f32 y,
							f32 z,
							u32 jointCount) {
	const size_t influenceBase = vertexIndex * 4u;
	const std::vector<u16>& jointIndices = *mesh.jointIndices;
	const std::vector<f32>& jointWeights = *mesh.jointWeights;
	Vec3 weighted{};
	Vec3 transformed{};
	for (size_t influence = 0u; influence < 4u; ++influence) {
		const u16 joint = jointIndices[influenceBase + influence];
		if (joint < jointCount) {
			if constexpr (Kind == SkinVectorKind::Position) {
				Render3D::mat4TransformAffinePoint3Into(transformed, jointMatrices[joint], x, y, z);
			} else {
				Render3D::mat4TransformDir3Into(transformed, jointMatrices[joint], x, y, z);
			}
		} else {
			Render3D::vec3Set(transformed, x, y, z);
		}
		accumulateWeightedVector(weighted, transformed, jointWeights[influenceBase + influence]);
	}
	out = weighted;
}

void writeMeshVertex(MeshStreamVertex& target,
					 const std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT>& jointMatrices,
					 const std::array<f32, VDP_MDU_MORPH_WEIGHT_LIMIT>& morphWeights,
					 const VdpMeshSourceMesh& mesh,
					 size_t vertexIndex,
					 size_t morphCount,
					 bool skinningEnabled,
					 u32 jointCount,
					 const ResolvedMeshMaterial& material) {
	const size_t positionBase = vertexIndex * 3u;
	const std::vector<f32>& positions = *mesh.positions;
	const std::vector<f32>& normals = *mesh.normals;
	const std::vector<std::vector<f32>>& morphPositions = *mesh.morphPositions;
	const std::vector<std::vector<f32>>& morphNormals = *mesh.morphNormals;
	f32 x = positions[positionBase];
	f32 y = positions[positionBase + 1u];
	f32 z = positions[positionBase + 2u];
	f32 nx = 0.0f;
	f32 ny = 0.0f;
	f32 nz = 1.0f;
	if (positionBase + 2u < normals.size()) {
		nx = normals[positionBase];
		ny = normals[positionBase + 1u];
		nz = normals[positionBase + 2u];
	}
	for (u32 morphIndex = 0u; morphIndex < morphCount; ++morphIndex) {
		const std::vector<f32>& morph = morphPositions[morphIndex];
		const f32 weight = morphWeights[morphIndex];
		x += morph[positionBase] * weight;
		y += morph[positionBase + 1u] * weight;
		z += morph[positionBase + 2u] * weight;
		if (morphIndex < morphNormals.size()) {
			const std::vector<f32>& morphNormal = morphNormals[morphIndex];
			nx += morphNormal[positionBase] * weight;
			ny += morphNormal[positionBase + 1u] * weight;
			nz += morphNormal[positionBase + 2u] * weight;
		}
	}
	if (skinningEnabled) {
		Vec3 skinnedPosition{};
		writeSkinnedVectorInto<SkinVectorKind::Position>(skinnedPosition, jointMatrices, mesh, vertexIndex, x, y, z, jointCount);
		x = skinnedPosition.x;
		y = skinnedPosition.y;
		z = skinnedPosition.z;
		Vec3 skinnedNormal{};
		writeSkinnedVectorInto<SkinVectorKind::Normal>(skinnedNormal, jointMatrices, mesh, vertexIndex, nx, ny, nz, jointCount);
		nx = skinnedNormal.x;
		ny = skinnedNormal.y;
		nz = skinnedNormal.z;
	}
	const size_t uvBase = vertexIndex * 2u;
	const std::vector<f32>& texcoords = *mesh.texcoords;
	const bool hasTexcoord = uvBase + 1u < texcoords.size();
	const size_t colorBase = vertexIndex * 4u;
	const std::vector<f32>& colors = *mesh.colors;
	const bool hasColor = colorBase + 3u < colors.size();
	target.x = x;
	target.y = y;
	target.z = z;
	target.nx = nx;
	target.ny = ny;
	target.nz = nz;
	target.u = hasTexcoord ? texcoords[uvBase] : 0.0f;
	target.v = hasTexcoord ? texcoords[uvBase + 1u] : 0.0f;
	target.r = hasColor ? colors[colorBase] * material.color[0] : material.color[0];
	target.g = hasColor ? colors[colorBase + 1u] * material.color[1] : material.color[1];
	target.b = hasColor ? colors[colorBase + 2u] * material.color[2] : material.color[2];
	target.a = hasColor ? colors[colorBase + 3u] * material.color[3] : material.color[3];
}

i32 meshSurfaceMode(VdpMeshAlphaMode alphaMode) {
	switch (alphaMode) {
		case VdpMeshAlphaMode::Opaque: return MESH_SURFACE_OPAQUE;
		case VdpMeshAlphaMode::Mask: return MESH_SURFACE_MASK;
		case VdpMeshAlphaMode::Blend: return MESH_SURFACE_BLEND;
	}
	return MESH_SURFACE_OPAQUE;
}

ResolvedMeshMaterial resolveMeshMaterial(const VdpMeshSourceMaterial& sourceMaterial, const GameView::VdpMeshRenderEntry& entry) {
	ResolvedMeshMaterial material;
	material.color = packetColorAsLinear(entry.color);
	material.color[0] *= sourceMaterial.baseColorFactor[0];
	material.color[1] *= sourceMaterial.baseColorFactor[1];
	material.color[2] *= sourceMaterial.baseColorFactor[2];
	material.color[3] *= sourceMaterial.baseColorFactor[3];
	material.draw.surface = meshSurfaceMode(sourceMaterial.alphaMode);
	material.draw.alphaCutoff = sourceMaterial.alphaCutoff;
	material.draw.metallicFactor = sourceMaterial.metallicFactor;
	material.draw.roughnessFactor = sourceMaterial.roughnessFactor;
	material.draw.emissiveFactor = sourceMaterial.emissiveFactor;
	material.draw.doubleSided = sourceMaterial.doubleSided;
	material.draw.unlit = sourceMaterial.unlit;
	return material;
}

} // namespace

MeshDrawStream MeshVertexStreamBuilder::build(const GameView& view,
											 const VdpMeshSourceMesh& mesh,
											 const VdpMeshSourceMaterial& sourceMaterial,
											 const GameView::VdpMeshRenderEntry& entry) {
	decodeSignedQ16_16WordsInto(m_modelMatrix.data(), view.vdpXfMatrixWords.data() + static_cast<size_t>(entry.modelMatrixIndex * VDP_XF_MATRIX_WORDS), VDP_XF_MATRIX_WORDS);
	Render3D::mat4Normal3Into(m_normalMatrix, m_modelMatrix);
	const ResolvedMeshMaterial material = resolveMeshMaterial(sourceMaterial, entry);
	const size_t sourceVertexCount = mesh.hasIndices ? mesh.indices->size() : mesh.positions->size() / 3u;
	const size_t outputVertexCount = sourceVertexCount > VDP_MDU_VERTEX_LIMIT ? VDP_MDU_VERTEX_LIMIT : sourceVertexCount;
	const size_t morphCount = meshMorphTargetCount(mesh, entry);
	decodeSignedQ16_16WordsInto(m_morphWeights.data(), view.vdpMorphWeightWords.data() + entry.morphBase, morphCount);
	const bool skinningEnabled = meshHasSkinningSource(mesh, entry);
	if (skinningEnabled) {
		for (u32 index = 0u; index < entry.jointCount; ++index) {
			decodeSignedQ16_16WordsInto(m_jointMatrices[index].data(), view.vdpJointMatrixWords.data() + static_cast<size_t>((entry.jointBase + index) * VDP_JTU_MATRIX_WORDS), VDP_JTU_MATRIX_WORDS);
		}
	}
	m_vertexCount = outputVertexCount;
	if (!mesh.hasIndices) {
		for (size_t index = 0u; index < outputVertexCount; ++index) {
			writeMeshVertex(m_vertices[index], m_jointMatrices, m_morphWeights, mesh, index, morphCount, skinningEnabled, entry.jointCount, material);
		}
	} else {
		const std::vector<u32>& indices = *mesh.indices;
		for (size_t index = 0u; index < outputVertexCount; ++index) {
			writeMeshVertex(m_vertices[index], m_jointMatrices, m_morphWeights, mesh, indices[index], morphCount, skinningEnabled, entry.jointCount, material);
		}
	}
	return {m_vertices.data(), m_vertexCount, &m_modelMatrix, &m_normalMatrix, material.draw};
}

} // namespace bmsx
