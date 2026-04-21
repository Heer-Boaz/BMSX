type ApiMemberValue = {
	kind: 'method' | 'getter';
	descriptor: PropertyDescriptor;
};

export type ApiMember = {
	name: string;
	kind: 'method' | 'getter';
	descriptor: PropertyDescriptor;
};

export function collectApiMembers(apiObject: object): ApiMember[] {
	const map = new Map<string, ApiMemberValue>();
	let prototype: object = Object.getPrototypeOf(apiObject);
	while (prototype && prototype !== Object.prototype) {
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (name === 'constructor') continue;
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor || map.has(name)) continue;
			if (typeof descriptor.value === 'function') {
				map.set(name, { kind: 'method', descriptor });
			} else if (descriptor.get) {
				map.set(name, { kind: 'getter', descriptor });
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
}
