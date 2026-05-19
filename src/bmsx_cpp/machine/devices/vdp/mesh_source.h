#pragma once

#include "common/types.h"
#include "machine/devices/vdp/contracts.h"

#include <array>
#include <unordered_map>
#include <vector>

namespace bmsx {

enum class VdpMeshAlphaMode : u8 {
	Opaque = 0u,
	Mask = 1u,
	Blend = 2u,
};

struct VdpMeshSourceMaterial {
	std::array<f32, 4> baseColorFactor{1.0f, 1.0f, 1.0f, 1.0f};
	f32 metallicFactor = 1.0f;
	f32 roughnessFactor = 1.0f;
	std::array<f32, 3> emissiveFactor{};
	VdpMeshAlphaMode alphaMode = VdpMeshAlphaMode::Opaque;
	f32 alphaCutoff = 0.5f;
	bool doubleSided = false;
	bool unlit = false;
};

struct VdpMeshSourceMesh {
	const std::vector<f32>* positions = nullptr;
	const std::vector<f32>* texcoords = nullptr;
	const std::vector<f32>* normals = nullptr;
	const std::vector<u32>* indices = nullptr;
	bool hasIndices = false;
	u32 materialIndex = VDP_MDU_MATERIAL_MESH_DEFAULT;
	const std::vector<std::vector<f32>>* morphPositions = nullptr;
	const std::vector<std::vector<f32>>* morphNormals = nullptr;
	const std::vector<u16>* jointIndices = nullptr;
	const std::vector<f32>* jointWeights = nullptr;
	const std::vector<f32>* colors = nullptr;
};

struct VdpMeshSourceModel {
	std::vector<VdpMeshSourceMesh> meshes;
	std::vector<VdpMeshSourceMaterial> materials;
};

const VdpMeshSourceMesh& emptyVdpMeshSourceMesh();
const VdpMeshSourceMaterial& emptyVdpMeshSourceMaterial();
const VdpMeshSourceModel& emptyVdpMeshSourceModel();

class VdpMeshSourceBank {
public:
	void clear();
	void registerSource(u32 sourceAddr, VdpMeshSourceModel source);
	const VdpMeshSourceModel& resolveSource(u32 sourceAddr) const;

private:
	std::unordered_map<u32, VdpMeshSourceModel> m_modelsBySourceAddr;
};

} // namespace bmsx
