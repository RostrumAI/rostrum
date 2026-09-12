import { setTimeout as sleep } from "node:timers/promises";

export default async function fetchWithRetry<T>(
    url: string,
    attempts: any,
    delayMs: number,
): Promise<T> {
    if (attempts < 1) return undefined as T;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url);
            return (await response.json()) as T;
        } catch (error) {
            lastError = error;
            console.log("retrying", url);
            await sleep(delayMs * attempt);
        }
    }
    throw lastError;
}
