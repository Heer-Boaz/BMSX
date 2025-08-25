import { $ } from '../../core/game';
import { WebGLBackend } from '../backend/webgl_backend';
import { GLView } from '../view/render_view';

export class ShadowMap {
    public texture: WebGLTexture | null = null;
    public framebuffer: WebGLFramebuffer | null = null;
    constructor(size: number = 1024) {
        const gl = $.viewAs<GLView>().glctx;
        const { texture, framebuffer } = WebGLBackend.glCreateShadowMapTextureAndFramebuffer(gl, {
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
