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

- `html5/offline.html` — entry web + màn hình boot + màn hình tạo nhân vật
- `html5/shim.js` — thay `fetch`/`WebSocket` bằng Worker + SAB; ghép catalog bị split; RPC tạo nhân vật
- `html5/offline-worker.js` — Pyodide + Python PvE server; tạo/cập nhật character; persist SQLite
- `html5/bangbang-py.zip` — server PvE + SQLite mẫu
- `html5/pyodide/` — Pyodide runtime
- `html5/*.partN` — phần của catalog lớn (>25 MiB), ghép nguyên bytes bởi shim
- `html5/` + `rez/` — client/asset đã trim theo request thực tế của map 201 + lobby

## Giới hạn / lưu ý

- Asset: **14.985 file / ~2.4 GB**; tất cả file < 25 MiB; tổng file vẫn dưới 20.000 của Pages Free.
- Đã thêm toàn bộ asset **tank + màn hình game**: battle scenes, HUD, PvE/PvP map, tank model, skill SWF, portrait/avatar, icon, NPC/map effects.
- **Chỉ cắt logic** của bạn bè, cộng đồng, chat, nạp tiền/recharge/VIP ad; **UI vẫn giữ nguyên** (nút disabled/“chưa mở”, panel chat trang trí). Giữ PvE/lobby/garage/shop/postmatch và toàn bộ map/tank.
- `m5_asset_catalog` bị bỏ vì không có JS reference; `m4_asset_catalog` được giữ lại.
- Dùng service worker cache-first: lần đầu preload essential trước màn hình tạo nhân vật, sau khi vào sảnh mới tải nền toàn bộ asset; tạm dừng khi rời sảnh (vào trận/garage/shop) để không tranh băng thông, và tiếp tục khi quay lại sảnh. Các lần sau đọc từ Cache Storage.
- Màn hình boot dùng splash art của client Godot (`html5/assets/boot/splash.png`) và thanh tiến trình gốc; hiển thị % theo từng giai đoạn: bộ nhớ đệm → asset thiết yếu → máy chủ → hồ sơ → tạo nhân vật.
- Không yêu cầu offline; service worker chỉ để tránh tải lại asset mỗi lần vào.
- Server PvE chạy trong Pyodide; PvP/guild/economy vẫn còn trong client/server nhưng chưa test trên web.
- Checkpoint SQLite vẫn cần giảm tần suất nếu chơi dài.
- Quyền phân phối asset đã được người duy trì xác nhận.

## Cache

- `cache-manifest.json` liệt kê **15.195 URL asset**; `essential` (505 URL) được tải trước màn hình tạo nhân vật.
- Sau khi tạo nhân vật và sảnh hiện xong, trang tải nền toàn bộ `assets` vào Cache Storage; badge góc phải hiển thị tiến độ. Cache nền tạm dừng khi rời sảnh và tự tiếp tục khi quay lại.
- Lần sau, service worker trả asset từ cache; reload không tải lại 2,4 GB.
- Khi asset thay đổi, chạy lại `node scripts/bangbang/build-cache-manifest.cjs` và tăng cache version trong `sw.js`.

## Test local

Playwright: mở trang → tạo nhân vật → vào sảnh → PvE map 201 → battle. Reload → màn hình tạo nhân vật prefill tên/body từ SQLite/IndexedDB. Ảnh tham chiếu: `assets/covers/bangbang.webp`.
