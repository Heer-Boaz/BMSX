/// <reference types="@webgpu/types" />
import { BackendCaps, GPUBackend, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, TextureHandle, TextureParams } from './pipeline_interfaces';
// Assuming TextureHandle is GPUTexture for WebGPU

export class WebGPUBackend implements GPUBackend {
    private stateRegistry: Map<RenderPassStateId, any> = new Map();
    private limits: GPUSupportedLimits;
    private pipelineIdCounter: number = 0;
    private pipelines: Map<number, GPURenderPipeline> = new Map();

    constructor(public device: GPUDevice, public context?: GPUCanvasContext) {
        this.limits = this.device.limits;
    }

    createTextureFromImage(img: ImageBitmap, desc: TextureParams): TextureHandle {
        // Use defaults since properties not in TextureParams
        const texture = this.device.createTexture({
            size: { width: img.width, height: img.height, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: 1,
            dimension: '2d',
        });

        this.device.queue.copyExternalImageToTexture(
            { source: img, flipY: false },
            { texture },
            { width: img.width, height: img.height }
        );

        return texture;
    }

    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): TextureHandle {
        if (faces.length !== 6 || !faces.every(f => f.width === faces[0].width && f.height === faces[0].height)) {
            throw new Error('All cubemap faces must be the same square size');
        }

        const size = faces[0].width;
        const texture = this.device.createTexture({
            size: { width: size, height: size, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: 1,
            dimension: '2d',
        });

        faces.forEach((img, faceIndex) => {
            this.device.queue.copyExternalImageToTexture(
                { source: img, flipY: false },
                { texture, origin: { x: 0, y: 0, z: faceIndex } },
                { width: size, height: size }
            );
        });

        return texture;
    }

    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): TextureHandle {
        const texture = this.device.createTexture({
            size: { width: size, height: size, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: 1,
            dimension: '2d',
        });

        // Create a buffer with the color repeated for each pixel per face
        const pixelCountPerFace = size * size;
        const data = new Uint8Array(pixelCountPerFace * 4 * 6);
        for (let face = 0; face < 6; face++) {
            for (let i = 0; i < pixelCountPerFace; i++) {
                const offset = (face * pixelCountPerFace + i) * 4;
                data[offset] = Math.round(rgba[0] * 255);
                data[offset + 1] = Math.round(rgba[1] * 255);
                data[offset + 2] = Math.round(rgba[2] * 255);
                data[offset + 3] = Math.round(rgba[3] * 255);
            }
        }

        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Uint8Array(buffer.getMappedRange()).set(data);
        buffer.unmap();

        // Copy buffer to texture, layer by layer
        const commandEncoder = this.device.createCommandEncoder();
        for (let layer = 0; layer < 6; layer++) {
            commandEncoder.copyBufferToTexture(
                { buffer, offset: layer * pixelCountPerFace * 4, bytesPerRow: size * 4 },
                { texture, origin: { x: 0, y: 0, z: layer } },
                { width: size, height: size, depthOrArrayLayers: 1 }
            );
        }
        this.device.queue.submit([commandEncoder.finish()]);

        buffer.destroy();
        return texture;
    }

    createCubemapEmpty(size: number, desc: TextureParams): TextureHandle {
        return this.device.createTexture({
            size: { width: size, height: size, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: 1,
            dimension: '2d',
        });
    }

    uploadCubemapFace(cubemap: TextureHandle, face: number, img: ImageBitmap): void {
        if (face < 0 || face > 5) throw new Error('Invalid cubemap face index');
        this.device.queue.copyExternalImageToTexture(
            { source: img },
            { texture: cubemap as GPUTexture, origin: { x: 0, y: 0, z: face } },
            { width: img.width, height: img.height }
        );
    }

    destroyTexture(handle: TextureHandle): void {
        (handle as GPUTexture).destroy();
    }

    createColorTexture(desc: { width: number; height: number; format?: number }): TextureHandle {
        let format: GPUTextureFormat = 'bgra8unorm';
        if (desc.format) {
            // Map WebGL format numbers to WebGPU formats
            switch (desc.format) {
                case 6408: // WebGL2RenderingContext.RGBA
                    format = 'rgba8unorm';
                    break;
                // Add more mappings as needed based on your usage
                default:
                    format = 'bgra8unorm';
                    break;
            }
        }
        return this.device.createTexture({
            size: { width: desc.width, height: desc.height },
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        });
    }

    createDepthTexture(desc: { width: number; height: number }): TextureHandle {
        return this.device.createTexture({
            size: { width: desc.width, height: desc.height },
            format: 'depth24plus-stencil8', // Or 'depth32float' if no stencil needed
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    createFBO(color?: TextureHandle | null, depth?: TextureHandle | null): unknown {
        // In WebGPU, no explicit FBO; return a descriptor-like object for compatibility
        return { color, depth };
    }

    bindFBO(fbo: unknown): void {
        // No-op in WebGPU; binding is handled in render passes
    }

    clear(opts: { color?: [number, number, number, number]; depth?: number }): void {
        // To clear outside a pass, create a temporary render pass for clearing
        const commandEncoder = this.device.createCommandEncoder();
        let colorAttachments: GPURenderPassColorAttachment[] = [];

        if (this.context && opts.color) {
            const view = this.context.getCurrentTexture().createView();
            colorAttachments = [{
                view,
                clearValue: opts.color,
                loadOp: 'clear',
                storeOp: 'store',
            }];
        }

        const passDesc: GPURenderPassDescriptor = {
            colorAttachments,
            // depthStencilAttachment if needed, but skipped if no tex
        };

        const passEncoder = commandEncoder.beginRenderPass(passDesc);
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }

    beginRenderPass(desc: RenderPassDesc): PassEncoder {
        const commandEncoder = this.device.createCommandEncoder();

        const colorAttachments: GPURenderPassColorAttachment[] = [];
        const colors = desc.colors || (desc.color ? [desc.color] : []);
        colors.forEach(c => {
            colorAttachments.push({
                view: (c.tex as GPUTexture).createView(),
                clearValue: c.clear || [0, 0, 0, 0],
                loadOp: c.clear ? 'clear' : 'load',
                storeOp: c.discardAfter ? 'discard' : 'store',
            });
        });

        let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
        if (desc.depth) {
            depthStencilAttachment = {
                view: (desc.depth.tex as GPUTexture).createView(),
                depthClearValue: desc.depth.clearDepth ?? 1.0,
                depthLoadOp: desc.depth.clearDepth !== undefined ? 'clear' : 'load',
                depthStoreOp: desc.depth.discardAfter ? 'discard' : 'store',
                stencilClearValue: 0,
                stencilLoadOp: 'load',
                stencilStoreOp: 'store',
            };
        }

        const passDesc: GPURenderPassDescriptor = {
            colorAttachments,
            depthStencilAttachment,
            label: desc.label,
        };

        const encoder = commandEncoder.beginRenderPass(passDesc);
        return { fbo: commandEncoder, desc, encoder } as PassEncoder & { encoder: GPURenderPassEncoder };
    }

    endRenderPass(pass: PassEncoder & { encoder: GPURenderPassEncoder }): void {
        pass.encoder.end();
        this.device.queue.submit([(pass.fbo as GPUCommandEncoder).finish()]);
    }

    getCaps(): BackendCaps {
        return { maxColorAttachments: this.limits.maxColorAttachments };
    }

    transitionTexture(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void {
        // WebGPU handles resource states automatically; manual transitions not required.
    }

    createRenderPassInstance(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle {
        const bindGroupLayouts: GPUBindGroupLayout[] = [];
        if (desc.bindingLayout) {
            const entries: GPUBindGroupLayoutEntry[] = [];
            let binding = 0;

            desc.bindingLayout.uniforms?.forEach(() => {
                entries.push({ binding: binding++, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
            });
            desc.bindingLayout.textures?.forEach(t => {
                entries.push({ binding: binding++, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            });
            desc.bindingLayout.samplers?.forEach(s => {
                entries.push({ binding: binding++, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
            });
            desc.bindingLayout.buffers?.forEach(b => {
                entries.push({ binding: binding++, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: b.usage === 'storage' ? 'storage' : 'uniform' } });
            });

            bindGroupLayouts.push(this.device.createBindGroupLayout({ entries }));
        }

        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts });

        const pipeline = this.device.createRenderPipeline({
            label: desc.label,
            layout: pipelineLayout,
            vertex: {
                module: this.device.createShaderModule({ code: desc.vsCode ?? '' }),
                entryPoint: 'main',
                // Add buffers if needed
            },
            fragment: {
                module: this.device.createShaderModule({ code: desc.fsCode ?? '' }),
                entryPoint: 'main',
                targets: [{ format: 'bgra8unorm' }],
            },
            primitive: { topology: 'triangle-list' }, // Customize as needed
        });

        const id = this.pipelineIdCounter++;
        this.pipelines.set(id, pipeline);
        return { id, label: desc.label };
    }

    destroyRenderPassInstance(p: RenderPassInstanceHandle): void {
        this.pipelines.delete(p.id);
    }

    setGraphicsPipeline(pass: PassEncoder & { encoder: GPURenderPassEncoder }, pipelineHandle: RenderPassInstanceHandle): void {
        const pipeline = this.pipelines.get(pipelineHandle.id);
        if (pipeline) {
            pass.encoder.setPipeline(pipeline);
        }
    }

    draw(pass: PassEncoder & { encoder: GPURenderPassEncoder }, first: number, count: number): void {
        pass.encoder.draw(count, 1, first, 0);
    }

    drawIndexed(pass: PassEncoder & { encoder: GPURenderPassEncoder }, indexCount: number, firstIndex?: number): void {
        pass.encoder.drawIndexed(indexCount, 1, firstIndex ?? 0, 0, 0);
    }

    setPassState<S = unknown>(label: RenderPassStateId, state: S): void {
        this.stateRegistry.set(label, state);
    }

    executePass(label: RenderPassStateId, fbo: unknown): void {
        const state = this.getPassState(label);
        if (!state) return;
        // Implement specific execution logic here if needed
    }

    getPassState<S = unknown>(label: RenderPassStateId): S | undefined {
        return this.stateRegistry.get(label);
    }

    // Optional buffer/VAO helpers: not applicable to WebGPU yet (vertex buffers managed per pipeline)
    createVertexBuffer?(data: ArrayBufferView, usage: 'static' | 'dynamic'): never;
    updateVertexBuffer?(buf: unknown, data: ArrayBufferView, dstOffset?: number): never;
    bindArrayBuffer?(buf: unknown | null): void; // no-op
    createVertexArray?(): unknown; // no-op
    bindVertexArray?(vao: unknown | null): void; // no-op
}
