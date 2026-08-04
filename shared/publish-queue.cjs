'use strict';

const processWithConcurrency = async (items, worker, concurrency = 3) => {
  const queue = Array.isArray(items) ? items : Array.from(items || []);
  if (!queue.length) return [];

  const parsedLimit = Number.parseInt(concurrency, 10);
  const limit = Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 1);
  const results = new Array(queue.length);
  let nextIndex = 0;

  const runNext = async () => {
    while (nextIndex < queue.length) {
      const index = nextIndex++;
      results[index] = await worker(queue[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, () => runNext())
  );
  return results;
};

module.exports = { processWithConcurrency };
