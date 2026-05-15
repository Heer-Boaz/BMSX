#pragma once

#include "render/gameview.h"
#include "rompack/assets.h"
#include "rompack/loader.h"

namespace bmsx {

struct MeshRomDrawSource {
	const ModelAsset& model;
	const ModelMesh& mesh;
};

MeshRomDrawSource resolveMeshRomDrawSource(const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry);

} // namespace bmsx
