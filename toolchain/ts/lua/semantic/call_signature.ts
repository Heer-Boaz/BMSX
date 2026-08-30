import type { LuaCallExpression } from '../syntax/ast';
import type { LuaBuiltinDescriptor } from '../semantic_contracts';
import type { FunctionSignatureInfo, Ref } from './model';

export type LuaCallStyle = 'function' | 'method';

export function getLuaCallStyle(call: LuaCallExpression): LuaCallStyle {
	return call.method === null ? 'function' : 'method';
}

export function getLuaCallReceiverParameterShift(
	signature: FunctionSignatureInfo,
	callStyle: LuaCallStyle,
): -1 | 0 | 1 {
	if (signature.declarationStyle === 'method' && callStyle === 'function') {
		return 1;
	}
	if (signature.declarationStyle === 'function' && callStyle === 'method') {
		return -1;
	}
	return 0;
}

export function getLuaCallMinimumArgumentCount(
	signature: FunctionSignatureInfo,
	callStyle: LuaCallStyle,
): number {
	return Math.max(
		0,
		signature.minimumArgumentCount + getLuaCallReceiverParameterShift(signature, callStyle),
	);
}

export function getLuaBuiltinMinimumArgumentCount(descriptor: LuaBuiltinDescriptor): number {
	const optional = descriptor.optionalParams;
	let required = 0;
	for (let index = 0; index < descriptor.params.length; index += 1) {
		const parameter = descriptor.params[index];
		if (parameter.endsWith('?') || parameter === '...' || parameter.endsWith('...')) {
			continue;
		}
		let isOptional = false;
		if (optional !== undefined) {
			for (let optionalIndex = 0; optionalIndex < optional.length; optionalIndex += 1) {
				if (optional[optionalIndex] === parameter) {
					isOptional = true;
					break;
				}
			}
		}
		if (!isOptional) {
			required += 1;
		}
	}
	return required;
}

export function formatLuaCallReferencePath(reference: Ref, callStyle: LuaCallStyle): string {
	if (callStyle === 'function' || reference.namePath.length < 2) {
		return reference.namePath.join('.');
	}
	let receiver = reference.namePath[0];
	for (let index = 1; index < reference.namePath.length - 1; index += 1) {
		receiver += `.${reference.namePath[index]}`;
	}
	return `${receiver}:${reference.name}`;
}
