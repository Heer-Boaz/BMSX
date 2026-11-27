export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	Type = 5,

	Error = 6,

	CoroutineStatus = 7,
	CoroutineRunning = 8,
	GetGlobal = 9,
	FrameCount = 10,
	GetFrameRegister = 11,
	SetFrameRegister = 12,
	GetFrameUpvalue = 13,
	FrameHeader = 14,
	NumberType = 15,
	StringFromBytes = 16,
}

export const BUILTIN_FUNCTION_COUNT = 17;
