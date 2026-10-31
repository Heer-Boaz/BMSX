import { Buffer } from 'buffer';
import type { GLTFIndexArray, GLTFMesh, GLTFModel, GLTFNode, GLTFPrimitive, GLTFSampler, GLTFScene, GLTFSkin, GLTFTexture } from '../../toolchain/ts/rompack/gltf';
import { dirname, extname, resolve } from 'node:path';

type GLBParseResult = { json: any; bin?: Uint8Array };

export type GLTFDocument = GLBParseResult & {
	readonly external: ReadonlyMap<string, Uint8Array>;
	readonly bufferFiles: ReadonlySet<string>;
};

function isDataUri(uri: string): boolean {
	return uri.startsWith('data:');
}

/** Resolve all external buffers and images before conversion, from one prepared input set. */
export function prepareGLTFDocument(bytes: Buffer, path: string, capture: (path: string) => Uint8Array): GLTFDocument {
	const parsed: GLBParseResult = extname(path).toLowerCase() === '.glb'
		? parseGLB(bytes) : { json: JSON.parse(bytes.toString('utf8')) };
	const external = new Map<string, Uint8Array>();
	const bufferFiles = new Set<string>();
	for (const definitions of [parsed.json.buffers ?? [], parsed.json.images ?? []]) {
		for (const definition of definitions) {
			const uri = definition.uri as string | undefined;
			if (uri === undefined || external.has(uri)) continue;
			if (isDataUri(uri)) external.set(uri, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
			else external.set(uri, capture(resolve(dirname(path), uri)));
		}
	}
	for (const definition of parsed.json.buffers ?? []) {
		if (definition.uri !== undefined && !isDataUri(definition.uri)) bufferFiles.add(resolve(dirname(path), definition.uri));
	}
	return { ...parsed, external, bufferFiles };
}

type AccessorRawArray = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array;

const ATTRIBUTE_TYPES: Readonly<Record<string, readonly string[]>> = {
	POSITION: ['VEC3'], NORMAL: ['VEC3'], TANGENT: ['VEC4'], COLOR_0: ['VEC3', 'VEC4'],
	TEXCOORD_0: ['VEC2'], TEXCOORD_1: ['VEC2'], JOINTS_0: ['VEC4'], JOINTS_1: ['VEC4'], WEIGHTS_0: ['VEC4'], WEIGHTS_1: ['VEC4'],
};

type AccessorInfo = {
	acc: any;
	buffer?: Uint8Array;
	offset: number;
	stride: number;
	count: number;
	componentSize: number;
	componentType: number;
	comp: number;
	normalized: boolean;
};

function parseGLB(data: Uint8Array): GLBParseResult {
	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('bad GLB magic');
	const version = dv.getUint32(4, true);
	if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
	const length = dv.getUint32(8, true);
	let offset = 12;
	let json: any;
	let bin: Uint8Array;
	const decoder = new TextDecoder('utf8');
	while (offset + 8 <= length) {
		const chunkLength = dv.getUint32(offset, true); offset += 4;
		const chunkType = dv.getUint32(offset, true); offset += 4;
		if (chunkType === 0x4E4F534A) { // JSON
			const bytes = data.subarray(offset, offset + chunkLength);
			json = JSON.parse(decoder.decode(bytes));
		} else if (chunkType === 0x004E4942) { // BIN
			bin = data.subarray(offset, offset + chunkLength);
		}
		offset += chunkLength;
		const padding = chunkLength % 4;
		if (padding) offset += 4 - padding;
	}
	if (!json) throw new Error('GLB missing JSON chunk');
	return { json, bin };
}

export function loadGLTFModel(document: GLTFDocument, resname: string): GLTFModel {
	const { json, bin: glbBin, external } = document;

	const buffers: Uint8Array[] = [];
	if (glbBin) {
		const bufList = json.buffers || [];
		if (bufList.length !== 1 || bufList[0]?.uri) {
			throw new Error('GLB must define exactly one buffer without URI');
		}
		buffers[0] = glbBin;
	} else {
		const bufList = json.buffers || [];
		for (let i = 0; i < bufList.length; i++) {
			const b = bufList[i];
			if (!b?.uri) throw new Error(`buffer[${i}] missing uri and no GLB BIN chunk`);
			buffers[i] = external.get(b.uri)!;
		}
	}

	const bufferViews = json.bufferViews || [];
	const accessors = json.accessors || [];
	const accessorFloatCache: (Float32Array)[] = [];
	const accessorRawCache: (AccessorRawArray)[] = [];

	function getComponentSize(componentType: number): number {
		switch (componentType) {
			case 5120: // BYTE
			case 5121: // UNSIGNED_BYTE
				return 1;
			case 5122: // SHORT
			case 5123: // UNSIGNED_SHORT
				return 2;
			case 5125: // UNSIGNED_INT
			case 5126: // FLOAT
				return 4;
			default:
				throw new Error(`bad componentType ${componentType}`);
		}
	}

	function getNumComponents(type: string): number {
		switch (type) {
			case 'SCALAR': return 1;
			case 'VEC2': return 2;
			case 'VEC3': return 3;
			case 'VEC4': return 4;
			case 'MAT2': return 4;
			case 'MAT3': return 9;
			case 'MAT4': return 16;
			default:
				throw new Error(`bad accessor.type ${type}`);
		}
	}

	function getAccessorInfo(index: number): AccessorInfo {
		const acc = accessors[index];
		if (!acc) throw new Error(`Missing accessor ${index}`);
		if (!Number.isInteger(acc.count) || acc.count <= 0) throw new Error(`Accessor ${index} requires a positive integer count`);
		const comp = getNumComponents(acc.type);
		const componentSize = getComponentSize(acc.componentType);
		const info: AccessorInfo = {
			acc,
			buffer: undefined,
			offset: 0,
			stride: componentSize * comp,
			count: acc.count,
			componentSize,
			componentType: acc.componentType,
			comp,
			normalized: !!acc.normalized,
		};
		if (acc.bufferView !== undefined) {
			const bufferView = bufferViews[acc.bufferView];
			if (!bufferView) throw new Error(`Missing bufferView ${acc.bufferView} for accessor ${index}`);
			const buffer = buffers[bufferView.buffer];
			if (!buffer) throw new Error(`Missing buffer ${bufferView.buffer} for accessor ${index}`);
			info.buffer = buffer;
			info.offset = (bufferView.byteOffset ?? 0) + (acc.byteOffset ?? 0);
			info.stride = bufferView.byteStride ?? (componentSize * comp);
			const span = (acc.byteOffset ?? 0) + (info.count - 1) * info.stride + componentSize * comp;
			if ((bufferView.byteOffset ?? 0) + bufferView.byteLength > buffer.byteLength || span > bufferView.byteLength) {
				throw new Error(`Accessor ${index} exceeds its declared bufferView`);
			}
		}
		return info;
	}

	function readScalar(dv: DataView, byteOffset: number, componentType: number, normalized: boolean): number {
		switch (componentType) {
			case 5126: // FLOAT
				return dv.getFloat32(byteOffset, true);
			case 5125: { // UNSIGNED_INT
				const value = dv.getUint32(byteOffset, true);
				return normalized ? value / 4294967295 : value;
			}
			case 5123: { // UNSIGNED_SHORT
				const value = dv.getUint16(byteOffset, true);
				return normalized ? value / 65535 : value;
			}
			case 5121: { // UNSIGNED_BYTE
				const value = dv.getUint8(byteOffset);
				return normalized ? value / 255 : value;
			}
			case 5122: { // SHORT
				const value = dv.getInt16(byteOffset, true);
				if (!normalized) return value;
				if (value === -32768) return -1;
				return Math.max(value / 32767, -1);
			}
			case 5120: { // BYTE
				const value = dv.getInt8(byteOffset);
				if (!normalized) return value;
				if (value === -128) return -1;
				return Math.max(value / 127, -1);
			}
			default:
				throw new Error(`bad componentType ${componentType}`);
		}
	}

	function readIndex(dv: DataView, byteOffset: number, componentType: number): number {
		switch (componentType) {
			case 5125: return dv.getUint32(byteOffset, true);
			case 5123: return dv.getUint16(byteOffset, true);
			case 5121: return dv.getUint8(byteOffset);
			default:
				throw new Error(`bad sparse index componentType ${componentType}`);
		}
	}

	function createTypedArray(componentType: number, length: number): AccessorRawArray {
		switch (componentType) {
			case 5126: return new Float32Array(length);
			case 5125: return new Uint32Array(length);
			case 5123: return new Uint16Array(length);
			case 5121: return new Uint8Array(length);
			case 5122: return new Int16Array(length);
			case 5120: return new Int8Array(length);
			default:
				throw new Error(`bad componentType ${componentType}`);
		}
	}

	function createTypedArrayView(componentType: number, buffer: ArrayBuffer, byteOffset: number, length: number): AccessorRawArray {
		switch (componentType) {
			case 5126: return new Float32Array(buffer, byteOffset, length);
			case 5125: return new Uint32Array(buffer, byteOffset, length);
			case 5123: return new Uint16Array(buffer, byteOffset, length);
			case 5121: return new Uint8Array(buffer, byteOffset, length);
			case 5122: return new Int16Array(buffer, byteOffset, length);
			case 5120: return new Int8Array(buffer, byteOffset, length);
			default:
				throw new Error(`bad componentType ${componentType}`);
		}
	}

	function applySparseFloat(dest: Float32Array, acc: any, comp: number): void {
		if (!acc.sparse) return;
		const { sparse } = acc;
		const indicesView = bufferViews[sparse.indices.bufferView];
		const valuesView = bufferViews[sparse.values.bufferView];
		if (!indicesView || !valuesView) throw new Error('Sparse accessor missing bufferView');
		const indicesBuffer = buffers[indicesView.buffer];
		const valuesBuffer = buffers[valuesView.buffer];
		if (!indicesBuffer || !valuesBuffer) throw new Error('Sparse accessor missing buffer');
		const indexStride = getComponentSize(sparse.indices.componentType);
		const valueStride = getComponentSize(acc.componentType);
		const idxOffset = (indicesView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
		const valOffset = (valuesView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
		const idxView = new DataView(indicesBuffer.buffer, indicesBuffer.byteOffset + idxOffset, sparse.count * indexStride);
		const valView = new DataView(valuesBuffer.buffer, valuesBuffer.byteOffset + valOffset, sparse.count * comp * valueStride);
		for (let i = 0; i < sparse.count; i++) {
			const index = readIndex(idxView, i * indexStride, sparse.indices.componentType);
			const base = index * comp;
			for (let c = 0; c < comp; c++) {
				const valueOffset = i * comp * valueStride + c * valueStride;
				dest[base + c] = readScalar(valView, valueOffset, acc.componentType, !!acc.normalized);
			}
		}
	}

	function applySparseRaw(dest: AccessorRawArray, acc: any, comp: number): void {
		if (!acc.sparse) return;
		const { sparse } = acc;
		const indicesView = bufferViews[sparse.indices.bufferView];
		const valuesView = bufferViews[sparse.values.bufferView];
		if (!indicesView || !valuesView) throw new Error('Sparse accessor missing bufferView');
		const indicesBuffer = buffers[indicesView.buffer];
		const valuesBuffer = buffers[valuesView.buffer];
		if (!indicesBuffer || !valuesBuffer) throw new Error('Sparse accessor missing buffer');
		const indexStride = getComponentSize(sparse.indices.componentType);
		const valueStride = getComponentSize(acc.componentType);
		const idxOffset = (indicesView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
		const valOffset = (valuesView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
		const idxView = new DataView(indicesBuffer.buffer, indicesBuffer.byteOffset + idxOffset, sparse.count * indexStride);
		const valView = new DataView(valuesBuffer.buffer, valuesBuffer.byteOffset + valOffset, sparse.count * comp * valueStride);
		for (let i = 0; i < sparse.count; i++) {
			const index = readIndex(idxView, i * indexStride, sparse.indices.componentType);
			const base = index * comp;
			for (let c = 0; c < comp; c++) {
				const valueOffset = i * comp * valueStride + c * valueStride;
				dest[base + c] = readScalar(valView, valueOffset, acc.componentType, false);
			}
		}
	}

	function getAccessorFloat(index: number): Float32Array {
		if (accessorFloatCache[index]) return accessorFloatCache[index]!;
		const acc = accessors[index];
		if (!acc) throw new Error(`Missing accessor ${index}`);
		const info = getAccessorInfo(index);
		const length = info.count * info.comp;
		if (info.buffer && info.componentType === 5126 && !info.normalized && !acc.sparse && info.stride === info.componentSize * info.comp) {
			const view = new Float32Array(info.buffer.buffer, info.buffer.byteOffset + info.offset, length);
			accessorFloatCache[index] = view;
			return view;
		}
		const out = new Float32Array(length);
		if (info.buffer) {
			const dv = new DataView(info.buffer.buffer, info.buffer.byteOffset, info.buffer.byteLength);
			const elemSize = info.componentSize;
			if (info.stride === elemSize * info.comp) {
				for (let i = 0; i < length; i++) {
					const offset = info.offset + i * elemSize;
					out[i] = readScalar(dv, offset, info.componentType, info.normalized);
				}
			} else {
				let dst = 0;
				for (let v = 0; v < info.count; v++) {
					const base = info.offset + v * info.stride;
					for (let c = 0; c < info.comp; c++, dst++) {
						const offset = base + c * elemSize;
						out[dst] = readScalar(dv, offset, info.componentType, info.normalized);
					}
				}
			}
		}
		applySparseFloat(out, acc, info.comp);
		accessorFloatCache[index] = out;
		return out;
	}

	function getAccessorRaw(index: number): AccessorRawArray {
		if (accessorRawCache[index]) return accessorRawCache[index]!;
		const acc = accessors[index];
		if (!acc) throw new Error(`Missing accessor ${index}`);
		const info = getAccessorInfo(index);
		const length = info.count * info.comp;
		let out: AccessorRawArray;
		if (!info.buffer) {
			out = createTypedArray(info.componentType, length);
		} else {
			const elemSize = info.componentSize;
			const tight = info.stride === elemSize * info.comp;
			if (tight && !acc.sparse) {
				out = createTypedArrayView(info.componentType, info.buffer.buffer as ArrayBuffer, info.buffer.byteOffset + info.offset, length);
			} else {
				out = createTypedArray(info.componentType, length);
				const dv = new DataView(info.buffer.buffer as ArrayBuffer, info.buffer.byteOffset, info.buffer.byteLength);
				if (tight) {
					const src = createTypedArrayView(info.componentType, info.buffer.buffer as ArrayBuffer, info.buffer.byteOffset + info.offset, length) as any;
					out.set(src);
				} else {
					let dst = 0;
					for (let v = 0; v < info.count; v++) {
						const base = info.offset + v * info.stride;
						for (let c = 0; c < info.comp; c++, dst++) {
							const offset = base + c * elemSize;
							out[dst] = readScalar(dv, offset, info.componentType, false);
						}
					}
				}
			}
		}
		applySparseRaw(out, acc, info.comp);
		accessorRawCache[index] = out;
		return out;
	}

	function getAccessorIndices(index: number, vertexCount: number): GLTFIndexArray {
		const acc = accessors[index];
		if (!acc || acc.type !== 'SCALAR') throw new Error('indices accessor must be SCALAR');
		if (acc.componentType !== 5121 && acc.componentType !== 5123 && acc.componentType !== 5125) {
			throw new Error('indices must use an unsigned component type');
		}
		const raw = getAccessorRaw(index) as GLTFIndexArray;
		const restart = acc.componentType === 5121 ? 0xff : acc.componentType === 5123 ? 0xffff : 0xffffffff;
		for (const value of raw) if (value >= vertexCount || value === restart) throw new Error('GLTF index does not reference an admitted vertex');
		return raw;
	}

	const textures = json.textures;
	const modelTextures: GLTFTexture[] | undefined = textures?.map((texture: any) => {
		if (texture.source !== undefined && json.images?.[texture.source] === undefined) throw new Error('GLTF texture references a missing image');
		if (texture.sampler !== undefined && json.samplers?.[texture.sampler] === undefined) throw new Error('GLTF texture references a missing sampler');
		return { source: texture.source, sampler: texture.sampler };
	});
	const samplers: GLTFSampler[] | undefined = json.samplers?.map((sampler: any) => ({
		magFilter: sampler.magFilter, minFilter: sampler.minFilter, wrapS: sampler.wrapS, wrapT: sampler.wrapT,
	}));

	const materials = json.materials?.map((m: any) => {
		const pbr = m.pbrMetallicRoughness ?? {};
		for (const info of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture]) {
			if (info !== undefined && textures?.[info.index] === undefined) throw new Error('GLTF material references a missing texture');
		}
		const emissive = m.emissiveFactor;
		return {
			baseColorFactor: pbr.baseColorFactor,
			metallicFactor: pbr.metallicFactor,
			roughnessFactor: pbr.roughnessFactor,
			baseColorTexture: pbr.baseColorTexture?.index,
			baseColorTexCoord: pbr.baseColorTexture?.texCoord,
			normalTexture: m.normalTexture?.index,
			normalTexCoord: m.normalTexture?.texCoord,
			normalScale: m.normalTexture?.scale,
			metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index,
			metallicRoughnessTexCoord: pbr.metallicRoughnessTexture?.texCoord,
			occlusionTexture: m.occlusionTexture?.index,
			occlusionTexCoord: m.occlusionTexture?.texCoord,
			occlusionStrength: m.occlusionTexture?.strength,
			emissiveTexture: m.emissiveTexture?.index,
			emissiveTexCoord: m.emissiveTexture?.texCoord,
			emissiveFactor: emissive,
			alphaMode: m.alphaMode ?? 'OPAQUE',
			alphaCutoff: m.alphaCutoff ?? 0.5,
			doubleSided: !!m.doubleSided,
			unlit: !!(m.extensions && m.extensions.KHR_materials_unlit),
		};
	});

	const meshes: GLTFMesh[] = [];
	for (const mesh of json.meshes || []) {
		const primitives: GLTFPrimitive[] = [];
		for (const prim of mesh.primitives || []) {
			const mode = prim.mode ?? 4;
			if (mode !== 4) throw new Error(`Unsupported primitive mode ${mode}`);
			const attributes = prim.attributes ?? {};
			if (attributes.POSITION === undefined) throw new Error('GLTF primitive missing POSITION attribute');
			const position = accessors[attributes.POSITION];
			for (const semantic in attributes) {
				const accessor = accessors[attributes[semantic]], types = ATTRIBUTE_TYPES[semantic];
				if (accessor.count !== position.count || types !== undefined && !types.includes(accessor.type)) throw new Error(`GLTF ${semantic} accessor does not match its vertex layout`);
			}
			if (prim.material !== undefined && json.materials?.[prim.material] === undefined) throw new Error('GLTF primitive references a missing material');
			const indices = prim.indices === undefined ? undefined : getAccessorIndices(prim.indices, position.count);
			if ((indices === undefined ? position.count : indices.length) % 3 !== 0) throw new Error('GLTF triangle-list count must be a multiple of three');
			const targets = prim.targets || [];
			const morphPositions: Float32Array[] = [];
			const morphNormals: Float32Array[] = [];
			const morphTangents: Float32Array[] = [];
			for (const target of targets) {
				for (const semantic in target) {
					const accessor = accessors[target[semantic]];
					if (accessor.count !== position.count || accessor.type !== 'VEC3') throw new Error(`GLTF morph ${semantic} accessor does not match its vertex layout`);
				}
				morphPositions.push(target.POSITION !== undefined ? getAccessorFloat(target.POSITION) : new Float32Array());
				morphNormals.push(target.NORMAL !== undefined ? getAccessorFloat(target.NORMAL) : new Float32Array());
				morphTangents.push(target.TANGENT !== undefined ? getAccessorFloat(target.TANGENT) : new Float32Array());
			}

		let jointIndices: Uint16Array;
		let jointWeights: Float32Array;
		const jointAttrPairs: Array<[number, number]> = [
			[attributes.JOINTS_0, attributes.WEIGHTS_0],
			[attributes.JOINTS_1, attributes.WEIGHTS_1],
		];
		const jointBlocks: Uint16Array[] = [];
		const weightBlocks: Float32Array[] = [];
		for (const [jAttr, wAttr] of jointAttrPairs) {
			if ((jAttr === undefined) !== (wAttr === undefined)) throw new Error('GLTF joint and weight attributes must be paired');
			if (jAttr === undefined) continue;
			const rawJ = getAccessorRaw(jAttr);
			let blockJ: Uint16Array;
			if (rawJ instanceof Uint16Array) blockJ = rawJ;
			else if (rawJ instanceof Uint8Array) {
				blockJ = Uint16Array.from(rawJ);
			} else throw new Error('JOINTS accessor has unsupported componentType');

			const blockW = getAccessorFloat(wAttr);
			jointBlocks.push(blockJ);
			weightBlocks.push(blockW);
		}
		if (jointBlocks.length) {
			const vertCount = jointBlocks[0].length / 4;
			jointIndices = new Uint16Array(vertCount * 4);
			jointWeights = new Float32Array(vertCount * 4);
			for (let v = 0; v < vertCount; v++) {
				const pairs: { i: number; w: number }[] = [];
				for (let b = 0; b < jointBlocks.length; b++) {
					const jb = jointBlocks[b];
					const wb = weightBlocks[b];
					for (let k = 0; k < 4; k++) {
						pairs.push({ i: jb[v * 4 + k], w: wb[v * 4 + k] });
					}
				}
				pairs.sort((a, b) => b.w - a.w);
				let sum = 0;
				for (let k = 0; k < 4; k++) sum += pairs[k]?.w ?? 0;
				if (sum > 0.00001) {
					const inv = 1 / sum;
					for (let k = 0; k < 4; k++) {
						const pair = pairs[k];
						jointIndices[v * 4 + k] = pair?.i ?? 0;
						jointWeights[v * 4 + k] = (pair?.w ?? 0) * inv;
					}
				} else {
					jointIndices.fill(0, v * 4, v * 4 + 4);
					jointWeights[v * 4] = 1;
					for (let k = 1; k < 4; k++) jointWeights[v * 4 + k] = 0;
				}
			}
		}

			const primitive: GLTFPrimitive = {
				positions: getAccessorFloat(attributes.POSITION),
				texcoords: attributes.TEXCOORD_0 !== undefined ? getAccessorFloat(attributes.TEXCOORD_0) : undefined,
				texcoords1: attributes.TEXCOORD_1 !== undefined ? getAccessorFloat(attributes.TEXCOORD_1) : undefined,
				normals: attributes.NORMAL !== undefined ? getAccessorFloat(attributes.NORMAL) : undefined,
				tangents: attributes.TANGENT !== undefined ? getAccessorFloat(attributes.TANGENT) : undefined,
				indices,
				indexComponentType: prim.indices !== undefined ? accessors[prim.indices].componentType : undefined,
				materialIndex: prim.material,
				morphPositions: morphPositions.length ? morphPositions : undefined,
				morphNormals: morphNormals.some(arr => arr.length) ? morphNormals : undefined,
				morphTangents: morphTangents.some(arr => arr.length) ? morphTangents : undefined,
				jointIndices,
				jointWeights,
				colors: attributes.COLOR_0 !== undefined ? getAccessorFloat(attributes.COLOR_0) : undefined,
			};
			primitives.push(primitive);
		}
		meshes.push({ name: mesh.name, primitives, weights: mesh.weights });
	}

	const animations = json.animations?.map((anim: any) => ({
		name: anim.name,
		samplers: (anim.samplers || []).map((sampler: any) => ({
			interpolation: sampler.interpolation || 'LINEAR',
			input: getAccessorFloat(sampler.input),
			output: getAccessorFloat(sampler.output),
		})),
		channels: anim.channels || [],
	}));

	const imageURIs: string[] = [];
	const imageBuffers: Uint8Array[] = [];
	for (const image of json.images || []) {
		if (image.uri !== undefined) {
			imageURIs.push(image.uri); imageBuffers.push(external.get(image.uri)!);
		} else if (image.bufferView !== undefined) {
			const view = bufferViews[image.bufferView], buffer = buffers[view.buffer];
			const start = view.byteOffset ?? 0, end = start + view.byteLength;
			if (end > buffer.byteLength) throw new Error(`Image bufferView ${image.bufferView} exceeds its buffer`);
			imageURIs.push(`bufferView:${image.bufferView}`); imageBuffers.push(buffer.subarray(start, end));
		} else throw new Error('GLTF image requires a URI or bufferView');
	}

	const nodes: GLTFNode[] | undefined = json.nodes?.map((n: any) => {
		if (n.mesh !== undefined && json.meshes?.[n.mesh] === undefined) throw new Error('GLTF node references a missing mesh');
		if (n.skin !== undefined && json.skins?.[n.skin] === undefined) throw new Error('GLTF node references a missing skin');
		return {
			mesh: n.mesh,
			children: n.children,
			translation: n.translation,
			rotation: n.rotation,
			scale: n.scale,
			matrix: n.matrix ? new Float32Array(n.matrix) : undefined,
			skin: n.skin,
			weights: n.weights,
		};
	});

	const scenes: GLTFScene[] | undefined = json.scenes?.map((s: any) => ({ nodes: s.nodes || [] }));
	const scene: number = json.scene;

	const skins: GLTFSkin[] | undefined = json.skins?.map((s: any) => {
		for (const joint of s.joints) if (json.nodes?.[joint] === undefined) throw new Error('GLTF skin references a missing joint');
		if (s.inverseBindMatrices === undefined) {
			return { joints: s.joints };
		}
		const data = getAccessorFloat(s.inverseBindMatrices);
		const matrices: Float32Array[] = [];
		for (let i = 0; i < data.length; i += 16) matrices.push(data.subarray(i, i + 16));
		return { joints: s.joints, inverseBindMatrices: matrices };
	});

	return {
		name: resname,
		meshes,
		materials,
		animations,
		imageURIs,
		imageBuffers,
		textures: modelTextures,
		samplers,
		nodes,
		scenes,
		scene,
		skins,
	};

}
