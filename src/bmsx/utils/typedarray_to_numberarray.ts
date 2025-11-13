// Explicit instance checks prevent relying on weak typing and avoid casts like `as any`.
export function typedarray_to_numberarray(view: ArrayBufferView): number[] {
	if (view instanceof Float32Array) return Array.from(view);
	if (view instanceof Float64Array) return Array.from(view);
	if (view instanceof Int8Array) return Array.from(view);
	if (view instanceof Uint8Array) return Array.from(view);
	if (view instanceof Uint8ClampedArray) return Array.from(view);
	if (view instanceof Int16Array) return Array.from(view);
	if (view instanceof Uint16Array) return Array.from(view);
	if (view instanceof Int32Array) return Array.from(view);
	if (view instanceof Uint32Array) return Array.from(view);
	// BigInt typed arrays: coerce to Number (may lose precision but preserves runtime safety)
	if (typeof BigInt64Array !== 'undefined' && view instanceof BigInt64Array) return Array.from(view, (v) => Number(v));
	if (typeof BigUint64Array !== 'undefined' && view instanceof BigUint64Array) return Array.from(view, (v) => Number(v));
	// Fallback: interpret raw bytes as Uint8Array slice
	const asBytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	return Array.from(asBytes);
}
