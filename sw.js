// オフライン機能は廃止しました。
// 以前このファイル(サービスワーカー)を入れたブラウザのために、ここでは
// 「自分自身の登録を解除し、残っているキャッシュを全部消して、画面を読み直す」だけを行う。
// これで古いデータを掴んだままになる事故を解消する。
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
