// Этот обработчик включается в SW как отдельный хешированный скрипт.
// Ожидающий SW ещё не управляет страницами: нужны includeUncontrolled и scope.
export function updateGuardSource(releaseNotes: unknown): string {
  const serializedNotes = JSON.stringify(releaseNotes).replace(/</g, '\\u003c');
  return `
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (!['PB_UPDATE_CHECK', 'PB_UPDATE_ACTIVATE', 'PB_RELEASE_NOTES'].includes(type) || !event.ports[0] || !event.source) return;
  event.waitUntil((async () => {
    try {
      if (type === 'PB_RELEASE_NOTES') {
        event.ports[0].postMessage({ ok: true, releaseNotes: ${serializedNotes} });
        return;
      }
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .filter((client) => client.url.startsWith(self.registration.scope));
      if (windows.length !== 1 || windows[0].id !== event.source.id) {
        event.ports[0].postMessage({ ok: false, reason: 'other-windows' });
        return;
      }
      if (type === 'PB_UPDATE_ACTIVATE') await self.skipWaiting();
      event.ports[0].postMessage({ ok: true });
    } catch {
      event.ports[0].postMessage({ ok: false, reason: 'unavailable' });
    }
  })());
});
`;
}
