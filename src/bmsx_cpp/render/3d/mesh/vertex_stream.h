#pragma once

#include "common/types.h"
#include "machine/devices/vdp/contracts.h"
#include "render/3d/math.h"
#include "render/gameview.h"

#include <array>
#include <cstddef>

namespace bmsx {

struct ModelAsset;
struct ModelMesh;

constexpr i32 MESH_GLES2_SURFACE_OPAQUE = 0;
constexpr i32 MESH_GLES2_SURFACE_MASK = 1;
constexpr i32 MESH_GLES2_SURFACE_BLEND = 2;

struct MeshGLES2Vertex {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 nx = 0.0f;
	f32 ny = 0.0f;
	f32 nz = 1.0f;
	f32 u = 0.0f;
	f32 v = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct MeshGLES2DrawMaterial {
	i32 surface = 0;
	f32 alphaCutoff = 0.5f;
	f32 metallicFactor = 1.0f;
	f32 roughnessFactor = 1.0f;
	std::array<f32, 3> emissiveFactor{};
	bool doubleSided = false;
	bool unlit = false;
};

struct MeshGLES2DrawStream {
	const MeshGLES2Vertex* vertices = nullptr;
	size_t vertexCount = 0u;
	const Render3D::Mat4* modelMatrix = nullptr;
	const Render3D::Mat3* normalMatrix = nullptr;
	MeshGLES2DrawMaterial material;
};

class MeshVertexStreamBuilder {
public:
	MeshGLES2DrawStream build(const GameView& view,
								const ModelAsset& model,
								const ModelMesh& mesh,
								const GameView::VdpMeshRenderEntry& entry);

private:
	std::array<MeshGLES2Vertex, VDP_MDU_VERTEX_LIMIT> m_vertices{};
	std::array<Render3D::Mat4, VDP_JTU_MATRIX_COUNT> m_jointMatrices{};
	std::array<f32, VDP_MDU_MORPH_WEIGHT_LIMIT> m_morphWeights{};
	Render3D::Mat4 m_modelMatrix{};
	Render3D::Mat3 m_normalMatrix{};
	size_t m_vertexCount = 0u;

	void decodeMorphWeights(const GameView& view, const GameView::VdpMeshRenderEntry& entry, size_t morphCount);
	void decodeJointMatrices(const GameView& view, const GameView::VdpMeshRenderEntry& entry);
};

} // namespace bmsx
