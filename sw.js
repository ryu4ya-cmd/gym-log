// 筋トレ記録: オフライン用 Service Worker
// アプリ本体をiPhoneの中に保存し、GitHubやネットが止まっていても起動できるようにする。
const CACHE = "gymlog-shell-v1";
const FONT_CACHE = "gymlog-fonts-v1";
const SHELL = ["./", "./manifest.webmanifest", "./icons/app-icon-180.png"];
const INDEX = new URL("./", self.location).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 正常に取れたときだけ保存する（GitHubのエラーページで上書きしない）
async function fetchAndStore(req, key) {
  const res = await fetch(req, { cache: "no-store" });
  if (res && res.ok && res.type === "basic") {
    const c = await caches.open(CACHE);
    await c.put(key, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: 一度読めたら保存しておく（なくても代わりの文字で動く）
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(FONT_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }
        catch (err) { return new Response("", { status: 504 }); }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  // 新しい版の確認はそのままネットへ（落ちていれば失敗するだけ）
  if (url.searchParams.has("check")) return;

  const isPage = req.mode === "navigate" || url.href.split("?")[0] === INDEX || url.pathname.endsWith("/index.html");
  if (isPage) {
    if (url.searchParams.has("v")) {
      // 「最新版に更新」: ネットを優先、だめなら保存してある版
      e.respondWith(fetchAndStore(req, INDEX).then((r) => (r.ok ? r : caches.match(INDEX).then((h) => h || r))).catch(() => caches.match(INDEX)));
      return;
    }
    // ふだんの起動: 保存してある版をすぐ出し、裏で新しい版を取りにいく
    e.respondWith(
      caches.match(INDEX).then((hit) => {
        const net = fetchAndStore(req, INDEX).catch(() => null);
        if (hit) { e.waitUntil(net); return hit; }
        return net.then((r) => r || new Response("オフラインです。一度ネットにつないで開いてください。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
      })
    );
    return;
  }

  // そのほかの同じサイトのファイル: 保存版 → なければネット
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetchAndStore(req, req).catch(() => new Response("", { status: 504 })))
  );
});
