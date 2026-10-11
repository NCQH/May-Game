# Plants vs. Zombies GOTY

## Giữ bản gốc

Giao diện bên trong game, bố cục, hình vẽ, animation, chữ, màu sắc, nhạc và hiệu ứng dùng dữ liệu GOTY gốc. Các thay đổi engine mới chỉ phục vụ chất lượng hiển thị và texture GPU. Màn hình upload đã ẩn; game tự khởi động bằng dữ liệu có sẵn. Không có launcher thiết kế mới hay hình catalog mới.

## Dữ liệu và save

Qua HTTP, game tự dùng tài nguyên đã nhớ trong IndexedDB hoặc tải danh sách `resources.json` và file trong `data/` cùng thư mục. Không yêu cầu chọn file. Để chuẩn bị local, chạy `node scripts/prepare-pvz-local.cjs "/path/to/GOTY"`; dữ liệu và manifest đều được Git bỏ qua. Bộ dữ liệu local không được upload; EXE không được nhập/chạy. Nên dùng bản GOTY 1.2.0.1073 EN; xem upstream về các bản ngôn ngữ/Steam khác.

Save engine dùng IDBFS riêng `/may-game-pvz-goty-saves`. Trong game, dùng Save and Exit để lưu màn đang chơi. Export Saves tải ZIP để sao lưu/chuyển thiết bị. Nhập save trước khi chơi. Xóa dữ liệu trình duyệt xóa cả tài nguyên và save.

## Chất lượng hình ảnh

Camera 16:9 rộng 1066⅔×600, đặt hệ tọa độ GOTY 800×600 ở giữa và quy đổi chuột theo đúng camera. Không kéo giãn cây, zombie hoặc thay đổi ô chơi. Framebuffer tự tăng theo màn hình và devicePixelRatio, tối đa 3840×2160; mức 1080p là 1920×1080. Nền widescreen được nạp riêng từ `wide/images/` và `wide/reanim/`, giữ nguyên kích thước resource logic của GOTY. Nền sân của mod rộng 1666 px, nền các màn 1066 px; không phản chiếu hai bên. Khi thiếu ảnh widescreen, giữ ảnh gốc và phần trống, không tạo cảnh giả. Chế độ lấy mẫu không tạo chi tiết AI.

Để chuẩn bị bộ nền local từ release HenryJk/PvZWidescreen 1.1.2, sau bước chuẩn bị GOTY chạy `node scripts/prepare-pvz-wide.cjs "/path/to/PvZWidescreen_1.1.2/main.pak"` (cần thư viện `sharp`). Script chỉ lấy 22 ảnh nền, giữ alpha; không thay `main.pak`, animation, âm thanh, EXE hoặc DLL của GOTY. Dữ liệu thêm và manifest đều được Git bỏ qua. Menu vẫn dùng animation GOTY, chỉ mở rộng hai lớp cảnh nền; các nút và phần Achievements/Zombatar giữ bản GOTY.

Manifest tự nạp cũng có thể chứa `hd/images/`, `hd/reanim/`, `hd/fonts/`. Shell upstream còn giữ công cụ nhập ẩn để tương thích nhưng không hiển thị trong luồng chơi. Texture HD dùng thư mục `images/`, `reanim/`, `fonts/`, hoặc `hd/` chứa các thư mục đó. Ví dụ gốc `images/background1.jpg` 800×600 có HD `images/background1.png` 1600×1200 hoặc 3200×2400. PNG/alpha mask giữ đúng bố cục và hình vẽ gốc. Texture sai kích thước, vượt giới hạn GPU hoặc ảnh đã bị sửa bằng phần mềm dùng đường gốc. Bộ HD không kèm theo.

URL `?renderHeight=1080` chọn framebuffer 1920×1080. Host cũng có thể chọn độ cao render bằng `MayGamePvzQuality.setRenderHeight(1080)` (600, 1080, 1440, 2160, auto), không thay menu GOTY.

## Build từ nguồn

Có Node 22, CMake, Ninja, Git, zip và Emscripten 4.0.23 đã activate trên Linux/WSL:

```sh
git clone https://github.com/wszqkzqk/PvZ-Portable.git .pvz-source
git -C .pvz-source checkout 141c1476dd462ac3526f796e303177616f4de6bc
git clone https://github.com/OpenMPT/openmpt.git .openmpt-source
git -C .openmpt-source checkout 327204eaa2c27bd1acbb571babe68f279c85238b
git clone https://github.com/Stuk/jszip.git .jszip-source
git -C .jszip-source checkout 0f2f1e4d0509514417db83fe5b86bde90e0ffe8d
bash scripts/build-pvz.sh
node scripts/prepare-pvz-local.cjs "/path/to/GOTY"
# Serve this checkout to include local-only resources.json and data/.
python3 -m http.server 8000
```

Chạy patcher trên checkout sạch. GitHub Actions làm các bước trên và xuất artifact **may-game-pvz-goty-site**. Artifact chứa `.site/`, engine, JSZip, license và `engine/source.zip` (nguồn engine đã sửa, dependency, bridge và scripts).

## Phát hành và nghiệm thu

Chưa deploy tự động. GitHub Pages xuất bản từ branch không có binary sinh ra: cần phát hành artifact đầy đủ sau review. Không thể xác nhận giống toàn bộ GOTY chỉ bằng build; đối chiếu các chế độ, save, input và asset theo docs/PVZ-GOTY-PLAN.md. Texture HD còn cần dữ liệu thật.

Bridge/patch mới: LGPL-3.0-or-later. Giữ license upstream/dependency và nguồn tương ứng khi phân phối. Quyền engine không cấp quyền phân phối tài nguyên GOTY.

Khi chưa nhập gói HD, renderer lấy chính pixel gốc để nội suy bicubic 2× cho texture tĩnh, xử lý alpha trước khi lấy mẫu và giữ ranh giới cel. Đây là nâng chất lượng lấy mẫu, không phải AI tạo chi tiết mới; ảnh tạo/sửa bằng phần mềm và ảnh vượt giới hạn GPU giữ đường gốc. Cần đối chiếu ảnh thực và hiệu năng trước khi phát hành.

## Widescreen tham chiếu

[HenryJk/PvZWidescreen v1.1.2](https://github.com/HenryJk/PvZWidescreen/tree/v1.1.2) mở chiều ngang logic từ 800 lên 1066 (PAD=133 mỗi bên), chỉnh Board, CutScene, menu, hội thoại và hit-test. Bản này vá tiến trình EXE Windows; bản web chuyển bố trí và việc nạp ảnh nền sang C++. Video cài HD Mod, PvZWidescreen rồi dùng `ddraw.dll`/`wined3d.dll` hỗ trợ fullscreen trên Windows. Engine web dùng WebGL; không chạy DLL Windows trong WebAssembly. Widescreen cần nghiệm thu đủ chế độ trước khi phát hành. Gói mod này chưa cung cấp nền mở rộng cho Zombatar của GOTY.

Artifact không có tài nguyên GOTY. Để chạy lần đầu không có bước import, nơi triển khai phải cung cấp resources.json/data hợp lệ với quyền phân phối phù hợp; sở hữu một license chơi game không tự cung cấp các file cho trình duyệt.

Manifest local có revision SHA-256; khi tài nguyên thay đổi, loader thay bundle nguyên tử. Không có manifest hoặc mất mạng vẫn dùng tài nguyên đã nhớ nếu có. Save dùng namespace riêng, không bị thay khi cập nhật tài nguyên.
