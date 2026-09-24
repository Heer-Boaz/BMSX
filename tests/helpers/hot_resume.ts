import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import type { HotResumeRevision } from '../../ide/runtime/hot_resume_relocation';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';

export function identityHotResumeRevision(image: Blua32ImageLayout): HotResumeRevision {
	const functionAddresses = new Uint32Array(image.functions.length);
	for (let index = 0; index < image.functions.length; index += 1) {
		functionAddresses[index] = image.functions[index].address;
	}
	const pcAddresses = new Int32Array(image.header.textByteCount / INSTRUCTION_BYTES);
	for (let index = 0; index < pcAddresses.length; index += 1) {
		pcAddresses[index] = image.header.textAddress + index * INSTRUCTION_BYTES;
	}
	return {
		previousImage: image,
		revision: { functionAddresses, pcAddresses },
	};
}
