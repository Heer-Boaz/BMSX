export interface OBJModel {
    positions: Float32Array;
    texcoords: Float32Array;
    normals: Float32Array | null;
}

/**
 * Parses a very small subset of the Wavefront OBJ format.
 * Only supports triangles with vertex positions and texture coordinates.
 */
export function loadOBJModel(data: string): OBJModel {
    const positions: number[] = [];
    const texcoords: number[] = [];
    const normals: number[] = [];
    const finalPositions: number[] = [];
    const finalTexcoords: number[] = [];
    const finalNormals: number[] = [];

    const lines = data.split(/\r?\n/);
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 0) continue;
        switch (parts[0]) {
            case 'v':
                positions.push(parseFloat(parts[1]));
                positions.push(parseFloat(parts[2]));
                positions.push(parseFloat(parts[3]));
                break;
            case 'vt':
                texcoords.push(parseFloat(parts[1]));
                texcoords.push(1 - parseFloat(parts[2]));
                break;
            case 'vn':
                normals.push(parseFloat(parts[1]));
                normals.push(parseFloat(parts[2]));
                normals.push(parseFloat(parts[3]));
                break;
            case 'f':
                for (let i = 1; i <= 3; i++) {
                    const indices = parts[i].split('/');
                    const vIdx = parseInt(indices[0], 10) - 1;
                    const tIdx = indices[1] ? parseInt(indices[1], 10) - 1 : -1;
                    const nIdx = indices[2] ? parseInt(indices[2], 10) - 1 : -1;
                    finalPositions.push(positions[vIdx * 3], positions[vIdx * 3 + 1], positions[vIdx * 3 + 2]);
                    if (tIdx >= 0) {
                        finalTexcoords.push(texcoords[tIdx * 2], texcoords[tIdx * 2 + 1]);
                    } else {
                        finalTexcoords.push(0, 0);
                    }
                    if (nIdx >= 0) {
                        finalNormals.push(normals[nIdx * 3], normals[nIdx * 3 + 1], normals[nIdx * 3 + 2]);
                    }
                }
                break;
        }
    }

    return {
        positions: new Float32Array(finalPositions),
        texcoords: new Float32Array(finalTexcoords),
        normals: finalNormals.length > 0 ? new Float32Array(finalNormals) : null
    };
}
