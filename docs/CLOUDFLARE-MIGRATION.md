# Kế hoạch migrate Máy Game sang Cloudflare Pages

> Ngày lập: 27/11/2026  
> Nhánh: `feature/cloudflare-core`  
> Trạng thái: preview đã pass; đang chuyển production.  
> **Cập nhật 27/11/2026:** đã chốt **bỏ GitHub Pages**, không banner và không thông báo migrate. Phase C legacy bên dưới không thực hiện. Production: https://may-game.pages.dev/.

Tài liệu này là kế hoạch thực thi. Bối cảnh và các lựa chọn ban đầu nằm ở
[May-Game_Cloudflare_Migration_Plan.md](../May-Game_Cloudflare_Migration_Plan.md).

## 0. Quyết định đã chốt

| Hạng mục | Quyết định |
| --- | --- |
| Host | Cloudflare Pages Free + Direct Upload |
| Project | Một project `may-game`; **không** tách portal/PvZ |
| PvZ trên Cloudflare | Core-only: `main.pak` + `properties/`; bỏ `hd/`, `wide/` |
| `main.pak` | Chunk 20 MiB → 3 phần; loader ghép trước khi start |
| Save | Save cũ không chuyển; trang migrate đã xóa |
| GitHub Pages | Bỏ; không banner, không redirect, không thông báo migrate |
| R2 | Không dùng; `.wasm` 7.0 MiB; `source.zip` 33.5 MiB → GitHub Release |
| Origin | `may-game.pages.dev` (chốt; không custom domain) |

## 1. Hiện trạng

Đã có trên nhánh:

- [games/pvz-goty/quality.js](../games/pvz-goty/quality.js) — đọc `mainPak.parts`, validate, ghép thành `File("main.pak")`; manifest cũ vẫn chạy.
- [scripts/pvz/trim-pvz.cjs](../scripts/pvz/trim-pvz.cjs) — bỏ `hd/`/`wide/` khỏi output; giữ `wide/images/titlescreen.png` cho thẻ catalog.
- [scripts/pvz/chunk-main-pak.cjs](../scripts/pvz/chunk-main-pak.cjs) — chia `main.pak`, cập nhật manifest/revision, idempotent.
- [scripts/check-static.py](../scripts/check-static.py) — preflight 25 MiB/file, 20.000 file, chặn path dev.
- [scripts/deploy-cloudflare.sh](../scripts/deploy-cloudflare.sh) — trim → chunk → preflight → Wrangler.
- Test: `tests/pvz-chunk-check.cjs`, `tests/pvz-trim-check.cjs`, `tests/browser/pvz-chunk.spec.js`.

Số đo trên dữ liệu thật:

```text
Trước: 469 files | 86.42 MiB | main.pak 42.84 MiB  (vượt 25 MiB)
Sau trim: 5 core resources + card image
Sau chunk: main.pak.001 20.00 MiB, .002 20.00 MiB, .003 2.84 MiB
Preflight: 10 files | 44.06 MiB | pass
```

Test local: `npm run check`, `npm test`, `npm run test:browser` (97 passed).

