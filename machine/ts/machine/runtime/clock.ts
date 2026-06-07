export type MonoTime = number;

export interface Clock {
	now(): MonoTime;
}
