# Máy Game

Thư viện game cổ điển tiếng Việt, chơi trực tiếp trên trình duyệt.

**[Chơi Máy Game](https://ncqh.github.io/May-Game/)**

## Game

- **Tetris** — xếp khối và hoàn thành hàng.
- **Pikachu** — nối các cặp hình giống nhau.
- **Flappy Bird** — bay qua các cột và tránh va chạm.
- **Plants vs. Zombies GOTY** — engine GOTY qua WebAssembly; nhập dữ liệu một lần, trình duyệt tự nhớ tài nguyên và save bằng IndexedDB.

## Đóng góp

Xem [danh sách contributors](./contributors.html) hoặc đọc [hướng dẫn đóng góp game](./contribute.html). Mỗi game nằm trong `games/` và được đăng ký trong `games.json`.

## Tiến trình và asset

Điểm cao và ván đang chơi được lưu trong `localStorage` trên thiết bị hiện tại, không đồng bộ giữa các thiết bị. Nguồn và giấy phép asset được ghi trong [ASSETS.md](./ASSETS.md).

## Build GOTY

Workflow **Build PvZ GOTY site** tạo artifact `may-game-pvz-goty-site` có site, engine, JSZip và mã nguồn tương ứng. Giải nén artifact và phục vụ qua HTTP. Thư mục nguồn chưa build không có engine `.wasm`.

Xem [kế hoạch](./docs/PVZ-GOTY-PLAN.md) và [hướng dẫn build](./games/pvz-goty/README.md). Giao diện, hình ảnh, animation và âm thanh GOTY được giữ nguyên. Texture HD phải giữ đúng hình vẽ gốc; chưa có gói HD kèm theo. Cần đối chiếu đủ chế độ GOTY trước khi đánh dấu port hoàn tất.
