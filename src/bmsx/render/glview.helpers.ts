import { GLView } from './glview';

const CATCH_WEBGL_ERROR = true;

export function generateAtlasName(atlasIndex: number): string {
    const idxStr = atlasIndex.toString().padStart(2, '0');
    return atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
}


export function saveTextureToFile(): void {
    const view = $.viewAs<GLView>();
    const gl = view.glctx;

    // 1. Bind the framebuffer that has the texture attached
    gl.bindFramebuffer(gl.FRAMEBUFFER, view.framebuffer);

    // 2. Read the pixels from the framebuffer into an array
    const width = view.canvas.width;  // replace with the width of your texture
    const height = view.canvas.height;  // replace with the height of your texture
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // 3. Create a new canvas and context
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    // 4. Put the pixel data into an ImageData object
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

    // Draw the image data to the canvas
    context.putImageData(imageData, 0, 0);

    // 5. Flip the canvas vertically
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempContext = tempCanvas.getContext('2d');
    tempContext.putImageData(context.getImageData(0, 0, width, height), 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(1, -1);
    context.drawImage(tempCanvas, 0, -height);
    context.restore();

    // 6. Convert the canvas to a data URL and download it as an image
    const a = document.createElement('a');
    a.download = 'image.png';
    a.href = canvas.toDataURL();
    a.click();

    // 7. Unbind the framebuffer to return to default rendering to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


export function saveFramebufferToFile(): void {
    const view = $.viewAs<GLView>();
    const gl = view.glctx;
    // 2. Read the pixels from the framebuffer into an array
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // 3. Create a new canvas and context
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    // 4. Put the pixel data into an ImageData object and draw it to the canvas
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    context.putImageData(imageData, 0, 0);

    // Flip the context vertically
    context.scale(1, -1);
    context.translate(0, -height);

    // 5. Convert the canvas to a data URL and download it as an image
    const a = document.createElement('a');
    a.download = 'image.png';
    a.href = canvas.toDataURL();
    a.click();
}

export function checkWebGLError(infoText: string): number {
    let error = 0;
    try {
        const gl = ($.view as any).glctx as WebGLRenderingContext;
        error = gl.getError();
        if (error !== gl.NO_ERROR) {
            // Throwing error so that it can be caught by the debugger via catching caught exceptions
            // This is useful for debugging WebGL errors in the browser console
            throw new Error(`WebGL error occurred: ${infoText} ${getWebGLErrorString(gl, error)}`);
        }
    } catch (e) {
        console.error(e);
    } finally {
        // WebGL does not provide a method to explicitly clear errors.
        // Errors are cleared automatically when retrieved using gl.getError().
        return error;
    }
}

export function catchWebGLError(_target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    if (!CATCH_WEBGL_ERROR) {
        return descriptor;
    }

    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
        const returnValue = originalMethod.apply(this, args);
        const gl = ($.view as any).glctx as WebGLRenderingContext;
        if (gl) {
            const error = gl.getError();
            // Handle the error as needed
            switch (error) {
                case gl.NO_ERROR:
                    // No error, do nothing
                    break;
                case gl.INVALID_ENUM:
                case gl.INVALID_VALUE:
                case gl.INVALID_OPERATION:
                case gl.OUT_OF_MEMORY:
                case gl.CONTEXT_LOST_WEBGL:
                    // These are recoverable errors
                    console.error(`WebGL error in function '${propertyKey}': '${getWebGLErrorString(gl, error)}' ('${error}').`);
                    break;
                default:
                    // For other errors, we might want to throw an exception or take other actions
                    throw new Error(`Unhandled WebGL error: ${getWebGLErrorString(gl, error)}`);
            }
        }
        return returnValue;
    };
    return descriptor;
}

export function getWebGLErrorString(gl: WebGLRenderingContext, error: number): string {
    switch (error) {
        case gl.NO_ERROR: return 'NO_ERROR';
        case gl.INVALID_ENUM: return 'INVALID_ENUM';
        case gl.INVALID_VALUE: return 'INVALID_VALUE';
        case gl.INVALID_OPERATION: return 'INVALID_OPERATION';
        case gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
        case gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
        case gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';

        default: return 'UNKNOWN_ERROR';
    }
}

export function getFramebufferStatusString(gl: WebGL2RenderingContext, status: number): string {
    switch (status) {
        case gl.FRAMEBUFFER_COMPLETE: return 'FRAMEBUFFER_COMPLETE';
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: return 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: return 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: return 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
        case gl.FRAMEBUFFER_UNSUPPORTED: return 'FRAMEBUFFER_UNSUPPORTED';
        case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: return 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE';
        default: return 'UNKNOWN_FRAMEBUFFER_STATUS';
    }
}
