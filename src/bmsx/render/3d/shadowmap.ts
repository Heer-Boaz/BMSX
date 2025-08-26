import { $ } from '../../core/game';
import * as GLR from '../backend/gl_resources';
import { GLView } from '../view/render_view';

export class ShadowMap {
    public texture: WebGLTexture | null = null;
    public framebuffer: WebGLFramebuffer | null = null;
    constructor(size: number = 1024) {
        const gl = $.viewAs<GLView>().glctx;
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
