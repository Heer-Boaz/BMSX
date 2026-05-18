#include "render/3d/mesh/vertex_stream.h"

#include "machine/devices/vdp/fixed_point.h"
#include "rompack/assets.h"

#include <vector>

namespace bmsx {
namespace {

struct ResolvedMeshMaterial {
	std::array<f32, 4> color{1.0f, 1.0f, 1.0f, 1.0f};
	MeshDrawMaterial draw{};
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

size_t meshMorphTargetCount(const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	size_t morphCount = entry.morphCount;
	if (morphCount > mesh.morphPositions.size()) {
		morphCount = mesh.morphPositions.size();
	}
	return morphCount;
}

bool meshHasSkinningSource(const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	const size_t influenceCount = (mesh.positions.size() / 3u) * 4u;
	return entry.jointCount != 0u && mesh.jointIndices.size() >= influenceCount && mesh.jointWeights.size() >= influenceCount;
}

void writeSkinnedPositionInto(Vec3& out,
							  const std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT>& jointMatrices,
							  const ModelMesh& mesh,
							  size_t vertexIndex,
							  f32 x,
							  f32 y,
							  f32 z,
							  u32 jointCount) {
	const size_t influenceBase = vertexIndex * 4u;
	Vec3 weighted{};
	Vec3 transformed{};
	for (size_t influence = 0u; influence < 4u; ++influence) {
		const u16 joint = mesh.jointIndices[influenceBase + influence];
		if (joint < jointCount) {
			Render3D::mat4TransformAffinePoint3Into(transformed, jointMatrices[joint], x, y, z);
		} else {
			Render3D::vec3Set(transformed, x, y, z);
		}
		accumulateWeightedVector(weighted, transformed, mesh.jointWeights[influenceBase + influence]);
	}
	out = weighted;
}

void writeSkinnedNormalInto(Vec3& out,
							const std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT>& jointMatrices,
							const ModelMesh& mesh,
							size_t vertexIndex,
							f32 x,
							f32 y,
							f32 z,
							u32 jointCount) {
	const size_t influenceBase = vertexIndex * 4u;
	Vec3 weighted{};
	Vec3 transformed{};
	for (size_t influence = 0u; influence < 4u; ++influence) {
		const u16 joint = mesh.jointIndices[influenceBase + influence];
		if (joint < jointCount) {
			Render3D::mat4TransformDir3Into(transformed, jointMatrices[joint], x, y, z);
		} else {
			Render3D::vec3Set(transformed, x, y, z);
		}
		accumulateWeightedVector(weighted, transformed, mesh.jointWeights[influenceBase + influence]);
	}
	out = weighted;
}

void writeMeshVertex(MeshStreamVertex& target,
					 const std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT>& jointMatrices,
					 const std::array<f32, VDP_MDU_MORPH_WEIGHT_LIMIT>& morphWeights,
					 const ModelMesh& mesh,
					 size_t vertexIndex,
					 size_t morphCount,
					 bool skinningEnabled,
					 u32 jointCount,
					 const ResolvedMeshMaterial& material) {
	const size_t positionBase = vertexIndex * 3u;
	f32 x = mesh.positions[positionBase];
	f32 y = mesh.positions[positionBase + 1u];
	f32 z = mesh.positions[positionBase + 2u];
	f32 nx = 0.0f;
	f32 ny = 0.0f;
	f32 nz = 1.0f;
	if (positionBase + 2u < mesh.normals.size()) {
		nx = mesh.normals[positionBase];
		ny = mesh.normals[positionBase + 1u];
		nz = mesh.normals[positionBase + 2u];
	}
	for (u32 morphIndex = 0u; morphIndex < morphCount; ++morphIndex) {
		const std::vector<f32>& morph = mesh.morphPositions[morphIndex];
		const f32 weight = morphWeights[morphIndex];
		x += morph[positionBase] * weight;
		y += morph[positionBase + 1u] * weight;
		z += morph[positionBase + 2u] * weight;
		if (morphIndex < mesh.morphNormals.size()) {
			const std::vector<f32>& morphNormal = mesh.morphNormals[morphIndex];
			nx += morphNormal[positionBase] * weight;
			ny += morphNormal[positionBase + 1u] * weight;
			nz += morphNormal[positionBase + 2u] * weight;
		}
	}
	if (skinningEnabled) {
		Vec3 skinnedPosition{};
		writeSkinnedPositionInto(skinnedPosition, jointMatrices, mesh, vertexIndex, x, y, z, jointCount);
		x = skinnedPosition.x;
		y = skinnedPosition.y;
		z = skinnedPosition.z;
		Vec3 skinnedNormal{};
		writeSkinnedNormalInto(skinnedNormal, jointMatrices, mesh, vertexIndex, nx, ny, nz, jointCount);
		nx = skinnedNormal.x;
		ny = skinnedNormal.y;
		nz = skinnedNormal.z;
	}
	const size_t uvBase = vertexIndex * 2u;
	const bool hasTexcoord = uvBase + 1u < mesh.texcoords.size();
	const size_t colorBase = vertexIndex * 4u;
	const bool hasColor = colorBase + 3u < mesh.colors.size();
	target.x = x;
	target.y = y;
	target.z = z;
	target.nx = nx;
	target.ny = ny;
	target.nz = nz;
	target.u = hasTexcoord ? mesh.texcoords[uvBase] : 0.0f;
	target.v = hasTexcoord ? mesh.texcoords[uvBase + 1u] : 0.0f;
	target.r = hasColor ? mesh.colors[colorBase] * material.color[0] : material.color[0];
	target.g = hasColor ? mesh.colors[colorBase + 1u] * material.color[1] : material.color[1];
	target.b = hasColor ? mesh.colors[colorBase + 2u] * material.color[2] : material.color[2];
	target.a = hasColor ? mesh.colors[colorBase + 3u] * material.color[3] : material.color[3];
}

i32 meshSurfaceMode(ModelMaterialAlphaMode alphaMode) {
	switch (alphaMode) {
		case ModelMaterialAlphaMode::Opaque: return MESH_SURFACE_OPAQUE;
		case ModelMaterialAlphaMode::Mask: return MESH_SURFACE_MASK;
		case ModelMaterialAlphaMode::Blend: return MESH_SURFACE_BLEND;
	}
	return MESH_SURFACE_OPAQUE;
}

ResolvedMeshMaterial resolveMeshMaterial(const ModelAsset& model, const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	ResolvedMeshMaterial material;
	material.color = packetColorAsLinear(entry.color);
	u32 materialIndex = entry.materialIndex;
	if (materialIndex == VDP_MDU_MATERIAL_MESH_DEFAULT && mesh.materialIndex.has_value()) {
		materialIndex = static_cast<u32>(*mesh.materialIndex);
	}
	if (materialIndex < model.materials.size()) {
		const ModelMaterial& modelMaterial = model.materials[materialIndex];
		if (modelMaterial.baseColorFactor.has_value()) {
			const auto& factor = *modelMaterial.baseColorFactor;
			material.color[0] *= factor[0];
			material.color[1] *= factor[1];
			material.color[2] *= factor[2];
			material.color[3] *= factor[3];
		}
		material.draw.surface = meshSurfaceMode(modelMaterial.alphaMode);
		material.draw.alphaCutoff = modelMaterial.alphaCutoff;
		if (modelMaterial.metallicFactor.has_value()) {
			material.draw.metallicFactor = *modelMaterial.metallicFactor;
		}
		if (modelMaterial.roughnessFactor.has_value()) {
			material.draw.roughnessFactor = *modelMaterial.roughnessFactor;
		}
		if (modelMaterial.emissiveFactor.has_value()) {
			const auto& emissive = *modelMaterial.emissiveFactor;
			material.draw.emissiveFactor = {emissive[0], emissive[1], emissive[2]};
		}
		material.draw.doubleSided = modelMaterial.doubleSided;
		material.draw.unlit = modelMaterial.unlit;
	}
	return material;
}

} // namespace

MeshDrawStream MeshVertexStreamBuilder::build(const GameView& view,
											 const ModelAsset& model,
											 const ModelMesh& mesh,
											 const GameView::VdpMeshRenderEntry& entry) {
	decodeSignedQ16_16WordsInto(m_modelMatrix.data(), view.vdpXfMatrixWords.data() + static_cast<size_t>(entry.modelMatrixIndex * VDP_XF_MATRIX_WORDS), VDP_XF_MATRIX_WORDS);
	Render3D::mat4Normal3Into(m_normalMatrix, m_modelMatrix);
	const ResolvedMeshMaterial material = resolveMeshMaterial(model, mesh, entry);
	const size_t sourceVertexCount = mesh.indices.empty() ? mesh.positions.size() / 3u : mesh.indices.size();
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
	if (mesh.indices.empty()) {
		for (size_t index = 0u; index < outputVertexCount; ++index) {
			writeMeshVertex(m_vertices[index], m_jointMatrices, m_morphWeights, mesh, index, morphCount, skinningEnabled, entry.jointCount, material);
		}
	} else {
		for (size_t index = 0u; index < outputVertexCount; ++index) {
			writeMeshVertex(m_vertices[index], m_jointMatrices, m_morphWeights, mesh, mesh.indices[index], morphCount, skinningEnabled, entry.jointCount, material);
		}
	}
	return {m_vertices.data(), m_vertexCount, &m_modelMatrix, &m_normalMatrix, material.draw};
}

} // namespace bmsx
