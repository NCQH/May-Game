# Bang Bang Web

Bản PvE/PvP chạy trực tiếp trên web: client HTML5 gốc + JS engine tĩnh + fake socket, không cần Python server. Pyodide chỉ còn là fallback tùy chọn. Dùng online trên Cloudflare Pages; service worker cache asset, không yêu cầu offline.

## Chạy local

```bash
node scripts/bangbang/serve.cjs
```

Mở:

```text
http://127.0.0.1:18086/games/bangbang/html5/
```

`scripts/bangbang/serve.cjs` maps `/html5/*` → `games/bangbang/html5/*` và `/rez/*` → `games/bangbang/rez/*`, đồng thời set COOP/COEP để SharedArrayBuffer hoạt động.

## Tạo nhân vật

- Mở `index.html`: màn hình **Tạo nhân vật** thay cho đăng nhập.
- Chọn body từ `m8_account_catalog` (boy/girl/body), nhập tên, bấm **Vào sảnh**.
- Lưu hồ sơ JS (`pve-profile`, `pve-bag`) trong IndexedDB; reload sẽ prefill lại.
- Save SQLite của bản Pyodide cũ được migrate một lần trước khi worker khởi động.
- Tank khởi đầu được đặt về Naruto (10000044) để khớp bộ asset đã trim; ngoại hình lấy từ tank đang chọn và fallback về base skin nếu catalog M6 không hỗ trợ.
- Không còn màn hình đăng nhập; `/api/session` tự đăng nhập tài khoản `offline`.

## Cấu trúc

- `html5/index.html` — entry web + màn hình boot + màn hình tạo nhân vật
- `html5/shim.js` — thay `fetch`/`WebSocket` bằng Worker + SAB; ghép catalog bị split; RPC tạo nhân vật
- `html5/static-server/worker.js` — JS engine mặc định: lobby, PvE 49 map, PvP với bot
- `html5/static-server/engine/` — arena, tank actions, PvE/PvP rules, `tank-visuals.json`
- `html5/static-server/migrate/` — migrate save SQLite cũ sang hồ sơ JS (sql.js, chỉ tải khi có DB cũ)
- `html5/offline-worker.js` + `html5/pyodide/` + `html5/bangbang-py.zip` — Pyodide fallback (`?engine=py`)
- `html5/*.partN` — phần của catalog lớn (>25 MiB), ghép nguyên bytes bởi shim
- `html5/` + `rez/` — client/asset đã trim theo request thực tế của map 201 + lobby

## Giới hạn / lưu ý

- Asset: **~18,6k file / ~2,6 GB**; tất cả file < 25 MiB; vẫn dưới 20.000 file của Pages Free.
- Đã thêm asset **tank + màn hình game**, sound, char, xml/module, avatar/icon/map/npc/swf đầy đủ, gồm PvP (`assets_m5`, `gui_summer`).
- **Chỉ cắt logic** của bạn bè, cộng đồng, chat, nạp tiền/recharge/VIP ad; **UI vẫn giữ nguyên** (nút disabled/“chưa mở”, panel chat trang trí). Giữ PvE/lobby/garage/shop/postmatch và toàn bộ map/tank.
- `m5_asset_catalog` bị bỏ vì không có JS reference; `m4_asset_catalog` được giữ lại.
- Dùng service worker cache-first: lần đầu preload essential trước màn hình tạo nhân vật, sau khi vào sảnh mới tải nền toàn bộ asset; tạm dừng khi rời sảnh (vào trận/garage/shop) để không tranh băng thông, và tiếp tục khi quay lại sảnh. Các lần sau đọc từ Cache Storage.
- Màn hình boot dùng splash art của client Godot (`html5/assets/boot/splash.png`) và thanh tiến trình gốc; hiển thị % theo từng giai đoạn: bộ nhớ đệm → asset thiết yếu → máy chủ → hồ sơ → tạo nhân vật.
- Không yêu cầu offline; service worker chỉ để tránh tải lại asset mỗi lần vào.
- Engine JS mặc định; Pyodide chỉ tải khi mở `?engine=py`/`bb-engine=py`.
- PvE: 49 map, objective chương 2–9, thưởng/cấp/thẻ lực lượng, mở thành phố. PvP: phòng bot, 91 tank, 7 mode. Guild/economy vẫn là UI hiện có nhưng chưa nối đầy đủ.
- Quyền phân phối asset đã được người duy trì xác nhận.

## Cache

- `cache-manifest.json` liệt kê **18.795 URL asset**; `essential` (312 URL, ~6,1 MiB) được cache trước; Pyodide (7 URL) chỉ tải khi `?engine=py`.
- Sau khi tạo nhân vật và sảnh hiện xong, trang tải nền phần còn lại vào Cache Storage; badge góc phải hiển thị tiến độ. Cache nền tạm dừng khi rời sảnh và tự tiếp tục khi quay lại.
- Lần sau, service worker trả asset từ cache; reload chỉ tải manifest và phần còn thiếu.
- Khi asset thay đổi, chạy lại `node scripts/bangbang/build-cache-manifest.cjs` và tăng cache version trong `sw.js`.

## Deploy riêng (Cloudflare Pages)

- Project: `may-game-bangbang`
- URL: https://may-game-bangbang.pages.dev/games/bangbang/html5/
- Build: `bash scripts/bangbang/build-site.sh` (tạo `.bangbang-site`)
- Deploy: `bash scripts/bangbang/deploy.sh may-game-bangbang`
- Workflow: `.github/workflows/bangbang.yml` (`workflow_dispatch` + push `games/bangbang/**`, `scripts/bangbang/**`, `sw.js`)
- Site chính `may-game` chỉ còn card catalog và redirect cũ; asset BangBang không còn nằm trong deployment chính.

## M6 static JS engine (mặc định)

- `static-server/worker.js` dựng lobby bằng frame AUTH/GATE đã chụp, **không tải Pyodide/bangbang-py.zip**.
- PvE: 49 map thường, objective chương 2–9, thưởng/cấp/thẻ lực lượng, mở thành phố, túi đồ.
- PvP: phòng bot 1001, map 19, 7 mode (kill/occupy/base/cow/death/escort/world boss), 91 tank.
- Save SQLite cũ được migrate sang `pve-profile`/`pve-bag` trước khi worker đọc IndexedDB.
- `tank-visuals.json` chọn ngoại hình có trong catalog M6; ngoại hình 0/không hỗ trợ fallback về base skin.
- Frame golden nằm ở `html5/static-server/frames.json` (AUTH S901/S906, GATE S1005/S1016/S1100/S1150/S1455/S1454/S1351/S1350/S1045).

## M7 hardening

- `engine/pve-all-maps.test.js` — 49 map: dữ liệu chuẩn hóa + 190 background/sky/minimap/gui có file và `status: ready`.
- `perf/smoke.cjs` — tạo nhân vật → sảnh → PvE map 201 (render `supported`) → PvP room → chọn tank → PvP scene (render `supported`) → reload ấm.
- `perf/migrate-e2e.cjs` — seed DB SQLite thật từ `bangbang-py.zip` vào IndexedDB, boot JS engine, kiểm tra 384 item + marker + reload không nhân đôi.
- Workflow `bangbang.yml` chạy các check trên trước bước deploy production.

## Test local

`npm test` chạy các check tĩnh. Browser: `node games/bangbang/html5/static-server/perf/smoke.cjs` và `node games/bangbang/html5/static-server/perf/migrate-e2e.cjs` (cần Playwright Chromium). Ảnh tham chiếu: `assets/covers/bangbang.webp`.
