export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	Error = 5,
	CoroutineStatus = 6,
	CoroutineRunning = 7,
	GetGlobal = 8,
	FrameCount = 9,
	GetFrameRegister = 10,
	SetFrameRegister = 11,
	GetFrameUpvalue = 12,
	FrameHeader = 13,
	StringFromBytes = 14,
}

export const BUILTIN_FUNCTION_COUNT = 15;
