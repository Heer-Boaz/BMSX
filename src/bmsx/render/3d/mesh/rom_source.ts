import type { Runtime } from '../../../machine/runtime/runtime';
import type { GLTFMesh, GLTFModel } from '../../../rompack/format';
import type { GameView } from '../../gameview';

export interface MeshRomDrawSource {
	model: GLTFModel;
	mesh: GLTFMesh;
}

const meshRomDrawSource: MeshRomDrawSource = {
	model: null,
	mesh: null,
};

export function hasMeshRomDrawSources(runtime: Runtime, view: GameView): boolean {
	const meshCount = view.vdpMeshCount;
	if (meshCount === 0) {
		return false;
	}
	for (let entryIndex = 0; entryIndex < meshCount; entryIndex += 1) {
		const tokenHiModels = runtime.activePackage.modelByToken.get(view.vdpMeshModelTokenHi[entryIndex]);
		if (!tokenHiModels) {
			return false;
		}
		const model = tokenHiModels.get(view.vdpMeshModelTokenLo[entryIndex]);
		if (!model || !model.meshes[view.vdpMeshIndex[entryIndex]]) {
			return false;
		}
	}
	return true;
}

export function resolveMeshRomDrawSource(runtime: Runtime, view: GameView, entryIndex: number): MeshRomDrawSource {
	const tokenHiModels = runtime.activePackage.modelByToken.get(view.vdpMeshModelTokenHi[entryIndex]);
	const model = tokenHiModels.get(view.vdpMeshModelTokenLo[entryIndex]);
	const meshIndex = view.vdpMeshIndex[entryIndex];
	const mesh = model.meshes[meshIndex];
	meshRomDrawSource.model = model;
	meshRomDrawSource.mesh = mesh;
	return meshRomDrawSource;
}
