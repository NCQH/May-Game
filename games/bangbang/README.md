# Bang Bang Web

Bản PvE chạy trực tiếp trên web: client HTML5 gốc + Pyodide Worker + fake socket, không cần Python server. Dùng online trên Cloudflare Pages; service worker cache asset, không yêu cầu offline.

## Chạy local

```bash
node scripts/bangbang/serve.cjs
```

Mở:

```text
http://127.0.0.1:18086/games/bangbang/html5/offline.html
```

`scripts/bangbang/serve.cjs` maps `/html5/*` → `games/bangbang/html5/*` và `/rez/*` → `games/bangbang/rez/*`, đồng thời set COOP/COEP để SharedArrayBuffer hoạt động.

## Tạo nhân vật

- Mở `offline.html`: màn hình **Tạo nhân vật** thay cho đăng nhập.
- Chọn body từ `m8_account_catalog` (boy/girl/body), nhập tên, bấm **Vào sảnh**.
- Lưu vào SQLite (`worlds.state` gồm `name`, `body`) và persist database sang IndexedDB; reload sẽ prefill lại.
- Tank khởi đầu được đặt về Naruto (10000044) để khớp bộ asset đã trim.
- Không còn màn hình đăng nhập; `/api/session` tự đăng nhập tài khoản `offline`.

## Cấu trúc

- `html5/offline.html` — entry web + màn hình tạo nhân vật
- `html5/shim.js` — thay `fetch`/`WebSocket` bằng Worker + SAB; ghép catalog bị split; RPC tạo nhân vật
- `html5/offline-worker.js` — Pyodide + Python PvE server; tạo/cập nhật character; persist SQLite
- `html5/bangbang-py.zip` — server PvE + SQLite mẫu
- `html5/pyodide/` — Pyodide runtime
- `html5/*.partN` — phần của catalog lớn (>25 MiB), ghép nguyên bytes bởi shim
- `html5/` + `rez/` — client/asset đã trim theo request thực tế của map 201 + lobby

## Giới hạn / lưu ý

- Asset còn **942 file / ~250 MB**; tất cả file < 25 MiB, phù hợp Pages Free.
- **Chỉ cắt logic** của bạn bè, cộng đồng, chat, nạp tiền/recharge/VIP ad; **UI vẫn giữ nguyên** (nút disabled/“chưa mở”, panel chat trang trí). Giữ PvE/lobby/garage/shop/postmatch và toàn bộ map/tank.
- `m5_asset_catalog` bị bỏ vì không có JS reference; `m4_asset_catalog` được giữ lại.
- Dùng service worker cache-first: lần đầu preload essential trước màn hình tạo nhân vật, sau đó tải nền toàn bộ asset; các lần sau đọc từ Cache Storage.
- Không yêu cầu offline; service worker chỉ để tránh tải lại asset mỗi lần vào.
- Server PvE chạy trong Pyodide; PvP/guild/economy vẫn còn trong client/server nhưng chưa test trên web.
- Checkpoint SQLite vẫn cần giảm tần suất nếu chơi dài.
- Quyền phân phối asset đã được người duy trì xác nhận.

## Cache

- `cache-manifest.json` liệt kê toàn bộ asset hiện có; `essential` được tải trước màn hình tạo nhân vật.
- Sau khi tạo nhân vật, trang tải nền toàn bộ `assets` vào Cache Storage; badge góc phải hiển thị tiến độ.
- Lần sau, service worker trả asset từ cache; reload không tải lại 250 MB.
- Khi asset thay đổi, chạy lại `node scripts/bangbang/build-cache-manifest.cjs` và tăng cache version trong `sw.js`.

## Test local

Playwright: mở trang → tạo nhân vật → vào sảnh → PvE map 201 → battle. Reload → màn hình tạo nhân vật prefill tên/body từ SQLite/IndexedDB. Ảnh tham chiếu: `assets/covers/bangbang.webp`.