**Artifact 27/11/2026 (run 45908417143):** `.site` 130 MB; `.wasm` 7.0 MiB; `source.zip` 33.5 MiB (>25 MiB) đã phát hành tại [GitHub Release](https://github.com/NCQH/May-Game/releases/tag/cloudflare-pvz-source-2026-11-27) và bỏ khỏi output Cloudflare; `main.pak` 42.84 MiB đã chunk. Đã test engine PvZ thật ở local và preview: start, canvas, 0 console error, 0 request 4xx. Preview payload: 7 file data / 42.85 MiB, không tải `hd/`/`wide/`.

## 2. Nguyên tắc

1. Save cũ trên `ncqh.github.io` không được chuyển; đã chấp nhận theo quyết định 27/11/2026.
2. Preview và production là **hai origin khác nhau**; chỉ dùng preview để test, không hướng dẫn import save vào preview.
3. Không publish file dev (tests, scripts, docs, plan) nếu không cần.
4. Giữ một bản `.site` backup và artifact để rollback; GitHub Pages đã bỏ.
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
| `.wasm` >25 MiB | **Go/no-go**: đánh giá R2 + Worker cho riêng file wasm, hoặc hoãn. GitHub Pages đã bỏ. |
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
- [ ] Home, catalog, 10 game còn lại.

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
| PvZ core | Start ~43 MB, nền gốc, menu, fullscreen |
| Save transfer | Không thực hiện; save cũ không chuyển |
| PvZ save | Tuỳ chọn: nút export/import hoạt động |
| Cache | Xóa cache/IndexedDB, tải lại; revision mới hoạt động |
| Thiết bị | 320×568, 390×844, 844×390, 1366×768, 1920×1080 |
| Network | Không 404, không HTML trả cho JS/WASM, không CORS |
| Console | Không lỗi; cảnh báo MIME/audio được ghi lại |
| Hiệu năng | Ghi first load bytes/time, warm load, RAM; so baseline trước migration |
| Source | `source.zip` tải được (hoặc link Release) |

### B4. Nghiệm thu preview

- [ ] Không lỗi nghiêm trọng so với bản cũ.
- [ ] First load PvZ khoảng 43 MB, không tải `hd/`/`wide/`.
- [ ] (Tuỳ chọn) nút save PvZ hoạt động; không chuyển save người dùng.
- [ ] Origin production `may-game.pages.dev`; không custom domain.

## 5. Phase C — Bỏ GitHub Pages (đã chốt)

Không giữ legacy, không banner, không redirect, không thông báo migrate. Save cũ trên `ncqh.github.io` không được chuyển; trang migrate đã xóa.

- [ ] Merge `feature/cloudflare-core` vào `main`.
- [ ] Deploy production Cloudflare (Phase D).
- [ ] Tắt GitHub Pages: Settings → Pages → Source: None, hoặc `gh api -X DELETE repos/NCQH/May-Game/pages`.
- [ ] Xác nhận `https://ncqh.github.io/May-Game/` không còn phục vụ.
- [ ] Không thêm banner/redirect/thông báo trên site cũ.

## 6. Phase D — Cutover production

1. Origin production: `may-game.pages.dev`. Không thêm custom domain sau này nếu muốn giữ save Cloudflare (đổi origin = mất save).
2. Deploy production:

   ```bash
   bash scripts/deploy-cloudflare.sh may-game main
   ```

3. Dùng URL production, xóa cache, chạy lại smoke test Phase B3 (home, PvZ, migrate page, 404).
4. Cập nhật README/link chia sẻ; **không** thêm banner hay thông báo migrate.
5. Tắt GitHub Pages sau khi production ổn (Phase C).

## 7. Phase E — Dọn dẹp và tự động hóa

- GitHub Pages đã tắt; workflow Pages đã xóa.
- Tùy chọn: thêm workflow Cloudflare dùng `CLOUDFLARE_API_TOKEN`; chỉ deploy production từ `main`, không từ PR.
- Tùy chọn: publish allowlist để `.site` không chứa `tests/`, `scripts/`, `docs/`, plan, config dev.
- Tùy chọn: bỏ `hd/`/`wide/` khỏi Git nếu không cần bản full nữa; backup trước.
- Tùy chọn: thêm `_headers` khi đã có content hash; không dùng `immutable` cho `data/` hiện tại.

## 8. Rollback

| Sự cố | Cách xử lý |
| --- | --- |
| Lỗi portal/PvZ trên Cloudflare | Dashboard → Deployments → rollback bản trước; kiểm tra lại |
| Lỗi sau khi đổi manifest/revision | Deploy lại `.site` backup; cache IndexedDB tự tải revision mới |
| Save sai/hỏng | Khôi phục JSON/ZIP đã export; không xóa save mới |
| Custom domain/DNS lỗi | Giữ `pages.dev`; rollback DNS |
| Toàn bộ Cloudflare lỗi | Dùng bản `.site` backup và rollback deployment; không còn GH Pages |

## 9. Rủi ro

| Rủi ro | Mức | Biện pháp |
| --- | --- | --- |
| `.wasm` >25 MiB | Cao | Đo ở A3; nếu vượt, R2/Worker hoặc hoãn |
| `source.zip` >25 MiB | Cao | GitHub Release + link; cập nhật ASSETS |
| Mất save do đổi origin | Đã chấp nhận | Không thông báo/không chuyển save |
| Preview khác production origin | Trung bình | Chỉ dùng preview để test; không import save |
| Custom domain thêm sau | Cao | Đã chốt `may-game.pages.dev`; không thêm domain |
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
| Ngày 2 | Merge lên main, deploy production, tắt GitHub Pages |
| Sau đó | Theo dõi production; không giữ legacy |

## 11. Definition of Done

- [ ] Artifact không có file >25 MiB; `.wasm` và `source.zip` đã xử lý.
- [ ] Preview pass test matrix; PvZ core chạy.
- [ ] Production deploy từ `main`; origin `may-game.pages.dev`.
- [ ] GitHub Pages đã tắt; workflow Pages đã xóa; không banner/thông báo.
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

- Chấp nhận PvZ core-only lâu dài, hay chỉ trong giai đoạn đầu?
- Có thêm publish allowlist trước khi deploy production không?
- Có thêm workflow CI deploy Cloudflare sau này không?
