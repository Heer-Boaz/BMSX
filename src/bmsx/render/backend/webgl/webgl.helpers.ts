import { $ } from '../../../core/game';
import { M4 } from '../../3d/math3d';

// Global toggle for WebGL error checking. Disable in normal builds for performance.
export const CATCH_WEBGL_ERROR = false;

export function saveTextureToFile(): void {
	const view = $.view;
	const gl = view.nativeCtx as WebGLRenderingContext;

	// 1. Bind the framebuffer that has the texture attached
	// Access legacy framebuffer through the documented getter (GameView exposes _legacyFramebuffer)
	// TODO: BUG!!!!!!!!!
	const legacyFbo: WebGLFramebuffer | null = (view as unknown as { _legacyFramebuffer: WebGLFramebuffer | null })._legacyFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, legacyFbo);

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
	const view = $.view;
	const gl = view.nativeCtx as WebGLRenderingContext;
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

export function checkWebGLError(_infoText: string): number {
	if (!CATCH_WEBGL_ERROR) return 0;
	try {
		const gl = $.view.nativeCtx as WebGLRenderingContext;
		const err = gl.getError();
		if (err !== gl.NO_ERROR) {
			// Surface in console during debug but do not throw to avoid breaking the frame
			console.error(`WebGL error: ${getWebGLErrorString(gl, err)}: ${_infoText}`);
		}
		return err;
	} catch {
		return 0;
	}
}

