# PvZ GOTY cho Máy Game

## Yêu cầu đã chốt

Port toàn bộ GOTY. Giữ nguyên giao diện trong game, bố cục, artwork, nhân vật, animation, phông chữ, màu sắc, nhạc và hiệu ứng âm thanh. Chỉ nâng chất lượng asset và hiển thị. Không thiết kế lại menu, không thêm bộ hình thay phong cách và không thay âm thanh.

## Thực hiện

1. Engine PvZ-Portable 0.2.5, commit `141c1476dd462ac3526f796e303177616f4de6bc`, build WebAssembly từ nguồn; `DO_FIX_BUGS=OFF`, `PVZ_DEBUG=OFF`.
2. Trang `games/pvz-goty/index.html` dùng shell runtime upstream, ẩn màn hình upload; catalog Máy Game dùng cách hiển thị sẵn có, không thêm ảnh minh họa mới.
3. Tự nạp `main.pak`, `properties/` từ manifest local/host hoặc IndexedDB; tự khởi động, không có bước upload. Không gửi file lên mạng; không chạy EXE.
4. Giữ save theo định dạng engine, đồng bộ IndexedDB; xuất/nhập ZIP. localStorage chỉ đánh dấu có save cho catalog.
5. Framebuffer thực đến 3840×2160, tự chọn theo màn hình; giữ tọa độ trò chơi 800×600 ở giữa camera 16:9. Vùng bấm, vị trí UI và animation không thay đổi.
6. Nhận texture PNG 2×/4× có cùng hình vẽ, tỷ lệ, frame/cel và alpha gốc. Chỉ texture GPU dùng pixel HD; dữ liệu logic, ảnh động tạo bằng phần mềm và âm thanh giữ gốc. Ảnh sai kích thước hoặc vượt giới hạn GPU dùng bản gốc.
7. GitHub Actions tạo artifact site, binary và mã nguồn/giấy phép tương ứng. Chưa phát hành site khi PR chưa được duyệt.

## Nghiệm thu trước khi gọi là hoàn tất

- Adventure đủ 50 màn; Mini-games, Puzzle, Survival/Endless, Zen Garden, Shop, Almanac, Achievements, Zombatar.
- Giao diện/menu, luật chơi, artwork, frame animation, nhạc và âm thanh được đối chiếu với GOTY gốc.
- Vùng bấm đúng ở mọi độ phân giải và fullscreen; bàn phím/cảm ứng hoạt động.
- Bộ dữ liệu, profile và save còn sau khi đóng/mở trình duyệt.
- Xuất/nhập save không lẫn profile hoặc save màn cũ; báo lỗi nếu trình duyệt không lưu được.
- Texture HD được đối chiếu trực quan, giữ nguyên phong cách; không coi lọc mượt là AI upscale.

## Trạng thái và giới hạn

Engine upstream mô tả gần 100% tương đương; cần nghiệm thu thực tế. Bản tích hợp mới bổ sung lưu tài nguyên, framebuffer và đường texture HD. Chưa có bộ texture HD mới được tạo/nhập, chưa xác nhận toàn bộ chế độ trên bản build Máy Game. GitHub Pages hiện xuất bản từ branch: cần phát hành artifact đầy đủ để có engine, không xuất bản riêng thư mục nguồn.

Khi chưa nhập gói HD, renderer lấy chính pixel gốc để nội suy bicubic 2× cho texture tĩnh, xử lý alpha trước khi lấy mẫu và giữ ranh giới cel. Đây là nâng chất lượng lấy mẫu, không phải AI tạo chi tiết mới; ảnh tạo/sửa bằng phần mềm và ảnh vượt giới hạn GPU giữ đường gốc. Cần đối chiếu ảnh thực và hiệu năng trước khi phát hành.

## Local trước PR — 10/10/2026

Build nhánh thành công (run 38041971638). Đã chạy engine có bicubic 2× tại 1440×1080, xác nhận bố cục menu GOTY, nhập tên, trồng Peashooter trong Adventure 1-1, menu tạm dừng và xuất save ZIP. Đã xác nhận IndexedDB giữ byte tài nguyên sau reload, hồ sơ LocalTest được khôi phục. Ván Adventure 1-1 được tiếp tục sau reload với cùng Peashooter và 50 sun; save ZIP chứa user1.dat, users.dat, game1_0.v4. Luồng tự khởi động được kiểm tra cả địa chỉ chưa có dữ liệu nhớ (localhost) và địa chỉ đã có dữ liệu (127.0.0.1). Cú pháp toàn bộ JS và regression-check.cjs đều qua. Quan sát runtime xác nhận bridge resize được export, AudioContext chuyển running sau bấm game và PCM đầu ra khác 0 (peak 0.256). Đây là kiểm tra phát tín hiệu, chưa đối chiếu bằng tai toàn bộ nhạc/SFX hoặc hoàn thành toàn bộ các chế độ. Chưa có PR.

## Mở rộng ngoài 4:3

Nguồn video người dùng gửi: HenryJk/PvZWidescreen v1.1.2, GameBanana 425279, WineD3D. Mã HenryJk đặt PAD=133, rộng 800+2*PAD=1066 và vá từng màn hình, camera, hit-test. Cần chuyển các bố trí này sang C++ của engine GOTY, giữ số ô chơi và luật gốc, kiểm tra menu/Board/SeedChooser/CutScene/ZenGarden/Almanac/Shop/Achievements/Zombatar. Không phát hành chỉ bằng cách kéo giãn ảnh 4:3. Đã triển khai camera mở rộng trong bản sửa 11/10 bên dưới; chưa nghiệm thu toàn bộ màn/chế độ.

## Sửa widescreen — 11/10/2026

Đã thêm patch camera 16:9 độc lập với hệ tọa độ/rules 800×600 gốc: projection 1066⅔×600, dịch nội dung 133⅓ px, mở clip toàn màn và chuyển chuột về tọa độ gốc. Framebuffer 1080p là 1920×1080, giới hạn 4K là 3840×2160. Bản build 99cba3c đã kiểm tra menu, tiếp tục Adventure 1-1, thu sun ở 1080p và 4K, nút tạm dừng, save và PCM khác 0. Cách phản chiếu nền trong bản đó bị người dùng từ chối.

Lần sửa tiếp theo bỏ toàn bộ phần phản chiếu do port thêm, nhận 22 ảnh nền riêng từ PvZWidescreen 1.1.2. Không thay PAK, animation, âm thanh hoặc dữ liệu GOTY bằng gói mod Windows cũ. Menu mở rộng hai lớp nền với alpha gốc, giữ animation và hit box GOTY. Camera pan sử dụng biên ảnh 1666 px khi có bộ nền; khi thiếu vẫn dùng biên ảnh gốc. Zombatar chưa có ảnh nền widescreen trong gói tham chiếu, dùng nền gốc ở giữa. Chưa có bộ HD Mod trong dữ liệu local; bicubic chưa được coi là HD art. Bản sửa này đang chờ build và kiểm tra local; chưa có PR.

