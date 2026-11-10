export async function mapConcurrent<T, Result>(
  items: readonly T[],
  mapper: (item: T) => Promise<Result>,
  concurrency = 4,
): Promise<Result[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer.')
  }

  const results: Result[] = []
  for (let start = 0; start < items.length; start += concurrency) {
    const batch = await Promise.all(items.slice(start, start + concurrency).map(mapper))
    results.push(...batch)
  }
  return results
}
