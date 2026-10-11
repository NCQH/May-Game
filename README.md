# Máy Game

Thư viện game cổ điển tiếng Việt, chơi trực tiếp trên trình duyệt.

**[Chơi Máy Game](https://ncqh.github.io/May-Game/)**

## Game

- **Tetris** — xếp khối và hoàn thành hàng.
- **Pikachu** — nối các cặp hình giống nhau.
- **Flappy Bird** — bay qua các cột và tránh va chạm.
- **Plants vs. Zombies GOTY** — engine GOTY qua WebAssembly; tự nạp dữ liệu local/host, trình duyệt nhớ tài nguyên và save bằng IndexedDB.

## Đóng góp

Xem [danh sách contributors](./contributors.html) hoặc đọc [hướng dẫn đóng góp game](./contribute.html). Mỗi game nằm trong `games/` và được đăng ký trong `games.json`.

## Tiến trình và asset

Điểm cao và ván đang chơi được lưu trong `localStorage` trên thiết bị hiện tại, không đồng bộ giữa các thiết bị. Nguồn và giấy phép asset được ghi trong [ASSETS.md](./ASSETS.md).

## Build GOTY

Workflow **Build PvZ GOTY site** tạo artifact `may-game-pvz-goty-site` có site, engine, JSZip và mã nguồn tương ứng. Artifact kèm bộ dữ liệu PvZ và ảnh HD/widescreen. Nhánh làm việc xuất artifact để thử; khi thay đổi vào `main`, workflow triển khai lên GitHub Pages (Source: GitHub Actions). Có thể giải nén artifact và phục vụ qua HTTP. Thư mục nguồn chưa build không có engine `.wasm`.

Xem [kế hoạch](./docs/PVZ-GOTY-PLAN.md) và [hướng dẫn build](./games/pvz-goty/README.md). Giao diện, hình ảnh, animation và âm thanh GOTY được giữ nguyên. Texture HD phải giữ đúng hình vẽ gốc; bản này kèm bộ HD/widescreen đã chuẩn bị. Cần đối chiếu đủ chế độ GOTY trước khi đánh dấu port hoàn tất.
