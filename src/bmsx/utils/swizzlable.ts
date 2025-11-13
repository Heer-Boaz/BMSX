/**
 * Small utility to create GLSL-like swizzling on vectors.
 * Usage:
 *   const v = swizzlable({ x: 1, y: 2, z: 3 });
 *   v.xy        // -> swizzled vector [1,2] (swizzlable)
 *   v.xyz.x     // -> 1
 *   v.rg = [5,6]// -> sets x=5, y=6 on the underlying vector
 */
export function swizzlable<T extends Record<string, any> | any[]>(
	vec: T,
	opts?: { map?: Record<string, string | number>; returnArray?: boolean; maxLen?: number; }
): T & Record<string, any> {
	// default mapping (unchanged behaviour)
	const defaultMap: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

	// use provided map or fall back to default; values in customMap are property names or indices
	const customMap = opts?.map;
	const lettersArr = Array.from(new Set(customMap ? Object.keys(customMap) : Object.keys(defaultMap)));
	const maxLen = opts?.maxLen ?? 4;

	// Build a safe character class for the regex by escaping special chars
	const charClass = lettersArr.map(ch => ch.replace(/[-\\^\]]/g, "\\$&")).join('');
	const validLettersRe = new RegExp(`^[${charClass}]{1,${maxLen}}$`);

	// Helper to check swizzle token validity (allows removing whitespace)
	const isValidToken = (tok: string) => {
		const s = tok.replace(/\s+/g, '');
		return validLettersRe.test(s);
	};

	// Normalize access to numeric/component by letter using customMap or default behavior
	const getComp = (target: any, letter: string) => {
		if (customMap && customMap.hasOwnProperty(letter)) {
			const key = customMap[letter];
			if (typeof key === 'number') {
				return Array.isArray(target) ? target[key] : target[String(key)];
			}
			return target[key];
		}
		// fallback to original numeric-index based behaviour
		const idx = defaultMap[letter];
		if (idx === undefined) return undefined;
		if (Array.isArray(target)) return target[idx];
		switch (idx) {
			case 0: return target.x ?? target.r ?? target[0];
			case 1: return target.y ?? target.g ?? target[1];
			case 2: return target.z ?? target.b ?? target[2];
			case 3: return target.w ?? target.a ?? target[3];
			default: return undefined;
		}
	};

	const setComp = (target: any, letter: string, value: number) => {
		if (customMap && customMap.hasOwnProperty(letter)) {
			const key = customMap[letter];
			if (typeof key === 'number') {
				if (Array.isArray(target)) target[key] = value;
				else target[String(key)] = value;
				return;
			}
			target[key] = value;
			return;
		}
		const idx = defaultMap[letter];
		if (idx === undefined) return;
		if (Array.isArray(target)) {
			target[idx] = value;
			return;
		}
		switch (idx) {
			case 0: if ('x' in target || 'r' in target) { if ('x' in target) target.x = value; else target.r = value; } else target[0] = value; break;
			case 1: if ('y' in target || 'g' in target) { if ('y' in target) target.y = value; else target.g = value; } else target[1] = value; break;
			case 2: if ('z' in target || 'b' in target) { if ('z' in target) target.z = value; else target.b = value; } else target[2] = value; break;
			case 3: if ('w' in target || 'a' in target) { if ('w' in target) target.w = value; else target.a = value; } else target[3] = value; break;
		}
	};

	const handler: ProxyHandler<any> = {
		get(target, prop, _receiver) {
			if (typeof prop === 'string') {
				// If direct property exists on target, return it (preserve numbers and methods)
				if (prop in target && !isValidToken(prop)) {
					return target[prop];
				}
				// Swizzle pattern: sequence of valid letters
				const letters = prop.replace(/\s+/g, '');
				if (isValidToken(letters)) {
					const comps: any[] = [];
					for (let i = 0; i < letters.length; i++) {
						const ch = letters[i];
						comps.push(getComp(target, ch));
					}
					// single component -> return value
					if (comps.length === 1) return comps[0];
					// multi-component -> return either a plain array or another swizzlable
					if (opts?.returnArray) return comps;
					return swizzlable(comps);
				}
			}
			// fallback to default behaviour
			return target[prop];
		},
		set(target, prop, value, _receiver) {
			if (typeof prop === 'string') {
				const letters = prop.replace(/\s+/g, '');
				if (isValidToken(letters)) {
					// Accept value as array-like or object with component names
					const vals: any[] = [];
					if (Array.isArray(value)) {
						for (let i = 0; i < value.length; i++) vals.push(value[i]);
					} else if (typeof value === 'object' && value !== null) {
						for (let i = 0; i < letters.length; i++) {
							const ch = letters[i];
							// try common component names on the provided object
							const propNames = [
								ch === 'x' || ch === 'r' ? 'x' : undefined,
								ch === 'y' || ch === 'g' ? 'y' : undefined,
								ch === 'z' || ch === 'b' ? 'z' : undefined,
								ch === 'w' || ch === 'a' ? 'w' : undefined
							].filter(Boolean);
							let found = false;
							for (const pn of propNames) {
								if (value[pn] !== undefined) { vals.push(value[pn]); found = true; break; }
							}
							if (!found) {
								// fallback numeric index on the provided object
								if (value[i] !== undefined) { vals.push(value[i]); found = true; }
							}
							if (!found) vals.push(undefined);
						}
					} else {
						// single primitive value -> broadcast to all components
						for (let i = 0; i < letters.length; i++) vals.push(value as number);
					}
					// write back into target using mapping or default behaviour
					for (let i = 0; i < letters.length; i++) {
						const ch = letters[i];
						if (vals[i] === undefined) continue;
						setComp(target, ch, vals[i]);
					}
					return true;
				}
			}
			// default set
			target[prop] = value;
			return true;
		}
	};

	return new Proxy(vec, handler);
}
