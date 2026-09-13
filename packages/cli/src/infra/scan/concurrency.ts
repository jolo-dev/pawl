/**
 * Bounded-concurrency mapping.
 *
 * Scanners need one follow-up call per resource (tags, attributes) and an
 * account can hold hundreds. Sequential reads are too slow to be usable and
 * unbounded parallelism gets throttled, so every per-resource lookup goes
 * through here.
 */

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const effectiveLimit = Math.max(1, Math.min(limit, items.length));
	const results = new Array<R>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			const item = items[index];
			if (item === undefined) continue;
			results[index] = await mapper(item, index);
		}
	}

	await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
	return results;
}