export function catchWebGLError(_target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
	if (!CATCH_WEBGL_ERROR) {
		return descriptor;
	}

	const originalMethod = descriptor.value;
	descriptor.value = function (...args: any[]) {
		const returnValue = originalMethod.apply(this, args);
		const gl = $.view.nativeCtx as WebGLRenderingContext;
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

export function generateDetailedDrawError(
	gl: WebGL2RenderingContext,
	m: any, // Mesh type
	framebuffer: WebGLFramebuffer,
	vertexCount: number,
	drawError: GLenum,
	// Buffer references
	jointBuffer3D: WebGLBuffer,
	weightBuffer3D: WebGLBuffer,
	morphPositionBuffers3D: WebGLBuffer[],
	morphNormalBuffers3D: WebGLBuffer[],
	morphTangentBuffers3D: WebGLBuffer[],
	vertexBuffer3D: WebGLBuffer,
	texcoordBuffer3D: WebGLBuffer,
	normalBuffer3D: WebGLBuffer,
	tangentBuffer3D: WebGLBuffer,
	indexBuffer3D: WebGLBuffer,
	// Uniform locations
	albedoTextureLocation3D: WebGLUniformLocation,
	normalTextureLocation3D: WebGLUniformLocation,
	metallicRoughnessTextureLocation3D: WebGLUniformLocation,
	shadowMapLocation3D: WebGLUniformLocation,
	useAlbedoTextureLocation3D: WebGLUniformLocation,
	useNormalTextureLocation3D: WebGLUniformLocation,
	useMetallicRoughnessTextureLocation3D: WebGLUniformLocation,
	useShadowMapLocation3D: WebGLUniformLocation,
	morphWeightLocation3D: WebGLUniformLocation,
	jointMatrixLocation3D: WebGLUniformLocation,
	// Texture units
	TEXTURE_UNIT_ALBEDO: number,
	TEXTURE_UNIT_NORMAL: number,
	TEXTURE_UNIT_METALLIC_ROUGHNESS: number,
	TEXTURE_UNIT_SHADOW_MAP: number,
	// Arrays and matrices
	jointMatrixArray: Float32Array,
	identityMatrix: Float32Array,
	// Camera
	activeCamera: any
): string {
	const typeToByteSize = {
		[gl.UNSIGNED_BYTE]: Uint8Array.BYTES_PER_ELEMENT,
		[gl.UNSIGNED_SHORT]: Uint16Array.BYTES_PER_ELEMENT,
		[gl.UNSIGNED_INT]: Uint32Array.BYTES_PER_ELEMENT,
	}
	const vertexType2String = (t: GLenum): string => {
		switch (t) {
			case gl.UNSIGNED_BYTE: return "UNSIGNED_BYTE";
			case gl.UNSIGNED_SHORT: return "UNSIGNED_SHORT";
			case gl.UNSIGNED_INT: return "UNSIGNED_INT";
			default: return "UNKNOWN";
		}
	};
	const getBufferData = (buffer: WebGLBuffer, t: GLenum, size: number): any => {
		const result: Uint8Array | Uint16Array | Float32Array = new (t === gl.FLOAT ? Float32Array : t === gl.UNSIGNED_BYTE ? Uint8Array : Uint16Array)(size);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.getBufferSubData(gl.ARRAY_BUFFER, 0, result);
		return result;
	};

	const getGlBufferSize = (buffer: WebGLBuffer, target: GLenum = gl.ARRAY_BUFFER): number => {
		gl.bindBuffer(target, buffer);
		return gl.getBufferParameter(target, gl.BUFFER_SIZE);
	};

	const type = m.indices instanceof Uint32Array ? gl.UNSIGNED_INT :
		m.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;

	// Additional state checks for common INVALID_OPERATION causes
	const currentVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
	const vaoBound = !!currentVAO;
	const currentElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
	const elementBufferBound = !!currentElementBuffer;
	const maxIndex = Math.max(...m.indices!); // For clearer out-of-bounds diagnostics

	// Read the data from the buffers for debugging
	const jointData = getBufferData(jointBuffer3D, gl.UNSIGNED_SHORT, vertexCount * 4);
	const weightData = getBufferData(weightBuffer3D, gl.FLOAT, vertexCount * 4);
	const morphPositionData = morphPositionBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
	const morphNormalData = morphNormalBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
	const morphTangentData = morphTangentBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
	const jointMatrices = jointMatrixArray.length > 0 ? Array.from({ length: jointMatrixArray.length / 16 }, (_, i) => jointMatrixArray.slice(i * 16, (i + 1) * 16)) : null;
	const positions = getBufferData(vertexBuffer3D, gl.FLOAT, vertexCount * 3);
	const texcoords = m.hasTexcoords ? getBufferData(texcoordBuffer3D, gl.FLOAT, vertexCount * 2) : null;
	const normals = m.hasNormals ? getBufferData(normalBuffer3D, gl.FLOAT, vertexCount * 3) : null;
	const tangents = m.hasTangents ? getBufferData(tangentBuffer3D, gl.FLOAT, vertexCount * 4) : null;
	const vertexData = {
		jointData: jointData,
		weightData: weightData,
		morphPositions: morphPositionData,
		morphNormals: morphNormalData,
		morphTangents: morphTangentData,
		positions: positions,
		texcoords: texcoords,
		normals: normals,
		tangents: tangents,
	};

	const bufferSize = {
		vertexBuffer3D: getGlBufferSize(vertexBuffer3D),
		indexBuffer3D: indexBuffer3D ? getGlBufferSize(indexBuffer3D, gl.ELEMENT_ARRAY_BUFFER) : 0,
		texcoordBuffer3D: m.hasTexcoords ? getGlBufferSize(texcoordBuffer3D) : 0,
		normalBuffer3D: m.hasNormals ? getGlBufferSize(normalBuffer3D) : 0,
		tangentBuffer3D: m.hasTangents ? getGlBufferSize(tangentBuffer3D) : 0,
		jointBuffer3D: m.hasSkinning ? getGlBufferSize(jointBuffer3D) : 0,
		weightBuffer3D: m.hasSkinning ? getGlBufferSize(weightBuffer3D) : 0,
		morphPositionBuffers3D: morphPositionBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
		morphNormalBuffers3D: morphNormalBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
		morphTangentBuffers3D: morphTangentBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
	};

	const bufferSizeCorrectness = {
		vertexBuffer3D: bufferSize.vertexBuffer3D === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT,
		indexBuffer3D: indexBuffer3D ? bufferSize.indexBuffer3D === m.indices!.length * typeToByteSize[type] : false,
		texcoordBuffer3D: m.hasTexcoords ? bufferSize.texcoordBuffer3D === vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT : true,
		normalBuffer3D: m.hasNormals ? bufferSize.normalBuffer3D === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true,
		tangentBuffer3D: m.hasTangents ? bufferSize.tangentBuffer3D === vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT : true,
		jointBuffer3D: m.hasSkinning ? bufferSize.jointBuffer3D === vertexCount * 4 * Uint16Array.BYTES_PER_ELEMENT : true,
		weightBuffer3D: m.hasSkinning ? bufferSize.weightBuffer3D === vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT : true,
		morphPositionBuffers3D: morphPositionBuffers3D.map((b, i) => b ? bufferSize.morphPositionBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
		morphNormalBuffers3D: morphNormalBuffers3D.map((b, i) => b ? bufferSize.morphNormalBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
		morphTangentBuffers3D: morphTangentBuffers3D.map((b, i) => b ? bufferSize.morphTangentBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
	};

	const bufferSizeCorrectnessReasons = {
		vertexBuffer3D: bufferSizeCorrectness.vertexBuffer3D ? 'yes' : `no, because ${bufferSize.vertexBuffer3D - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`,
		indexBuffer3D: indexBuffer3D ? (bufferSizeCorrectness.indexBuffer3D ? 'yes' : `no, because ${bufferSize.indexBuffer3D - m.indices!.length * typeToByteSize[type]} bytes are missing`) : 'Unbound!',
		texcoordBuffer3D: m.hasTexcoords ? (bufferSizeCorrectness.texcoordBuffer3D ? 'yes' : `no, because ${bufferSize.texcoordBuffer3D - vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
		normalBuffer3D: m.hasNormals ? (bufferSizeCorrectness.normalBuffer3D ? 'yes' : `no, because ${bufferSize.normalBuffer3D - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
		tangentBuffer3D: m.hasTangents ? (bufferSizeCorrectness.tangentBuffer3D ? 'yes' : `no, because ${bufferSize.tangentBuffer3D - vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
		jointBuffer3D: m.hasSkinning ? (bufferSizeCorrectness.jointBuffer3D ? 'yes' : `no, because ${bufferSize.jointBuffer3D - vertexCount * 4 * Uint16Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
		weightBuffer3D: m.hasSkinning ? (bufferSizeCorrectness.weightBuffer3D ? 'yes' : `no, because ${bufferSize.weightBuffer3D - vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
		morphPositionBuffers3D: '[' + morphPositionBuffers3D.map((b, i) => b ? (bufferSize.morphPositionBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphPositionBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
		morphNormalBuffers3D: '[' + morphNormalBuffers3D.map((b, i) => b ? (bufferSize.morphNormalBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphNormalBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
		morphTangentBuffers3D: '[' + morphTangentBuffers3D.map((b, i) => b ? (bufferSize.morphTangentBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphTangentBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
	};

	const matColor = m.material?.color ?? [1, 1, 1, 1];
	const mvp = new Float32Array(16);
	// Fast-path: if model is identity, copy VP instead of multiplying
	if (
		identityMatrix[0] === 1 && identityMatrix[5] === 1 && identityMatrix[10] === 1 && identityMatrix[15] === 1 &&
		identityMatrix[1] === 0 && identityMatrix[2] === 0 && identityMatrix[3] === 0 &&
		identityMatrix[4] === 0 && identityMatrix[6] === 0 && identityMatrix[7] === 0 &&
		identityMatrix[8] === 0 && identityMatrix[9] === 0 && identityMatrix[11] === 0 &&
		identityMatrix[12] === 0 && identityMatrix[13] === 0 && identityMatrix[14] === 0
	) {
		M4.copyInto(mvp, activeCamera.viewProjectionMatrix);
	} else {
		M4.mulInto(mvp, activeCamera.viewProjectionMatrix, identityMatrix);
	}
	const normalMat = new Float32Array(9);
	M4.normal3Into(normalMat, identityMatrix);

	return `Mesh ${m.name} has indices but drawElements failed. Vertex count: ${vertexCount}, Indices length: ${m.indices!.length}
		Max index: ${maxIndex} (must be < ${vertexCount})

		Indices-type: ${vertexType2String(type)} (${typeToByteSize[type]} bytes per index)
		Vertex Buffer Size: ${bufferSize.vertexBuffer3D} bytes (${vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} expected)
		Index Buffer Size: ${bufferSize.indexBuffer3D} bytes (${m.indices!.length * typeToByteSize[type]} expected)
		Valid indices: ${m.indices!.every((i: number) => i >= 0 && i < vertexCount)}
		Buffer size correctness checks:
${Object.entries(bufferSizeCorrectnessReasons).map(([buffer, result]) => `\t\t${buffer}: ${result}`).join('\n')}

		_________________________________________________________________
		Draw Error: ${drawError}
		WebGL error: ${getWebGLErrorString(gl, drawError)}
		Framebuffer Created: ${framebuffer ? 'yes' : 'no'}
		Framebuffer Bound: ${gl.getParameter(gl.FRAMEBUFFER_BINDING) === framebuffer ? 'yes' : 'no'}
		Framebuffer status: ${getFramebufferStatusString(gl, gl.checkFramebufferStatus(gl.FRAMEBUFFER))}
		VAO bound: ${vaoBound ? 'yes' : 'no'}
		Element Array Buffer bound: ${elementBufferBound ? 'yes' : 'no'}
		glTextureIndexes units reserved vs bound for Albedo: TEXTURE${TEXTURE_UNIT_ALBEDO}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), albedoTextureLocation3D)}, Normal: TEXTURE${TEXTURE_UNIT_NORMAL}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), normalTextureLocation3D)}, MetallicRoughness: TEXTURE${TEXTURE_UNIT_METALLIC_ROUGHNESS}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), metallicRoughnessTextureLocation3D)}, Shadow Map: TEXTURE${TEXTURE_UNIT_SHADOW_MAP}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), shadowMapLocation3D)}
		glTextureIndex units correctly mapped: ${TEXTURE_UNIT_ALBEDO === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), albedoTextureLocation3D) &&
		TEXTURE_UNIT_NORMAL === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), normalTextureLocation3D) &&
		TEXTURE_UNIT_METALLIC_ROUGHNESS === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), metallicRoughnessTextureLocation3D) &&
		TEXTURE_UNIT_SHADOW_MAP === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), shadowMapLocation3D)}
		glTextureUniforms set correctly (thus: value correctly maps to texture unit):
		_________________________________________________________________
		Material Color: ${JSON.stringify(matColor)}, Metallic Factor: ${m.material?.metallicFactor}, Roughness Factor: ${m.material?.roughnessFactor}
		Texture Albedo: ${m.gpuTextureAlbedo ? `'${m.gpuTextureAlbedo}'` : 'none'}
		Texture Normal: ${m.gpuTextureNormal ? `'${m.gpuTextureNormal}'` : 'none'}
		Texture MetallicRoughness: ${m.gpuTextureMetallicRoughness ? `'${m.gpuTextureMetallicRoughness}'` : 'none'}
		_________________________________________________________________
		Has normals: ${m.hasNormals}
		Has tangents: ${m.hasTangents}
		Has texcoords: ${m.hasTexcoords}
		Has skinning: ${m.hasSkinning}
		_________________________________________________________________
		Shadow: ${m.shadow ? 'yes' : 'no'}, Shadow Map: ${m.shadow?.map.texture ?? 'none'}, Shadow Strength: ${m.shadow?.strength ?? 'none'}
		Shadow Matrix: ${m.shadow?.matrix ?? 'none'}
		Joint Matrices: ${jointMatrices ? jointMatrices.map(j => JSON.stringify(j)).join(', ') : 'none'}
		Morph Targets: ${m.hasMorphTargets ? m.morphPositions!.length : 'none'}
		Morph Weights: ${m.hasMorphTargets ? m.morphWeights.join(', ') : 'none'}
		_________________________________________________________________
		MVP: ${JSON.stringify(mvp)}
		Model Matrix: ${JSON.stringify(identityMatrix)}
		Normal Matrix: ${JSON.stringify(normalMat)}
		_________________________________________________________________
		Bound Vertex Buffer ID: ${vertexBuffer3D ? 'yes' : 'no'}
		Bound Texcoord Buffer ID: ${texcoordBuffer3D ? 'yes' : 'no'}
		Bound Normal Buffer ID: ${normalBuffer3D ? 'yes' : 'no'}
		Bound Tangent Buffer ID: ${tangentBuffer3D ? 'yes' : 'no'}
		Bound Index Buffer ID: ${indexBuffer3D ? 'yes' : 'no'}
		Bound Joint Buffer ID: ${jointBuffer3D ? 'yes' : 'no'}
		Bound Weight Buffer ID: ${weightBuffer3D ? 'yes' : 'no'}
		Bound Morph Position Buffers: ${morphPositionBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
		Bound Morph Normal Buffers: ${morphNormalBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
		Bound Morph Tangent Buffers: ${morphTangentBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
		_________________________________________________________________
		Has Albedo Texture: ${m.gpuTextureAlbedo ? 'yes' : 'no'}
		Use Albedo Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useAlbedoTextureLocation3D)}
		Has Normal Texture: ${m.gpuTextureNormal ? 'yes' : 'no'}
		Use Normal Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useNormalTextureLocation3D)}
		Has Metallic Roughness Texture: ${m.gpuTextureMetallicRoughness ? 'yes' : 'no'}
		Use Metallic Roughness Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useMetallicRoughnessTextureLocation3D)}
		Has Shadow Map: ${m.shadow ? 'yes' : 'no'}
		Use Shadow Map uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useShadowMapLocation3D)}
		Has Morph Targets: ${m.hasMorphTargets ? 'yes' : 'no'}
		Morph Weights uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), morphWeightLocation3D)}
		Has Joint Matrices: ${m.hasSkinning && jointMatrices ? 'yes' : 'no'}
		Joint Matrices uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), jointMatrixLocation3D)}
		Has Joint Matrix Array: ${jointMatrixArray?.length > 0 ? 'yes' : 'no'}
			Joint Matrix Array length: ${jointMatrixArray?.length / 16}
			Joint Matrix Array data: ${JSON.stringify(jointData)}  // Reusing jointData
		Joint Matrix Array: ${JSON.stringify(jointMatrixArray)}
		_________________________________________________________________
		Vertex Data: ${JSON.stringify(vertexData)}
`;
}
