import type {
	Program,
	ProgramConstant,
	ProgramModuleExport,
	ProgramModuleProto,
	ProgramRuntimeSymbols,
	Proto,
} from './program';

export type ProgramObjectVectorTable = {
	resetProtoIndex: number;
	sectionInitProtoIndex: number;
	irqProtoIndex: number;
	exceptionProtoIndex: number;
};

export type ProgramStorageSymbol = {
	name: string;
	offset: number;
	byteCount: number;
	alignment: number;
};

export type ProgramRodataSymbol = ProgramStorageSymbol;
export type ProgramDataSymbol = ProgramStorageSymbol;
export type ProgramBssSymbol = ProgramStorageSymbol;

export type ProgramObjectDataSection = {
	bytes: Uint8Array;
	symbols: ProgramDataSymbol[];
};

export type ProgramObjectBssSection = {
	byteCount: number;
	symbols: ProgramBssSymbol[];
};

export type ProgramObjectSections = {
	text: {
		code: Uint8Array;
		protos: Proto[];
	};
	rodata: {
		constPool: ProgramConstant[];
		moduleProtos: ProgramModuleProto[];
		moduleExports: ProgramModuleExport[];
		staticModulePaths: string[];
		bytes: Uint8Array;
		symbols: ProgramRodataSymbol[];
	};
	data: ProgramObjectDataSection;
	bss: ProgramObjectBssSection;
};

export type ProgramIndexedConstRelocKind = 'bx' | 'rk_b' | 'rk_c' | 'const_b' | 'const_c' | 'gl' | 'sys';
export type ProgramSymbolicConstRelocKind = 'module' | 'export_proto' | 'module_init';

export type ProgramConstReloc =
	| { wordIndex: number; kind: ProgramIndexedConstRelocKind; constIndex: number }
	| { wordIndex: number; kind: ProgramSymbolicConstRelocKind; symbol: string };

export type ProgramConstValueReloc = {
	constIndex: number;
	kind: 'bss_addr' | 'data_addr' | 'data_lma_addr' | 'rodata_addr';
	symbol: string;
	addend: number;
};

export type ProgramRodataConstReloc = {
	byteOffset: number;
	constIndex: number;
};

export type ProgramObjectImage = {
	vectors: ProgramObjectVectorTable;
	sections: ProgramObjectSections;
	link: {
		constRelocs: ProgramConstReloc[];
		constValueRelocs: ProgramConstValueReloc[];
		rodataConstRelocs: ProgramRodataConstReloc[];
		symbols: ProgramRuntimeSymbols;
	};
};

export function encodeProgramObjectSections(
	program: Program,
	staticModulePaths: string[],
	data: ProgramObjectDataSection,
	bss: ProgramObjectBssSection,
	rodataBytes: Uint8Array,
	rodataSymbols: ProgramRodataSymbol[],
): ProgramObjectSections {
	return {
		text: { code: program.code, protos: program.protos },
		rodata: {
			constPool: program.constPool,
			moduleProtos: program.moduleProtos,
			moduleExports: program.moduleExports,
			staticModulePaths,
			bytes: rodataBytes,
			symbols: rodataSymbols,
		},
		data,
		bss,
	};
}
