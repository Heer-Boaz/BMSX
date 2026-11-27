export const enum BuiltinFunctionId {
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	RawSet = 5,
	Select = 6,
	Type = 7,

	Error = 8,
	PCall = 9,
	XPCall = 10,
	CoroutineResume = 11,
	CoroutineYield = 12,
	CoroutineStatus = 13,
	CoroutineRunning = 14,
	CoroutineIsYieldable = 15,
	GetGlobal = 16,
	FrameCount = 17,
	GetFrameRegister = 18,
	SetFrameRegister = 19,
	GetFrameUpvalue = 20,
	FrameHeader = 21,
	NumberType = 22,
	StringFromBytes = 23,
}

export const BUILTIN_FUNCTION_COUNT = 24;
