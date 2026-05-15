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

struct MeshGLES2Vertex {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 u = 0.0f;
	f32 v = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct MeshGLES2DrawStream {
	const MeshGLES2Vertex* vertices = nullptr;
	size_t vertexCount = 0u;
	const Render3D::Mat4* modelMatrix = nullptr;
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
	size_t m_vertexCount = 0u;

	void decodeMorphWeights(const GameView& view, const GameView::VdpMeshRenderEntry& entry, size_t morphCount);
	void decodeJointMatrices(const GameView& view, const GameView::VdpMeshRenderEntry& entry);
};

} // namespace bmsx
