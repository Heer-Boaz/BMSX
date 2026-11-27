export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	Type = 5,

	Error = 6,

	CoroutineResume = 7,
	CoroutineYield = 8,
	CoroutineStatus = 9,
	CoroutineRunning = 10,
	GetGlobal = 11,
	FrameCount = 12,
	GetFrameRegister = 13,
	SetFrameRegister = 14,
	GetFrameUpvalue = 15,
	FrameHeader = 16,
	NumberType = 17,
	StringFromBytes = 18,
}

export const BUILTIN_FUNCTION_COUNT = 19;
