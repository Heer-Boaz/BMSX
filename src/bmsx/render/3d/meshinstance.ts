export interface InstancedMeshData {
    positions: Float32Array;
    texcoords: Float32Array;
    normals?: Float32Array;
    count: number;
}

export class InstancingGroup {
    private matrices: Float32Array = new Float32Array(0);
    addInstance(matrix: Float32Array): void {
        const newBuf = new Float32Array(this.matrices.length + 16);
        newBuf.set(this.matrices, 0);
        newBuf.set(matrix, this.matrices.length);
        this.matrices = newBuf;
    }
    clear(): void {
        this.matrices = new Float32Array(0);
    }
    get instanceCount(): number {
        return this.matrices.length / 16;
    }
    get instanceMatrices(): Float32Array {
        return this.matrices;
    }
}
