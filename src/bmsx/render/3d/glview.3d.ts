import type { Size, vec3, vec3arr } from '../../rompack/rompack';
import { GLView } from '../glview';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { catchWebGLError } from '../glview.helpers';
import { BaseView, Color } from '../view';
import { Camera3D } from './camera3d';
import type { DirectionalLight, PointLight } from './light';
import { Material } from './material';
import { bmat } from './math3d';
import gameShader3DCode from './shaders/gameshader3d.glsl';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';
import vertexShader3DCode from './shaders/vertexshader3d.glsl';
import { ShadowMap } from './shadowmap';

export class GLView3D {
    // 3D rendering fields
    private gameShaderProgram3D: WebGLProgram;
    private vertexLocation3D: number;
    private texcoordLocation3D: number;
    private color_overrideLocation3D: number;
    private atlas_idLocation3D: number;
    private normalLocation3D: number;
    private mvpLocation3D: WebGLUniformLocation;
    private modelLocation3D: WebGLUniformLocation;
    private normalMatrixLocation3D: WebGLUniformLocation;
    private ditherLocation3D: WebGLUniformLocation;
    private ambientColorLocation3D: WebGLUniformLocation;
    private ambientIntensityLocation3D: WebGLUniformLocation;
    private dirLightDirectionLocation3D: WebGLUniformLocation;
    private dirLightColorLocation3D: WebGLUniformLocation;
    private numDirLightsLocation3D: WebGLUniformLocation;
    private pointLightPositionLocation3D: WebGLUniformLocation;
    private pointLightColorLocation3D: WebGLUniformLocation;
    private pointLightRangeLocation3D: WebGLUniformLocation;
    private numPointLightsLocation3D: WebGLUniformLocation;
    private materialColorLocation3D: WebGLUniformLocation;
    private shadowMapLocation3D: WebGLUniformLocation;
    private lightMatrixLocation3D: WebGLUniformLocation;
    private shadowStrengthLocation3D: WebGLUniformLocation;
    private vertexBuffer3D: WebGLBuffer;
    private texcoordBuffer3D: WebGLBuffer;
    private color_overrideBuffer3D: WebGLBuffer;
    private atlas_idBuffer3D: WebGLBuffer;
    private normalBuffer3D: WebGLBuffer;
    public meshesToDraw: { positions: Float32Array; texcoords: Float32Array; normals?: Float32Array; matrix: Float32Array; color: Color; atlasId: number; material?: Material; shadow?: { map: ShadowMap; matrix: Float32Array; strength: number } }[] = [];
    public camera: Camera3D = new Camera3D();
    private directionalLights: Map<string, DirectionalLight> = new Map();
    private pointLights: Map<string, PointLight> = new Map();

    // Skybox fields
    private skyboxProgram: WebGLProgram;
    private skyboxPositionLocation: number;
    private skyboxViewLocation: WebGLUniformLocation;
    private skyboxProjectionLocation: WebGLUniformLocation;
    private skyboxTextureLocation: WebGLUniformLocation;
    public skyboxBuffer: WebGLBuffer;
    public skyboxTexture: WebGLTexture | null = null;

    public static readonly vertexShader3DCode: string = vertexShader3DCode;
    public static readonly fragmentShader3DCode: string = gameShader3DCode;
    public static readonly skyboxVertShaderCode: string = skyboxVertCode;
    public static readonly skyboxFragShaderCode: string = skyboxFragCode;

    /** Camera control helpers */
    public setCameraPosition(pos: vec3 | vec3arr): void {
        this.camera.setPosition(pos);
        this.camera.viewMatrix; // Trigger matrix recalculation
    }

    public pointCameraAt(target: vec3 | vec3arr): void {
        this.camera.lookAt(target);
        this.camera.viewMatrix; // Trigger matrix recalculation
    }

    public setCameraViewDepth(near: number, far: number): void {
        this.camera.setViewDepth(near, far);
    }

    public setCameraFov(fov: number): void {
        this.camera.fov = fov;
    }

    public usePerspectiveCamera(fov?: number): void {
        this.camera.usePerspective(fov);
    }

