const CATCH_WEBGL_ERROR = true;

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
            if (error != gl.NO_ERROR) {
                console.error(`WebGL error in function '${propertyKey}': '${getWebGLErrorString(gl, error)}' ('${error}').`);
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
        default: return 'UNKNOWN_ERROR';
    }
}
