export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	Select = 5,
	Type = 6,

	Error = 7,
	PCall = 8,
	XPCall = 9,
	CoroutineResume = 10,
	CoroutineYield = 11,
	CoroutineStatus = 12,
	CoroutineRunning = 13,
	CoroutineIsYieldable = 14,
	GetGlobal = 15,
	FrameCount = 16,
	GetFrameRegister = 17,
	SetFrameRegister = 18,
	GetFrameUpvalue = 19,
	FrameHeader = 20,
	NumberType = 21,
	StringFromBytes = 22,
}

export const BUILTIN_FUNCTION_COUNT = 23;
