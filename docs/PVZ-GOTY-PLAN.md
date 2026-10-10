# PvZ GOTY cho Máy Game

## Yêu cầu đã chốt

Port toàn bộ GOTY. Giữ nguyên giao diện trong game, bố cục, artwork, nhân vật, animation, phông chữ, màu sắc, nhạc và hiệu ứng âm thanh. Chỉ nâng chất lượng asset và hiển thị. Không thiết kế lại menu, không thêm bộ hình thay phong cách và không thay âm thanh.

## Thực hiện

1. Engine PvZ-Portable 0.2.5, commit `141c1476dd462ac3526f796e303177616f4de6bc`, build WebAssembly từ nguồn; `DO_FIX_BUGS=OFF`, `PVZ_DEBUG=OFF`.
2. Trang `games/pvz-goty/index.html` dùng shell nhập dữ liệu upstream; catalog Máy Game dùng cách hiển thị sẵn có, không thêm ảnh minh họa mới.
3. Nhập `main.pak`, `properties/` một lần. Nhớ tài nguyên bằng IndexedDB, tự khôi phục lần mở sau. Không gửi file lên mạng; không chạy EXE.
4. Giữ save theo định dạng engine, đồng bộ IndexedDB; xuất/nhập ZIP. localStorage chỉ đánh dấu có save cho catalog.
5. Framebuffer thực đến 2880×2160, tự chọn theo màn hình; giữ tọa độ logic 800×600 và tỷ lệ 4:3. Vùng bấm, vị trí UI và animation không thay đổi.
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
