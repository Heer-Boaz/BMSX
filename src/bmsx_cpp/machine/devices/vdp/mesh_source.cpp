#include "machine/devices/vdp/mesh_source.h"

#include <utility>

namespace bmsx {
namespace {

const std::vector<f32> EMPTY_F32_VECTOR;
const std::vector<u32> EMPTY_U32_VECTOR;
const std::vector<u16> EMPTY_U16_VECTOR;
const std::vector<std::vector<f32>> EMPTY_F32_VECTOR_LIST;

const VdpMeshSourceMaterial EMPTY_MATERIAL;
const VdpMeshSourceMesh EMPTY_MESH{
	&EMPTY_F32_VECTOR,
	&EMPTY_F32_VECTOR,
	&EMPTY_F32_VECTOR,
	&EMPTY_U32_VECTOR,
	false,
	VDP_MDU_MATERIAL_MESH_DEFAULT,
	&EMPTY_F32_VECTOR_LIST,
	&EMPTY_F32_VECTOR_LIST,
	&EMPTY_U16_VECTOR,
	&EMPTY_F32_VECTOR,
	&EMPTY_F32_VECTOR,
};
const VdpMeshSourceModel EMPTY_MODEL;

} // namespace

const VdpMeshSourceMesh& emptyVdpMeshSourceMesh() {
	return EMPTY_MESH;
}

const VdpMeshSourceMaterial& emptyVdpMeshSourceMaterial() {
	return EMPTY_MATERIAL;
}

const VdpMeshSourceModel& emptyVdpMeshSourceModel() {
	return EMPTY_MODEL;
}

void VdpMeshSourceBank::clear() {
	m_modelsBySourceAddr.clear();
}

void VdpMeshSourceBank::registerSource(u32 sourceAddr, VdpMeshSourceModel source) {
	m_modelsBySourceAddr[sourceAddr] = std::move(source);
}

const VdpMeshSourceModel& VdpMeshSourceBank::resolveSource(u32 sourceAddr) const {
	const auto it = m_modelsBySourceAddr.find(sourceAddr);
	if (it != m_modelsBySourceAddr.end()) {
		return it->second;
	}
	return EMPTY_MODEL;
}

} // namespace bmsx
