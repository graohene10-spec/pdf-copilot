// 长循环里隔一阵把主线程让出来：超过预算才让，让完接着跑。
// scheduler.yield() 让出后排在别的任务前面继续；没有它的环境退回 setTimeout。
/** @param {number} [budget] 毫秒 */
export function pacer(budget = 50) {
  let deadline = performance.now() + budget;
  return async () => {
    if (performance.now() < deadline) return;
    const scheduler = /** @type {any} */ (globalThis).scheduler;
    if (scheduler?.yield) await scheduler.yield(); else await new Promise(resolve => setTimeout(resolve, 0));
    deadline = performance.now() + budget;
  };
}
