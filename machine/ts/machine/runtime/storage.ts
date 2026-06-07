export interface StorageService {
	getItem(k: string): string;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}
