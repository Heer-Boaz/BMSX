#include "render/3d/mesh/rom_source.h"

#include "rompack/tokens.h"

namespace bmsx {
namespace {

AssetToken meshAssetToken(const GameView::VdpMeshRenderEntry& entry) {
	return makeAssetToken(entry.modelTokenLo, entry.modelTokenHi);
}

const ModelAsset& resolveMeshModel(const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry) {
	const auto it = rom.model.find(meshAssetToken(entry));
	if (it == rom.model.end()) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet references a model token that is not in the active ROM.");
	}
	return it->second;
}

const ModelMesh& resolveMeshPrimitive(const ModelAsset& model, const GameView::VdpMeshRenderEntry& entry) {
	if (entry.meshIndex >= model.meshes.size()) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet references a mesh index outside the model.");
	}
	return model.meshes[entry.meshIndex];
}

} // namespace

MeshRomDrawSource resolveMeshRomDrawSource(const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry) {
	const ModelAsset& model = resolveMeshModel(rom, entry);
	return {model, resolveMeshPrimitive(model, entry)};
}

} // namespace bmsx
