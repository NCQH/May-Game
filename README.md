# Máy Game

Thư viện game cổ điển tiếng Việt, chơi trực tiếp trên trình duyệt.

**[Chơi Máy Game](https://ncqh.github.io/May-Game/)**

## Game

- **Tetris** — xếp khối và hoàn thành hàng.
- **Pikachu** — nối các cặp hình giống nhau.
- **Flappy Bird** — bay qua các cột và tránh va chạm.
- **Plants vs. Zombies GOTY** — trồng cây phòng thủ trước zombie.
- **Ô ăn quan** — trò dân gian rải quân, ăn dân và ăn quan; đấu máy hoặc hai người.
- **Cờ caro** — xếp năm quân liền hàng; đấu máy hoặc hai người.
- **Cờ tướng** — đủ luật cờ tướng; đấu máy hoặc hai người.
- **Rắn săn mồi** — ăn mồi để dài ra, tránh cắn vào thân.
- **2048** — trượt và gộp các ô cùng số.
- **Dò mìn** — mở hết ô an toàn nhờ các con số gợi ý.
- **Phá gạch** — đỡ bóng phá hết gạch qua từng màn.

## Đóng góp và phát triển

Mỗi game nằm trong `games/` và được đăng ký trong `games.json`.

- [Quy chuẩn giao diện](./STYLE.md) — style chung cho game hiện tại và game mới.
- [Hướng dẫn đóng góp](./CONTRIBUTING.md) và [hướng dẫn trên website](./contribute.html).
- [Danh sách người đóng góp](./contributors.html).
- [Build và vận hành PvZ GOTY](./games/pvz-goty/README.md) — chi tiết engine WebAssembly, tài nguyên và triển khai.

## Tiến trình và asset

Các game lưu điểm/tiến trình bằng `localStorage`; PvZ lưu dữ liệu bằng IndexedDB. Dữ liệu nằm trên trình duyệt của thiết bị hiện tại, không đồng bộ giữa các thiết bị.

Nguồn và giấy phép asset được ghi trong [ASSETS.md](./ASSETS.md).
