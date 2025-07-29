import type { GLTFModel } from '../rompack/rompack';

export async function addModelToScene(model: GLTFModel): Promise<void> {
    const textureManager = $.texmanager;
    if (!textureManager || (!model.imageURIs && !model.imageBuffers)) return;
    model.runtimeImages = [];
    const count = model.imageBuffers ? model.imageBuffers.length : (model.imageURIs?.length ?? 0);
    for (let i = 0; i < count; i++) {
        const uri = model.imageURIs ? model.imageURIs[i] : `buf_${i}`;
        const buf = model.imageBuffers ? model.imageBuffers[i] : undefined;
        if (!uri && !buf) { model.runtimeImages.push(undefined); continue; }
        const img = await textureManager.loadImage(uri ?? '', buf);
        model.runtimeImages.push(img);
    }
}

export async function removeModelFromScene(model: GLTFModel): Promise<void> {
    const textureManager = $.texmanager;
    if (!textureManager || !model.runtimeImages) return;
    if (model.imageURIs) {
        for (const uri of model.imageURIs) {
            if (uri) await textureManager.releaseImage(uri);
        }
    }
    model.runtimeImages = [];
}
