export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	Error = 5,
	CoroutineStatus = 6,
	CoroutineRunning = 7,
	FrameCount = 8,
	GetFrameRegister = 9,
	SetFrameRegister = 10,
	GetFrameUpvalue = 11,
	FrameHeader = 12,
}

export const BUILTIN_FUNCTION_COUNT = 13;