    public useOrthographicCamera(width: number, height: number): void {
        this.camera.useOrthographic(width, height);
    }

    public getCamera(): Camera3D {
        return this.camera;
    }

    /** Lighting helpers */
    public setAmbientLight(color: vec3arr, intensity: number): void {
        this.glctx.useProgram(this.gameShaderProgram3D);
        this.glctx.uniform3fv(this.ambientColorLocation3D, new Float32Array(color));
        this.glctx.uniform1f(this.ambientIntensityLocation3D, intensity);
    }

    public uploadDirectionalLights(): void {
        const gl = this.glctx;
        const lights = Array.from(this.directionalLights.values());
        const count = Math.min(lights.length, MAX_DIR_LIGHTS);
        const dirs = new Float32Array(MAX_DIR_LIGHTS * 3);
        const cols = new Float32Array(MAX_DIR_LIGHTS * 3);
        for (let i = 0; i < count; i++) {
            dirs.set(lights[i].direction, i * 3);
            cols.set(lights[i].color, i * 3);
        }
        gl.useProgram(this.gameShaderProgram3D);
        gl.uniform1i(this.numDirLightsLocation3D, count);
        gl.uniform3fv(this.dirLightDirectionLocation3D, dirs);
        gl.uniform3fv(this.dirLightColorLocation3D, cols);
    }

    public uploadPointLights(): void {
        const gl = this.glctx;
        const lights = Array.from(this.pointLights.values());
        const count = Math.min(lights.length, MAX_POINT_LIGHTS);
        const pos = new Float32Array(MAX_POINT_LIGHTS * 3);
        const col = new Float32Array(MAX_POINT_LIGHTS * 3);
        const range = new Float32Array(MAX_POINT_LIGHTS);
        for (let i = 0; i < count; i++) {
            pos.set(lights[i].position, i * 3);
            col.set(lights[i].color, i * 3);
            range[i] = lights[i].range;
        }
        gl.useProgram(this.gameShaderProgram3D);
        gl.uniform1i(this.numPointLightsLocation3D, count);
        gl.uniform3fv(this.pointLightPositionLocation3D, pos);
        gl.uniform3fv(this.pointLightColorLocation3D, col);
        gl.uniform1fv(this.pointLightRangeLocation3D, range);
    }

    public addDirectionalLight(id: string, direction: vec3arr, color: vec3arr): void {
        this.directionalLights.set(id, { id, type: 'directional', color, intensity: 1, direction });
        this.uploadDirectionalLights();
    }

    public removeDirectionalLight(id: string): void {
        if (this.directionalLights.delete(id)) this.uploadDirectionalLights();
    }

    public getDirectionalLight(id: string): DirectionalLight | undefined {
        return this.directionalLights.get(id);
    }

    public addPointLight(id: string, position: vec3arr, color: vec3arr, range: number): void {
        this.pointLights.set(id, { id, type: 'point', color, intensity: 1, position, range });
        this.uploadPointLights();
    }

    public removePointLight(id: string): void {
        if (this.pointLights.delete(id)) this.uploadPointLights();
    }

    public getPointLight(id: string): PointLight | undefined {
        return this.pointLights.get(id);
    }

    public clearLights(): void {
        this.directionalLights.clear();
        this.pointLights.clear();
        this.uploadDirectionalLights();
        this.uploadPointLights();
    }

    constructor(private glctx: WebGL2RenderingContext, private parentView: GLView, offscreenCanvasSize: Size) {
        this.camera.setAspect(offscreenCanvasSize.x / offscreenCanvasSize.y);

    }

