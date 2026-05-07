import { consoleCore } from '../../core/console';
import * as GLR from '../backend/webgl/gl_resources';

export class ShadowMap {
	public texture: WebGLTexture = null;
	public framebuffer: WebGLFramebuffer = null;
	constructor(size: number = 1024) {
		const gl = consoleCore.view.nativeCtx as WebGL2RenderingContext;
		const { texture, framebuffer } = GLR.glCreateShadowMapTextureAndFramebuffer(gl, {
			size: { x: size, y: size },
			wrapS: gl.CLAMP_TO_EDGE,
			wrapT: gl.CLAMP_TO_EDGE,
			minFilter: gl.NEAREST,
			magFilter: gl.NEAREST,
			srgb: true,
		});
		this.texture = texture;
		this.framebuffer = framebuffer;
	}

}
