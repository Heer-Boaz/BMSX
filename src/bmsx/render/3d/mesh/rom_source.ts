import type { Runtime } from '../../../machine/runtime/runtime';
import type { GLTFMesh, GLTFModel } from '../../../rompack/format';
import type { GameView } from '../../gameview';

export interface MeshRomDrawSource {
	model: GLTFModel;
	mesh: GLTFMesh;
}

const meshRomDrawSource: MeshRomDrawSource = {
	model: null as unknown as GLTFModel,
	mesh: null as unknown as GLTFMesh,
};

export function resolveMeshRomDrawSource(runtime: Runtime, view: GameView, entryIndex: number): MeshRomDrawSource {
	const tokenHiModels = runtime.activePackage.modelByToken.get(view.vdpMeshModelTokenHi[entryIndex]);
	if (!tokenHiModels) {
		throw new Error('[MeshPipeline] VDP mesh packet references a model token that is not in the active ROM.');
	}
	const model = tokenHiModels.get(view.vdpMeshModelTokenLo[entryIndex]);
	if (!model) {
		throw new Error('[MeshPipeline] VDP mesh packet references a model token that is not in the active ROM.');
	}
	const meshIndex = view.vdpMeshIndex[entryIndex];
	const mesh = model.meshes[meshIndex];
	if (!mesh) {
		throw new Error('[MeshPipeline] VDP mesh packet references a mesh index outside the model.');
	}
	meshRomDrawSource.model = model;
	meshRomDrawSource.mesh = mesh;
	return meshRomDrawSource;
}
