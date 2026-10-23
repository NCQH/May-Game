# Cùng thêm game cho Máy Game

Máy Game là thư viện tĩnh: mỗi game chạy trong thư mục riêng, không cần backend hay bước build. Cảm ơn bạn đã muốn góp thêm một trò chơi.

## Quy trình

1. Fork repo và tạo nhánh cho game của bạn.
2. Sao chép `games/_template/` sang `games/<slug>/` rồi hoàn thiện game.
3. Thêm thông tin game vào `games.json`.
4. Chạy trang qua một máy chủ tĩnh, chơi thử bằng bàn phím và màn hình cảm ứng.
5. Mở pull request, mô tả cách chơi và gửi kèm ảnh chụp màn hình nếu có.

## Cấu trúc game

Mỗi game cần có `games/<slug>/index.html`. CSS và JavaScript có thể nằm cùng thư mục. Chỉ dùng đường dẫn tương đối để game chạy được khi repo xuất bản dưới một GitHub Pages project URL.

Thêm một mục vào `games.json` theo cấu trúc sau:

```json
{
  "id": "ten-game",
  "title": "Tên game",
  "category": "Thể loại",
  "description": "Mô tả ngắn về cách chơi.",
  "players": "1 người",
  "controls": "← → di chuyển · Space xác nhận",
  "path": "./games/ten-game/index.html",
  "art": "tetris",
  "accent": "lime",
  "contributors": [
    { "name": "Tên người góp", "github": "username" }
  ]
}
```

`id` chỉ dùng chữ thường, số và dấu gạch ngang. `art` hiện hỗ trợ `tetris`, `pikachu`, `flappy`, `pvz-goty` và các thẻ pixel `snake`, `2048`, `do-min`, `pha-gach`, `co-caro`, `o-an-quan`, `co-tuong` (thêm thẻ mới trong `PIXEL_ART` của `src/app.js`); `accent` hiện hỗ trợ `lime`, `coral`, `blue`. `recordLabel` (không bắt buộc) đổi nhãn “Kỷ lục” trên thẻ, ví dụ “Thắng máy” khi `bestScore` là số ván thắng máy.

Game mới có thể dùng khung chơi chung: thêm class `arcade-play` cho `<main>`, nạp `assets/css/play.css` sau `shared.css`, và `assets/js/game-kit.js` trước script game. Tham khảo [Rắn săn mồi](./games/snake/) cho bố cục HUD, sân chơi, nút điều khiển, overlay và cách lưu.

## Giao diện một màn hình

Giữ các liên kết `assets/css/typography.css`, `assets/css/viewport.css` và script `assets/js/viewport.js` từ template. Tải `viewport.css` sau CSS của game. Khung arcade, vùng chơi và nút điều khiển phải vừa màn hình, không tạo vùng cuộn bên trong. Chỉnh kích thước bàn chơi theo chiều cao trước; script chung thu khung lại khi vẫn thiếu chỗ. Khi vẽ đường nối trong tọa độ local, dùng kích thước layout (`offsetWidth`/`offsetHeight`) để không bị lệch khi khung thu nhỏ.

Rà cả máy tính, điện thoại dọc và ngang; kiểm tra các nút vẫn hiện đầy đủ, không chỉ ẩn thanh cuộn.

Ghi tên từng người thực hiện game trong `contributors`; `github` là username, không kèm `@`. Trang [Contribute](./contributors.html) tự nhóm các game theo username. Chỉ ghi những người thực sự tham gia đóng góp.

## Lưu tiến trình

Dùng `localStorage` cùng khóa `may-game:v1:<id-game>`. Giá trị JSON nên có dạng:

```json
{
  "version": 1,
  "bestScore": 420,
  "current": { "state": "..." },
  "updatedAt": 1790956800000
}
```

Đặt `current` thành `null` khi ván đã kết thúc hoặc người chơi bắt đầu lại. Chỉ lưu trạng thái game và kỷ lục cần thiết; không lưu thông tin cá nhân, không gửi dữ liệu ra mạng. Tiến trình chỉ tồn tại trong trình duyệt và thiết bị đang chơi.

## Yêu cầu trước khi gửi PR

- Giao diện vừa màn hình điện thoại và máy tính; nút chạm đủ lớn.
- Có thể chơi bằng bàn phím và có nhãn điều khiển dễ hiểu.
- Có trạng thái bắt đầu, tạm dừng/kết thúc và chơi lại phù hợp với game.
- Chỉ thêm asset bạn tạo hoặc có giấy phép/cho phép rõ ràng cho việc dùng và phân phối trên repo công khai. Ghi tác giả, nguồn và phạm vi quyền trong `ASSETS.md`; giữ lại license gốc nếu gói asset yêu cầu.
- Không thêm analytics, quảng cáo, đăng nhập, API bên ngoài hoặc thư viện tải từ CDN nếu không cần thiết.
- Không đưa mã nguồn, hình ảnh hoặc âm thanh lấy từ game thương mại vào PR nếu chưa có quyền rõ ràng. Không mặc định một quyền sử dụng áp dụng cho game khác hoặc việc phân phối ngoài phạm vi đã được cho phép.

## Chạy trang cục bộ

Từ thư mục repo, chạy `python3 -m http.server 8000`, sau đó mở `http://localhost:8000`. Trang dùng `fetch()` để tải catalog nên cần được phục vụ qua HTTP.

## Riêng engine GOTY

GOTY dùng IndexedDB cho tài nguyên và save; localStorage chỉ ghi dấu hiệu có save cho catalog. Engine build bằng workflow riêng, xem games/pvz-goty/README.md. Không commit main.pak, ảnh hoặc âm thanh GOTY. Mục tiêu giữ nguyên giao diện, artwork, animation và âm thanh; chỉ tăng chất lượng hiển thị/texture.
