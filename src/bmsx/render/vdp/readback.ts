import { $ } from '../../core/engine';

export function readVdpTextureRegion(textureKey: string, x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return $.view.backend.readTextureRegion($.texmanager.getTextureByUri(textureKey), x, y, width, height, out);
}

export function vdpTextureReadbackUsesCpuCopy(): boolean {
	return $.view.backend.type === 'webgpu';
}
