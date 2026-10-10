# Plants vs. Zombies GOTY

## Giữ bản gốc

Giao diện bên trong game, bố cục, hình vẽ, animation, chữ, màu sắc, nhạc và hiệu ứng dùng dữ liệu GOTY gốc. Các thay đổi engine mới chỉ phục vụ chất lượng hiển thị và texture GPU. Màn hình nhập dữ liệu sử dụng shell upstream, không có launcher thiết kế mới hay hình catalog mới.

## Dữ liệu và save

Qua HTTP, nhập thư mục game hoặc ZIP có `main.pak`, `properties/`. Trình duyệt nhớ tài nguyên bằng IndexedDB; lần sau bấm Start Game. File không được gửi lên server, EXE không được nhập/chạy. Nên dùng bản GOTY 1.2.0.1073 EN; xem upstream về các bản ngôn ngữ/Steam khác.

Save engine dùng IDBFS riêng `/may-game-pvz-goty-saves`. Trong game, dùng Save and Exit để lưu màn đang chơi. Export Saves tải ZIP để sao lưu/chuyển thiết bị. Nhập save trước khi chơi. Xóa dữ liệu trình duyệt xóa cả tài nguyên và save.

## Chất lượng hình ảnh

Tọa độ/vùng bấm vẫn 800×600, tỷ lệ 4:3. Framebuffer tự tăng theo màn hình và devicePixelRatio, tối đa 2880×2160. Màn hình 1920×1080 hiển thị game 1440×1080 với khoảng trống hai bên. Chế độ lọc mượt dùng tuyến tính, không tạo chi tiết AI.

Import HD PNG Folder nhận thư mục `images/`, `reanim/`, `fonts/`, hoặc `hd/` chứa các thư mục đó. Ví dụ gốc `images/background1.jpg` 800×600 có HD `images/background1.png` 1600×1200 hoặc 3200×2400. PNG/alpha mask giữ đúng bố cục và hình vẽ gốc. Texture sai kích thước, vượt giới hạn GPU hoặc ảnh đã bị sửa bằng phần mềm dùng đường gốc. Bộ HD không kèm theo.

Host có thể chọn độ cao render bằng `MayGamePvzQuality.setRenderHeight(1080)` (600, 1080, 1440, 2160, auto), không thay menu GOTY.

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
python3 -m http.server 8000 --directory .site
```

Chạy patcher trên checkout sạch. GitHub Actions làm các bước trên và xuất artifact **may-game-pvz-goty-site**. Artifact chứa `.site/`, engine, JSZip, license và `engine/source.zip` (nguồn engine đã sửa, dependency, bridge và scripts).

## Phát hành và nghiệm thu

Chưa deploy tự động. GitHub Pages xuất bản từ branch không có binary sinh ra: cần phát hành artifact đầy đủ sau review. Không thể xác nhận giống toàn bộ GOTY chỉ bằng build; đối chiếu các chế độ, save, input và asset theo docs/PVZ-GOTY-PLAN.md. Texture HD còn cần dữ liệu thật.

Bridge/patch mới: LGPL-3.0-or-later. Giữ license upstream/dependency và nguồn tương ứng khi phân phối. Quyền engine không cấp quyền phân phối tài nguyên GOTY.

Khi chưa nhập gói HD, renderer lấy chính pixel gốc để nội suy bicubic 2× cho texture tĩnh, xử lý alpha trước khi lấy mẫu và giữ ranh giới cel. Đây là nâng chất lượng lấy mẫu, không phải AI tạo chi tiết mới; ảnh tạo/sửa bằng phần mềm và ảnh vượt giới hạn GPU giữ đường gốc. Cần đối chiếu ảnh thực và hiệu năng trước khi phát hành.
