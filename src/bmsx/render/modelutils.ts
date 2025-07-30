import type { GLTFModel, Index2GpuTexture } from '../rompack/rompack';

export async function addModelToScene(meshModel: GLTFModel): Promise<Index2GpuTexture> {
    const textureManager = $.texmanager;
    if (!textureManager || (!meshModel.imageURIs && !meshModel.imageBuffers)) return {};
    const count = meshModel.imageBuffers ? meshModel.imageBuffers.length : (meshModel.imageURIs?.length ?? 0);
    const gpuTextures: Index2GpuTexture = {};
    for (let i = 0; i < count; i++) {
        // const uri = model.imageURIs ? model.imageURIs[i] : `buf_${i}`;
        const buf = meshModel.imageBuffers ? meshModel.imageBuffers[i] : undefined;
        // if (!uri && !buf) { model.runtimeImages.push(undefined as unknown as TextureKey); continue; }
        const key = await textureManager.acquireFromBuffer(buf, { modelName: meshModel.name, modelImageIndex: i });
        gpuTextures[i] = key;
        // const key = await textureManager.acquireFromUri(uri ?? '', {}, buf);
        // model.runtimeImages.push(key);
    }
    return gpuTextures;
}

export async function removeModelFromScene(model: GLTFModel): Promise<void> {
    const textureManager = $.texmanager;
    // if (!textureManager || !model.runtimeImages) return;
    if (model.imageURIs) {
        for (const uri of model.imageURIs) {
            if (uri) textureManager.releaseByUri(uri, {});
        }
    }
    // model.runtimeImages = [];
}
