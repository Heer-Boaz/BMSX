export type IrqControllerState = {
	mask: number;
	pendingFlags: number;
	userMask: number;
	userPendingFlags: number;
	supervisorContextActive: boolean;
};
