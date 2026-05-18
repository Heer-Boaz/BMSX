#include "render/3d/mesh/rom_source.h"

#include "rompack/tokens.h"

namespace bmsx {
namespace {

AssetToken meshAssetToken(const GameView::VdpMeshRenderEntry& entry) {
	return makeAssetToken(entry.modelTokenLo, entry.modelTokenHi);
}

} // namespace

bool hasMeshRomDrawSources(const RuntimeRomPackage& rom, const GameView& view) {
	if (view.vdpMeshCount == 0u) {
		return false;
	}
	for (size_t index = 0u; index < view.vdpMeshCount; ++index) {
		const GameView::VdpMeshRenderEntry& entry = view.vdpMeshes[index];
		const auto it = rom.model.find(meshAssetToken(entry));
		if (it == rom.model.end() || entry.meshIndex >= it->second.meshes.size()) {
			return false;
		}
	}
	return true;
}

MeshRomDrawSource resolveMeshRomDrawSource(const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry) {
	const ModelAsset& model = rom.model.find(meshAssetToken(entry))->second;
	return {model, model.meshes[entry.meshIndex]};
}

} // namespace bmsx