    /**
     * Sets the default uniform values for the game and CRT shaders.
     * These values include the scale, resolution vector, and texture location for the game shader,
     * and the scale, resolution vector, and noise, color bleed, blur, glow, and fringing flags for the CRT shader.
     * @private
     * @returns void
     */
    public setDefaultUniformValues(): void {
        const gl = this.glctx;
        gl.useProgram(this.gameShaderProgram3D);
        gl.uniform1f(this.ditherLocation3D, 0.3);
        gl.uniform3fv(this.ambientColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
        gl.uniform1f(this.ambientIntensityLocation3D, 0.2);
        this.addDirectionalLight('default_dir', [0.0, -1.0, 0.0], [1.0, 1.0, 1.0]);
        this.addPointLight('default_point', [0.0, 5.0, 5.0], [1.0, 1.0, 1.0], 10.0);
    }

    @catchWebGLError
    public setupBuffers3D(): void {
        this.vertexBuffer3D = this.parentView.createBuffer();
        this.texcoordBuffer3D = this.parentView.createBuffer();
        this.normalBuffer3D = this.parentView.createBuffer();
        this.color_overrideBuffer3D = this.parentView.createBuffer();
        this.atlas_idBuffer3D = this.parentView.createBuffer();
    }

    @catchWebGLError
    public createSkyboxBuffer(): void {
        const gl = this.glctx;
        const positions = new Float32Array([
            -1, -1, 1, 1, -1, 1, -1, 1, 1,
            -1, 1, 1, 1, -1, 1, 1, 1, 1,
            1, -1, -1, -1, -1, -1, 1, 1, -1,
            -1, -1, -1, -1, 1, -1, 1, 1, -1,
            -1, -1, -1, -1, -1, 1, -1, 1, -1,
            -1, -1, 1, -1, 1, 1, -1, 1, -1,
            1, -1, 1, 1, -1, -1, 1, 1, 1,
            1, -1, -1, 1, 1, -1, 1, 1, 1,
            -1, 1, 1, 1, 1, 1, -1, 1, -1,
            -1, 1, -1, 1, 1, 1, 1, 1, -1,
            -1, -1, -1, 1, -1, -1, -1, -1, 1,
            -1, -1, 1, 1, -1, -1, 1, -1, 1,
        ]);
        this.skyboxBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.skyboxBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    }

    public drawSkybox(): void {
        const gl = this.glctx;
        this.parentView.switchProgram(this.skyboxProgram);
        gl.depthFunc(gl.LEQUAL);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.skyboxBuffer);
        gl.vertexAttribPointer(this.skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.skyboxPositionLocation);

        const view = this.camera.viewMatrix.slice() as Float32Array;
        view[12] = 0; view[13] = 0; view[14] = 0;
        gl.uniformMatrix4fv(this.skyboxViewLocation, false, view);
        gl.uniformMatrix4fv(this.skyboxProjectionLocation, false, this.camera.projectionMatrix);

        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.skyboxTexture);
        gl.uniform1i(this.skyboxTextureLocation, 9);

