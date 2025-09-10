import { $ } from '../../core/game';
import * as GLR from '../backend/webgl/gl_resources';

export class ShadowMap {
    public texture: WebGLTexture | null = null;
    public framebuffer: WebGLFramebuffer | null = null;
    constructor(size: number = 1024) {
        const gl = $.view.nativeCtx as WebGL2RenderingContext;
        const { texture, framebuffer } = GLR.glCreateShadowMapTextureAndFramebuffer(gl, {
            size: { x: size, y: size },
            wrapS: gl.CLAMP_TO_EDGE,
            wrapT: gl.CLAMP_TO_EDGE,
            minFilter: gl.NEAREST,
            magFilter: gl.NEAREST,
        });
        this.texture = texture;
        this.framebuffer = framebuffer;
    }

}
