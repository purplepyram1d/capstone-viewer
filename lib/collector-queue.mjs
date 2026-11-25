// Bound the number of network requests without making a slow provider hold up unrelated feeds.
export function createCollectorQueue({run, onChange=()=>{}, onError=()=>{}, limit=10, perHost=3}) {
  const waiting = new Map();
  const active = new Map();
  const hosts = new Map();
  let stopped = false;

  function drain() {
    if (stopped) return;
    for (const [id,task] of waiting) {
      if (active.size>=limit) break;
      const count = hosts.get(task.host) || 0;
      if (count>=perHost) continue;
      waiting.delete(id);
      active.set(id,task);
      hosts.set(task.host,count+1);
      void Promise.resolve().then(()=>run(task)).catch(error=>onError(task,error)).finally(()=>{
        active.delete(id);
        const remaining = hosts.get(task.host)-1;
        if (remaining) hosts.set(task.host,remaining);
        else hosts.delete(task.host);
        if (!stopped) {
          drain();
          onChange();
        }
      });
    }
  }
  return {
    get busy() { return waiting.size>0 || active.size>0; },
    has: id=>waiting.has(id) || active.has(id),
    queued: id=>waiting.has(id),
    polling: id=>active.has(id),
    add(tasks) {
      if (stopped) return;
      for (const task of tasks) if (!waiting.has(task.id) && !active.has(task.id)) waiting.set(task.id,task);
      drain();
      onChange();
    },
    remove(id) {
      if (waiting.delete(id) && !stopped) { drain(); onChange(); }
    },
    stop() { stopped = true; waiting.clear(); }
  };
}
