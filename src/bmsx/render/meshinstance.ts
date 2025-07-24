export interface InstancedMeshData {
    positions: Float32Array;
    texcoords: Float32Array;
    normals?: Float32Array;
    count: number;
}

export class InstancingGroup {
    private instances: Float32Array[] = [];
    addInstance(matrix: Float32Array): void {
        this.instances.push(matrix);
    }
    clear(): void {
        this.instances = [];
    }
    get instanceCount(): number {
        return this.instances.length;
    }
    get instanceMatrices(): Float32Array[] {
        return this.instances;
    }
}
