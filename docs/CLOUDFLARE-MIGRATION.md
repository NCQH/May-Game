# Kế hoạch migrate Máy Game sang Cloudflare Pages

> Ngày lập: 27/11/2026  
> Nhánh: `feature/cloudflare-core` · Commit: `f9cadbd`  
> Trạng thái: phần code/local test đã xong; chưa build artifact, chưa deploy.

Tài liệu này là kế hoạch thực thi. Bối cảnh và các lựa chọn ban đầu nằm ở
[May-Game_Cloudflare_Migration_Plan.md](../May-Game_Cloudflare_Migration_Plan.md).

## 0. Quyết định đã chốt

| Hạng mục | Quyết định |
| --- | --- |
| Host | Cloudflare Pages Free + Direct Upload |
| Project | Một project `may-game`; **không** tách portal/PvZ |
| PvZ trên Cloudflare | Core-only: `main.pak` + `properties/`; bỏ `hd/`, `wide/` |
| `main.pak` | Chunk 20 MiB → 3 phần; loader ghép trước khi start |
| Save | `migrate.html` cho localStorage; PvZ dùng ZIP export/import |
| Legacy | Giữ GitHub Pages 2–4 tuần; không redirect cưỡng bức |
| R2 | Không dùng; `.wasm` 7.0 MiB; `source.zip` 33.5 MiB → GitHub Release |
| Origin | Chốt `may-game.pages.dev` hoặc custom domain **trước** production |

## 1. Hiện trạng

Đã có trên nhánh:

- [games/pvz-goty/quality.js](../games/pvz-goty/quality.js) — đọc `mainPak.parts`, validate, ghép thành `File("main.pak")`; manifest cũ vẫn chạy.
- [scripts/pvz/trim-pvz.cjs](../scripts/pvz/trim-pvz.cjs) — bỏ `hd/`/`wide/` khỏi output; giữ `wide/images/titlescreen.png` cho thẻ catalog.
- [scripts/pvz/chunk-main-pak.cjs](../scripts/pvz/chunk-main-pak.cjs) — chia `main.pak`, cập nhật manifest/revision, idempotent.
- [scripts/check-static.py](../scripts/check-static.py) — preflight 25 MiB/file, 20.000 file, chặn path dev.
- [scripts/deploy-cloudflare.sh](../scripts/deploy-cloudflare.sh) — trim → chunk → preflight → Wrangler.
- [migrate.html](../migrate.html) + [assets/js/save-transfer.js](../assets/js/save-transfer.js) — xuất/nhập `may-game:v1:*`; bỏ qua marker PvZ.
- Test: `tests/migrate-check.cjs`, `tests/pvz-chunk-check.cjs`, `tests/pvz-trim-check.cjs`, `tests/browser/migrate.spec.js`, `tests/browser/pvz-chunk.spec.js`.

Số đo trên dữ liệu thật:

```text
Trước: 469 files | 86.42 MiB | main.pak 42.84 MiB  (vượt 25 MiB)
Sau trim: 5 core resources + card image
Sau chunk: main.pak.001 20.00 MiB, .002 20.00 MiB, .003 2.84 MiB
Preflight: 10 files | 44.06 MiB | pass
```

Test local: `npm run check`, `npm test`, `npm run test:browser` (97 passed).

