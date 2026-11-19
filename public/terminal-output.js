'use strict';
(function(root) {
  // Batch incoming chunks, allowing only one parser write at a time.
  function createTerminalOutput(write, acknowledge = () => {}) {
    let queue = [], writing = false, timer = null, disposed = false;
    const waiters=[];
    const finishFlush=value=>{for(const resolve of waiters.splice(0))resolve(value);};
    function drain() {
      timer = null;
      if (disposed || writing || !queue.length) return;
      const generation = queue[0].generation;
      let parts = [], length = 0;
      while (queue.length && queue[0].generation === generation && length < 65536) {
        const chunk = queue.shift(); parts.push(chunk.data); length += chunk.data.length;
      }
      writing = true;
      write(parts.join(''), () => {
        acknowledge(length, generation);
        writing = false;
        if (!disposed && queue.length) timer = setTimeout(drain, 0);
        else finishFlush(!disposed);
      });
    }
    return {
      receive(data, generation) {
        if (disposed) return;
        queue.push({data, generation});
        if (!writing && timer === null) timer = setTimeout(drain, 0);
      },
      flush() { if(disposed)return Promise.resolve(false);if(!writing&&!queue.length)return Promise.resolve(true);return new Promise(resolve=>waiters.push(resolve)); },
      dispose() { disposed = true; clearTimeout(timer); queue = []; finishFlush(false); },
    };
  }
  if (typeof module !== 'undefined') module.exports = { createTerminalOutput };
  else root.createTerminalOutput = createTerminalOutput;
})(typeof window === 'undefined' ? globalThis : window);
