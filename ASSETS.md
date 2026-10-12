# Asset và giấy phép

## Pixel Platformer character sprite

- **Tác giả:** Kenney
- **Nguồn:** [Pixel Platformer](https://kenney.nl/assets/pixel-platformer)
- **Dùng tại:** `assets/kenney/pixel-platformer-character.png` — nhân vật trang trí trong phần giới thiệu.
- **Giấy phép:** Creative Commons Zero (CC0 1.0). Bản license đi kèm được giữ tại [`assets/kenney/LICENSE.txt`](./assets/kenney/LICENSE.txt).

## Flappy Bird sprites

- **Nguồn tham chiếu:** [samuelcust/flappy-bird-assets](https://github.com/samuelcust/flappy-bird-assets). Tên và cấu trúc thư mục local khớp với asset pack này.
- **Dùng tại:** `games/flappy-bird/assets/sprites/` — nền, chim vàng, ống, mặt đất, hướng dẫn, game-over và chữ số; `games/flappy-bird/assets/audio/` — wing, point, hit, die và swoosh đồng bộ sự kiện game.
- **Giấy phép:** Repo nguồn công bố MIT; giữ thông báo tại [`games/flappy-bird/assets/LICENSE`](./games/flappy-bird/assets/LICENSE). Game tải asset từ repo local, không gọi CDN cho sprite.

## Tetris

- Khối, ghost và preview được vẽ bằng Canvas trong repo; hiệu ứng âm thanh tạo bằng Web Audio, không tải nhạc/skin từ TETR.IO.
- TETR.IO là tham chiếu trải nghiệm solo, không phải nguồn asset hoặc engine của bản này.

## Pikachu

- **Nguồn:** [Pikachu Cổ Điển](https://www.pikachucodien.net/) và [game Pikachu 2026](https://www.pikachucodien.net/games/pikachu-2026/index.html).
- **Asset:** [`assets/pikachu/pieces-sprite.png`](./assets/pikachu/pieces-sprite.png) và bốn hiệu ứng trong [`assets/pikachu/audio/`](./assets/pikachu/audio/).
- **Dùng tại:** các ô Pokémon dùng 12 khung đầu của sprite sheet (mỗi khung 40×50); âm thanh: `sound2` chọn ô, `sound5` ghép đúng, `sound1` ghép sai, `sound4` trộn bàn mới.
- **Quyền sử dụng:** theo xác nhận của người duy trì dự án, đã xin phép PikachuCoDien.net để dùng các asset này. Nguồn không công bố giấy phép mở; không gán asset này MIT/CC0.
- Asset được lưu trong repo và tải cục bộ, không gọi đến máy chủ nguồn khi chơi.

## Phông chữ

- [Chakra Petch](https://github.com/google/fonts/tree/main/ofl/chakrapetch) — tiêu đề và nhãn giao diện; SIL Open Font License 1.1.
- [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro) — nội dung tiếng Việt; SIL Open Font License 1.1.
- Đang tải từ Google Fonts với font dự phòng hệ thống; game vẫn dùng được nếu font web không tải.
- Các trang dùng chung `assets/css/typography.css`: `--font-display` cho tiêu đề/nhãn nổi bật và `--font-body` cho nội dung, nút và biểu mẫu. Chữ được vẽ trong game giữ theo thiết kế của từng game.

## Biểu tượng Máy Game

- `assets/favicon.svg` vẽ lại dấu bốn ô vuông đã có trong giao diện Máy Game, bằng SVG trong repo.
- `assets/favicon.ico` chứa các kích thước 16, 32 và 48 px; `assets/apple-touch-icon.png` là bản 180 px của cùng biểu tượng.
- Trang chính, trang hướng dẫn và các trang game dùng chung bộ biểu tượng này.

Các hình minh họa khối trong catalog và máy arcade được vẽ bằng SVG/CSS trong repo.

## Plants vs. Zombies GOTY

- **Engine:** [wszqkzqk/PvZ-Portable](https://github.com/wszqkzqk/PvZ-Portable), 0.2.5, commit `141c1476dd462ac3526f796e303177616f4de6bc`; giữ tác giả và các contributor upstream trong nguồn. LGPL-3.0-or-later; phần Framework còn có LicenseRef-PopCap. Giữ LICENSE, COPYING và thông báo của dependency trong source.zip đi kèm engine.
- **Thay đổi:** framebuffer độ phân giải cao và texture GPU 2×/4× tại `scripts/pvz/`, áp dụng bởi `scripts/pvz/patch-pvz.cjs`; phát hành LGPL-3.0-or-later.
- **Âm thanh:** decoder libopenmpt `libopenmpt-0.8.4`, commit `327204eaa2c27bd1acbb571babe68f279c85238b`; license trong nguồn. SDL-Mixer-X và dependency có thông báo riêng trong nguồn upstream. Nhạc và hiệu ứng dùng file game gốc; không thêm hoặc thay âm thanh.
- **ZIP:** [Stuk/jszip](https://github.com/Stuk/jszip), 3.10.1; phân phối theo MIT, giữ LICENSE.markdown trong vendor/JSZIP-LICENSE.md.
- **Runtime web:** dùng shell của engine upstream, ẩn màn hình upload, thêm ghi nhớ/tự nạp dữ liệu, PNG HD và giới hạn đường dẫn; giao diện bên trong GOTY do engine và dữ liệu gốc vẽ.
- **Dữ liệu GOTY và texture HD:** bộ dữ liệu local đã chọn được đưa vào `games/pvz-goty/data/` và artifact theo yêu cầu người duy trì. Manifest `resources.json` có 467 file, gồm game gốc, properties, ảnh HD và nền widescreen. Game tự nạp từ host và nhớ cục bộ bằng IndexedDB; save của người chơi không đưa lên Git. Giấy phép engine không áp dụng cho tài nguyên thương mại hoặc gói mod HD.
- Không thêm hình minh họa mới cho GOTY. Nâng asset phải giữ hình vẽ, bố cục, frame/cel, phông chữ và màu sắc gốc.
- Hình đại diện PvZ trên catalog dùng lại `games/pvz-goty/data/wide/images/titlescreen.png` từ dữ liệu widescreen đã chuẩn bị cho game; CSS căn ảnh trong khung dọc. Khi triển khai, cung cấp cùng đường dẫn dữ liệu này. Nếu thiếu ảnh, khung dùng nền xanh.
