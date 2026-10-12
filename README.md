# Máy Game

Thư viện game cổ điển tiếng Việt, chơi trực tiếp trên trình duyệt.

**[Chơi Máy Game](https://ncqh.github.io/May-Game/)**

## Game

- **Tetris** — xếp khối và hoàn thành hàng.
- **Pikachu** — nối các cặp hình giống nhau.
- **Flappy Bird** — bay qua các cột và tránh va chạm.
- **Plants vs. Zombies GOTY** — trồng cây phòng thủ trước zombie.

## Đóng góp và phát triển

Mỗi game nằm trong `games/` và được đăng ký trong `games.json`.

- [Quy chuẩn giao diện](./STYLE.md) — style chung cho game hiện tại và game mới.
- [Hướng dẫn đóng góp](./CONTRIBUTING.md) và [hướng dẫn trên website](./contribute.html).
- [Danh sách người đóng góp](./contributors.html).
- [Build và vận hành PvZ GOTY](./games/pvz-goty/README.md) — chi tiết engine WebAssembly, tài nguyên và triển khai.

## Tiến trình và asset

Tetris, Pikachu và Flappy Bird lưu điểm/tiến trình bằng `localStorage`; PvZ lưu dữ liệu bằng IndexedDB. Dữ liệu nằm trên trình duyệt của thiết bị hiện tại, không đồng bộ giữa các thiết bị.

Nguồn và giấy phép asset được ghi trong [ASSETS.md](./ASSETS.md).
