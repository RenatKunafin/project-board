// Минимальная запись плана в IndexedDB с замером полного цикла
// (open + put + complete). Имитация автосохранения ядра (PBT-010).

export function savePlanMeasured(key: string, plan: unknown): Promise<number> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const open = indexedDB.open('load-demo-idb', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('plans')) {
        open.result.createObjectStore('plans');
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('plans', 'readwrite');
      tx.objectStore('plans').put(plan, key);
      tx.oncomplete = () => {
        const ms = performance.now() - t0;
        db.close();
        resolve(ms);
      };
      tx.onerror = () => {
        db.close();
        resolve(-1);
      };
    };
    open.onerror = () => resolve(-1);
  });
}

export function planBytes(plan: unknown): number {
  return JSON.stringify(plan).length;
}