        gl.drawArrays(gl.TRIANGLES, 0, 36);
        gl.depthFunc(gl.GREATER);
    }

    public setupGameShader3DLocations(): void {
        this.parentView.switchProgram(this.gameShaderProgram3D);
        this.parentView.setupAttributeFloat(this.vertexBuffer3D, this.vertexLocation3D, 3);
        this.parentView.setupAttributeFloat(this.texcoordBuffer3D, this.texcoordLocation3D, 2);
        this.parentView.setupAttributeFloat(this.normalBuffer3D, this.normalLocation3D, 3);
        this.parentView.setupAttributeFloat(this.color_overrideBuffer3D, this.color_overrideLocation3D, 4);
        this.parentView.setupAttributeInt(this.atlas_idBuffer3D, this.atlas_idLocation3D, 1);
    }

    public setSkyboxImages(ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
        const gl = this.glctx;
        if (!this.skyboxTexture) {
            this.skyboxTexture = gl.createTexture()!;
        }
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.skyboxTexture);
        function generateAtlasName(atlasIndex: number): string {
            const idxStr = atlasIndex.toString().padStart(2, '0');
            return atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
        }
        const targets = [
            [gl.TEXTURE_CUBE_MAP_POSITIVE_X, ids.posX],
            [gl.TEXTURE_CUBE_MAP_NEGATIVE_X, ids.negX],
            [gl.TEXTURE_CUBE_MAP_POSITIVE_Y, ids.posY],
            [gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, ids.negY],
            [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, ids.posZ],
            [gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, ids.negZ],
        ] as const;
        let width = 0, height = 0;
        const sources: CanvasImageSource[] = [];

        for (const [, id] of targets) {
            const asset = BaseView.imgassets[id];
            if (!asset) throw Error(`Skybox image '${id}' not found`);
            let source: CanvasImageSource;
            if (asset.imgbin) {
                source = asset.imgbin;
            } else if (asset.imgmeta?.atlassed) {
                const idx = asset.imgmeta.atlasid ?? 0;
                const atlasName = generateAtlasName(idx);
                const atlas = BaseView.imgassets[atlasName]?.imgbin;
                if (!atlas) throw Error(`Atlas image '${atlasName}' not found`);
                const [left, top, right, , , bottom] = asset.imgmeta.texcoords!;
                const aw = atlas.width, ah = atlas.height;
                const sx = left * aw;
                const sy = top * ah;
                const sw = (right - left) * aw;
                const sh = (bottom - top) * ah;
                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
                source = canvas;
            } else {
                throw Error(`Skybox image '${id}' not found`);
            }
            if (width === 0) {
                const s = source as HTMLImageElement | HTMLCanvasElement;
                width = s.width;
                height = s.height;
            }
            sources.push(source);
        }

        for (const [target] of targets) {
            gl.texImage2D(target, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        for (let i = 0; i < targets.length; i++) {
            const [target] = targets[i];
            const source = sources[i] as TexImageSource;
            gl.texSubImage2D(target, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }


    @catchWebGLError
    public createGameShaderPrograms3D(): void {
        const gl = this.glctx;
        const program = gl.createProgram();
        if (!program) throw Error('Failed to create 3D GLSL program');
        this.gameShaderProgram3D = program;
        const vertShader = this.parentView.loadShader(gl.VERTEX_SHADER, GLView3D.vertexShader3DCode);
        const fragShader = this.parentView.loadShader(gl.FRAGMENT_SHADER, GLView3D.fragmentShader3DCode);
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw Error(`Unable to initialize the 3D shader program: ${gl.getProgramInfoLog(program)} `);
        }
    }

    @catchWebGLError
    public createSkyboxProgram(): void {
        const gl = this.glctx;
        const program = gl.createProgram();
        if (!program) throw Error('Failed to create skybox GLSL program');
        this.skyboxProgram = program;
        const vertShader = this.parentView.loadShader(gl.VERTEX_SHADER, GLView3D.skyboxVertShaderCode);
        const fragShader = this.parentView.loadShader(gl.FRAGMENT_SHADER, GLView3D.skyboxFragShaderCode);
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw Error(`Unable to initialize the skybox shader program: ${gl.getProgramInfoLog(program)} `);
        }
    }

    @catchWebGLError
    public setupVertexShaderLocations3D(): void {
        const gl = this.glctx;
        this.vertexLocation3D = gl.getAttribLocation(this.gameShaderProgram3D, 'a_position');
        this.texcoordLocation3D = gl.getAttribLocation(this.gameShaderProgram3D, 'a_texcoord');
        this.normalLocation3D = gl.getAttribLocation(this.gameShaderProgram3D, 'a_normal');
        this.color_overrideLocation3D = gl.getAttribLocation(this.gameShaderProgram3D, 'a_color_override');
        this.atlas_idLocation3D = gl.getAttribLocation(this.gameShaderProgram3D, 'a_atlas_id');
        this.mvpLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_mvp')!;
        this.modelLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_model')!;
        this.normalMatrixLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_normalMatrix')!;
        this.ditherLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_ditherIntensity')!;
        // lighting uniforms
        this.ambientColorLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_ambientColor')!;
        this.ambientIntensityLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_ambientIntensity')!;
        this.dirLightDirectionLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_dirLightDirection[0]')!;
        this.dirLightColorLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_dirLightColor[0]')!;
        this.numDirLightsLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_numDirLights')!;
        this.pointLightPositionLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_pointLightPosition[0]')!;
        this.pointLightColorLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_pointLightColor[0]')!;
        this.pointLightRangeLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_pointLightRange[0]')!;
        this.numPointLightsLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_numPointLights')!;
        this.materialColorLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_materialColor')!;
        this.shadowMapLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_shadowMap')!;
        this.lightMatrixLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_lightMatrix')!;
        this.shadowStrengthLocation3D = gl.getUniformLocation(this.gameShaderProgram3D, 'u_shadowStrength')!;
    }

    @catchWebGLError
    public setupSkyboxLocations(): void {
        const gl = this.glctx;
        this.skyboxPositionLocation = gl.getAttribLocation(this.skyboxProgram, 'a_position');
        this.skyboxViewLocation = gl.getUniformLocation(this.skyboxProgram, 'u_view')!;
        this.skyboxProjectionLocation = gl.getUniformLocation(this.skyboxProgram, 'u_projection')!;
        this.skyboxTextureLocation = gl.getUniformLocation(this.skyboxProgram, 'u_skybox')!;
    }

    @catchWebGLError
    public renderMeshBatch(): void {
        if (this.meshesToDraw.length === 0) return;
        const gl = this.glctx;
        this.parentView.switchProgram(this.gameShaderProgram3D);

        this.uploadDirectionalLights();
        this.uploadPointLights();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.parentView.framebuffer);
        gl.viewport(0, 0, this.parentView.offscreenCanvasSize.x, this.parentView.offscreenCanvasSize.y);

        if (this.skyboxTexture) {
            this.drawSkybox();
            this.parentView.switchProgram(this.gameShaderProgram3D);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer3D);
        gl.vertexAttribPointer(this.vertexLocation3D, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.vertexLocation3D);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer3D);
        gl.vertexAttribPointer(this.texcoordLocation3D, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.texcoordLocation3D);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer3D);
        gl.vertexAttribPointer(this.color_overrideLocation3D, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.color_overrideLocation3D);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer3D);
        gl.vertexAttribPointer(this.normalLocation3D, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.normalLocation3D);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.atlas_idBuffer3D);
        gl.vertexAttribIPointer(this.atlas_idLocation3D, 1, gl.UNSIGNED_BYTE, 0, 0);
        gl.enableVertexAttribArray(this.atlas_idLocation3D);

        for (const mesh of this.meshesToDraw) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, mesh.texcoords, gl.DYNAMIC_DRAW);
            if (mesh.normals) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer3D);
                gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
            }

            const vertexCount = mesh.positions.length / 3;

            const colorData = new Float32Array(vertexCount * 4);
            for (let i = 0; i < vertexCount; i++) {
                colorData.set([mesh.color.r, mesh.color.g, mesh.color.b, mesh.color.a], i * 4);
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

            const atlasData = new Uint8Array(vertexCount);
            atlasData.fill(mesh.atlasId);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.atlas_idBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, atlasData, gl.DYNAMIC_DRAW);


            const matColor = mesh.material?.color ?? [1, 1, 1];
            gl.uniform3fv(this.materialColorLocation3D, new Float32Array(matColor));

            if (mesh.shadow) {
                gl.activeTexture(gl.TEXTURE8);
                gl.bindTexture(gl.TEXTURE_2D, mesh.shadow.map.texture);
                gl.uniform1i(this.shadowMapLocation3D, 8);
                gl.uniformMatrix4fv(this.lightMatrixLocation3D, false, mesh.shadow.matrix);
                gl.uniform1f(this.shadowStrengthLocation3D, mesh.shadow.strength);
            } else {
                gl.uniform1f(this.shadowStrengthLocation3D, 1.0);
            }

            const mvp = bmat.multiply(this.camera.viewProjectionMatrix, mesh.matrix);
            gl.uniformMatrix4fv(this.mvpLocation3D, false, mvp);
            gl.uniformMatrix4fv(this.modelLocation3D, false, mesh.matrix);
            const normalMat = bmat.normalMatrix(mesh.matrix);
            gl.uniformMatrix3fv(this.normalMatrixLocation3D, false, normalMat);

            gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
        }

        this.meshesToDraw = [];
    }

}