**Artifact 27/11/2026 (run 45908417143):** `.site` 130 MB; `.wasm` 7.0 MiB; `source.zip` 33.5 MiB (>25 MiB) đã phát hành tại [GitHub Release](https://github.com/NCQH/May-Game/releases/tag/cloudflare-pvz-source-2026-11-27) và bỏ khỏi output Cloudflare; `main.pak` 42.84 MiB đã chunk. Còn chờ test engine PvZ thật ở local/preview.

## 2. Nguyên tắc

1. Không làm mất save. Mọi thay đổi origin phải có export trước, import sau.
2. Preview và production là **hai origin khác nhau**. Test cơ chế save trên preview; import thật trên production.
3. Không publish file dev (tests, scripts, docs, plan) nếu không cần.
4. Luôn giữ GitHub Pages và một bản `.site` backup để rollback.
5. Không bật dịch vụ tính phí (R2, Workers trả phí, custom domain có phí) nếu chưa duyệt.
6. PvZ core-only là lựa chọn có chủ đích; `PVZ_FULL=1` là đường quay lại.

## 3. Phase A — Build artifact và kiểm tra (blocking)

### A1. Push nhánh và trigger build

```bash
git push -u origin feature/cloudflare-core
gh workflow run pvz-build.yml --ref feature/cloudflare-core
gh run watch
```

Lưu ý: `pvz-build.yml` chỉ tự chạy khi push lên `main`/`codex/pvz-goty-port` hoặc khi mở PR khớp `paths`. Push nhánh feature **không** tự trigger; dùng `workflow_dispatch` như trên, hoặc mở PR.

Build chạy Emscripten, timeout 45 phút. Deploy job bị skip vì ref không phải `main`.

### A2. Tải artifact

```bash
gh run list --workflow=pvz-build.yml --branch feature/cloudflare-core --limit 1
gh run download <run-id> -n may-game-pvz-goty-site -D .site
test -f .site/index.html && echo ok
```

Artifact giữ 14 ngày. Lưu một bản `.site` backup ra ngoài repo sau khi tải.

### A3. Audit output thật

```bash
cp -a .site /tmp/may-game-site-core
node scripts/pvz/trim-pvz.cjs /tmp/may-game-site-core
node scripts/pvz/chunk-main-pak.cjs /tmp/may-game-site-core
python3 scripts/check-static.py /tmp/may-game-site-core
```

Kết quả phải không còn file >25 MiB. Xử lý theo thứ tự:

| File | Hành động |
| --- | --- |
| `source.zip` >25 MiB | Đưa lên GitHub Release; thêm link trong trang PvZ/README; cập nhật ASSETS.md. Không xóa nghĩa vụ LGPL. |
| `.wasm` >25 MiB | **Go/no-go**: giữ PvZ trên GitHub Pages, hoặc đánh giá R2 + Worker cho riêng file wasm. Không tiếp tục preview cho đến khi chốt. |
| File khác >25 MiB | Tối ưu hoặc tách theo đúng loader; không chia ZIP tùy tiện. |

### A4. Test engine thật ở local

```bash
npx --yes http-server /tmp/may-game-site-core -p 8000 -c-1
# mở http://127.0.0.1:8000/games/pvz-goty/
```

Kiểm tra:

- [ ] PvZ tải ~43 MB, engine start, không có 404/console error.
- [ ] Bản core dùng nền/texture gốc (có thể có dải 4:3 trong khung 16:9).
- [ ] Menu, chọn màn, chơi, pause/restart.
- [ ] Save → export ZIP → import → reload.
- [ ] Home, catalog, 10 game còn lại, `migrate.html`.

Nếu `.wasm` MIME gây lỗi với server local, dùng `npx http-server` (đã set MIME) hoặc test trên preview; Cloudflare trả `application/wasm` đúng.

## 4. Phase B — Cloudflare preview

### B1. Tạo project

```bash
npx --yes wrangler@4.168.0 login
npx --yes wrangler@4.168.0 whoami
# Wrangler 4.168+ mặc định delegate Pages sang Workers; --force chỉ cần cho lần tạo đầu tiên.
npx --yes wrangler@4.168.0 pages project create may-game --production-branch main --force
```

Lưu ý: project `may-game` đã được tạo ngày 27/11/2026, nên không cần chạy lại lệnh create. Sau khi project tồn tại, `pages deploy` chạy trực tiếp trên Pages và **không** dùng `--force`. Free plan; Direct Upload không dùng build quota.

### B2. Deploy preview

```bash
bash scripts/deploy-cloudflare.sh may-game preview
```

Script tự chạy trim → chunk → preflight → deploy. Dùng URL preview Wrangler in ra. **Không** dùng origin preview cho đợt import save cuối cùng.

### B3. Test matrix

| Hạng mục | Điều kiện đạt |
| --- | --- |
| Portal | Home, catalog, search, keyboard, ảnh thẻ PvZ |
| 10 game nhỏ | Mở, chơi, pause, lưu/reload |
| PvZ core | Start ~43 MB, nền gốc, menu, save/export/import, fullscreen |
| Save transfer | Export localStorage ở GH Pages → import preview → reload |
| PvZ save | Export ZIP ở GH Pages → import preview → reload |
| Cache | Xóa cache/IndexedDB, tải lại; revision mới hoạt động |
| Thiết bị | 320×568, 390×844, 844×390, 1366×768, 1920×1080 |
| Network | Không 404, không HTML trả cho JS/WASM, không CORS |
| Console | Không lỗi; cảnh báo MIME/audio được ghi lại |
| Hiệu năng | Ghi first load bytes/time, warm load, RAM; so baseline GH Pages |
| Source | `source.zip` tải được (hoặc link Release) |

### B4. Nghiệm thu preview

- [ ] Không lỗi nghiêm trọng so với GH Pages.
- [ ] First load PvZ khoảng 43 MB, không tải `hd/`/`wide/`.
- [ ] Save export/import chạy trên preview.
- [ ] Có URL production dự kiến và quyết định custom domain.

## 5. Phase C — Chuyển save và legacy

### C1. Đưa trang export lên origin cũ

Merge `feature/cloudflare-core` vào `main` để GitHub Pages có `migrate.html` và `quality.js` mới (vẫn full asset). Chờ build/deploy xong, kiểm tra:

```text
https://ncqh.github.io/May-Game/migrate.html
```

Bản GH Pages vẫn dùng manifest cũ (`main.pak` đầy đủ), loader mới tương thích ngược.

### C2. Dry run

1. Trên GH Pages: xuất JSON localStorage + ZIP save PvZ.
2. Import vào preview, kiểm tra từng game.
3. Xóa dữ liệu preview; **import lại trên production** sau cutover.

Không hướng dẫn người chơi import vào preview.

### C3. Thông báo trên legacy

- Thêm banner chỉ hiện trên `ncqh.github.io` (kiểm tra `location.hostname`), dẫn đến `migrate.html` và địa chỉ mới.
- Không redirect cưỡng bức trước khi người chơi có cơ hội export.
- Nội dung: xuất save, PvZ ZIP, link site mới, thời gian giữ legacy.

### C4. Kiểm tra save

- [ ] 10 game: `bestScore`, `current`, `last-played`, mute.
- [ ] PvZ: save IDB qua ZIP; tài nguyên tải lại trên origin mới.
- [ ] Trường hợp storage bị chặn/private mode: thông báo rõ, không crash.
- [ ] Backup dữ liệu hiện tại trước khi import ghi đè.

## 6. Phase D — Cutover production

1. Chốt origin cuối: `may-game.pages.dev` hoặc custom domain. **Thêm custom domain sau này = đổi origin = mất save**, nên quyết định trước.
2. Deploy production:

   ```bash
   bash scripts/deploy-cloudflare.sh may-game main
   ```

3. Dùng URL production, xóa cache, chạy lại smoke test Phase B3.
4. Import save thật trên production; kiểm tra reload.
5. Cập nhật README/link chia sẻ; thêm banner legacy; thông báo.
6. Giữ GH Pages 2–4 tuần; theo dõi lỗi và phản hồi.

## 7. Phase E — Dọn dẹp và tự động hóa

- Sau 2–4 tuần: quyết định giữ legacy làm landing/export hay redirect.
- Tùy chọn: thêm workflow Cloudflare dùng `CLOUDFLARE_API_TOKEN`; chỉ deploy production từ `main`, không từ PR.
- Tùy chọn: publish allowlist để `.site` không chứa `tests/`, `scripts/`, `docs/`, plan, config dev.
- Tùy chọn: bỏ `hd/`/`wide/` khỏi Git sau khi legacy ngừng cần; backup trước.
- Tùy chọn: thêm `_headers` khi đã có content hash; không dùng `immutable` cho `data/` hiện tại.

## 8. Rollback

| Sự cố | Cách xử lý |
| --- | --- |
| Lỗi portal/PvZ trên Cloudflare | Dashboard → Deployments → rollback bản trước; kiểm tra lại |
| Lỗi sau khi đổi manifest/revision | Deploy lại `.site` backup; cache IndexedDB tự tải revision mới |
| Save sai/hỏng | Khôi phục JSON/ZIP đã export; không xóa save mới |
| Custom domain/DNS lỗi | Giữ `pages.dev`; rollback DNS |
| Toàn bộ Cloudflare lỗi | GH Pages legacy vẫn chạy; dùng artifact backup |

## 9. Rủi ro

| Rủi ro | Mức | Biện pháp |
| --- | --- | --- |
| `.wasm` >25 MiB | Cao | Đo ở A3; nếu vượt, giữ PvZ trên GH Pages hoặc R2/Worker |
| `source.zip` >25 MiB | Cao | GitHub Release + link; cập nhật ASSETS |
| Mất save do đổi origin | Cao | Export/import; legacy 2–4 tuần |
| Preview khác production origin | Cao | Chỉ import thật trên production |
| Custom domain thêm sau | Cao | Chốt origin trước cutover |
| PvZ core-only khác giao diện cũ | Trung bình | QA; `PVZ_FULL=1` nếu không chấp nhận |
| Cache/revision sai | Trung bình | `cache: no-cache`, revision SHA-256, test xóa cache |
| Build 45 phút, artifact 14 ngày | Trung bình | Lưu `.site` backup; workflow_dispatch |
| File dev bị publish | Thấp | Publish allowlist hoặc chấp nhận |
| Pháp lý asset | Đã xác nhận | Giữ ASSETS.md và bằng chứng cho phép |

## 10. Timeline đề xuất

| Thời điểm | Việc |
| --- | --- |
| Ngày 0 | Push nhánh, build artifact (45 phút), audit `.site` |
| Ngày 0 | Test engine thật ở local |
| Ngày 1 | Tạo project, deploy preview, chạy test matrix |
| Ngày 2 | Dry run save, merge lên main, banner legacy |
| Ngày 2 | Deploy production, import save thật |
| Tuần 2–4 | Giữ legacy, theo dõi, dọn dẹp |

## 11. Definition of Done

- [ ] Artifact không có file >25 MiB; `.wasm` và `source.zip` đã xử lý.
- [ ] Preview pass test matrix; PvZ core chạy, save export/import OK.
- [ ] Production deploy từ `main`; origin cuối đã chốt.
- [ ] Save thật import thành công trên production.
- [ ] Banner legacy + hướng dẫn export; GH Pages giữ 2–4 tuần.
- [ ] Rollback đã thử ít nhất một lần.
- [ ] Không bật dịch vụ tính phí ngoài dự kiến.
- [ ] README/ASSETS/PvZ README cập nhật.

## 12. Lệnh nhanh

```bash
# Build artifact
git push -u origin feature/cloudflare-core
gh workflow run pvz-build.yml --ref feature/cloudflare-core
gh run watch
gh run download <run-id> -n may-game-pvz-goty-site -D .site

# Audit + local engine
cp -a .site /tmp/may-game-site-core
node scripts/pvz/trim-pvz.cjs /tmp/may-game-site-core
node scripts/pvz/chunk-main-pak.cjs /tmp/may-game-site-core
python3 scripts/check-static.py /tmp/may-game-site-core
npx --yes http-server /tmp/may-game-site-core -p 8000 -c-1

# Cloudflare
npx --yes wrangler@4.168.0 login
npx --yes wrangler@4.168.0 pages project create may-game --production-branch main --force
bash scripts/deploy-cloudflare.sh may-game preview
# sau khi nghiệm thu:
bash scripts/deploy-cloudflare.sh may-game main

# Full HD/widescreen (nếu đổi quyết định)
PVZ_FULL=1 bash scripts/deploy-cloudflare.sh may-game preview
```

## 13. Quyết định còn mở

- Có push nhánh và build artifact ngay không?
- Origin cuối: `may-game.pages.dev` hay custom domain?
- Chấp nhận PvZ core-only lâu dài, hay chỉ trong giai đoạn đầu?
- Có thêm publish allowlist trước khi deploy production không?
- Có commit tài liệu kế hoạch này vào nhánh không?
