import { setTimeout as sleep } from "node:timers/promises";

export default async function retry<T>(
    operation: () => Promise<T>,
    attempts: number,
    delayMs: number,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            await sleep(delayMs * attempt);
        }
    }
    throw lastError;
}
