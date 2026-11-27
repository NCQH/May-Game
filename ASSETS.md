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

## Ô ăn quan, Cờ caro, Cờ tướng, Rắn săn mồi, 2048, Dò mìn, Phá gạch

- Bàn chơi, quân, gạch, ô số và hiệu ứng được vẽ bằng Canvas, CSS hoặc SVG trong repo; âm thanh tạo bằng Web Audio. Không dùng ảnh, nhạc hay font tải về riêng.
- Chữ Hán trên quân Cờ tướng dùng font CJK có sẵn trên thiết bị; có thể chuyển sang chữ Việt trong menu.
- Luật chơi là luật dân gian/phổ biến, không lấy mã nguồn hay asset từ game thương mại.

## Pikachu

- **Nguồn:** [Pikachu Cổ Điển](https://www.pikachucodien.net/) và [game Pikachu 2026](https://www.pikachucodien.net/games/pikachu-2026/index.html).
- **Asset:** [`assets/pikachu/pieces-sprite.png`](./assets/pikachu/pieces-sprite.png) và bốn hiệu ứng trong [`assets/pikachu/audio/`](./assets/pikachu/audio/).
- **Dùng tại:** các ô Pokémon dùng 12 khung đầu của sprite sheet (mỗi khung 40×50); âm thanh: `sound2` chọn ô, `sound5` ghép đúng, `sound1` ghép sai, `sound4` trộn bàn mới.
- **Quyền sử dụng:** theo xác nhận của người duy trì dự án, đã xin phép PikachuCoDien.net để dùng các asset này. Nguồn không công bố giấy phép mở; không gán asset này MIT/CC0.
- Asset được lưu trong repo và tải cục bộ, không gọi đến máy chủ nguồn khi chơi.

## Bang Bang Web

- **Nguồn:** `BangBang_Offline-main.zip` (bản offline do người duy trì cung cấp). Người duy trì xác nhận đã có quyền phân phối asset/game data.
- **Dùng tại:** `games/bangbang/` — client HTML5, asset đã trim theo request thực tế của map 201 + lobby, server PvE Python đóng gói trong `html5/bangbang-py.zip`, Pyodide runtime.
- **Catalog:** ba catalog lớn (`m5`, `m6`, `m81314`) được chia thành các file `.partN` <25 MiB; `html5/shim.js` ghép lại nguyên bytes trước khi client đọc. Hash/version trong catalog giữ nguyên.
- **Pyodide:** MPL-2.0; license tại [`games/bangbang/html5/pyodide/LICENSE`](./games/bangbang/html5/pyodide/LICENSE). Python runtime đi kèm Pyodide giữ license tương ứng.
- **Không server:** trang web tĩnh; `/html5/*` và `/rez/*` được map từ `games/bangbang/` qua `_redirects` (Pages) hoặc `scripts/bangbang/serve.cjs` (local). Service worker `sw.js` chỉ cache asset; không yêu cầu offline.
- **Đã vô hiệu hoá logic:** bạn bè, cộng đồng, chat, nạp tiền/recharge/VIP ad. UI vẫn giữ nguyên (disabled/“chưa mở”). Giữ PvE/lobby/garage/shop/postmatch và toàn bộ map/tank; PvP/guild/economy chưa test offline.
- **Tạo nhân vật:** dùng 57 body sprite `rez/zh_CN/char/*` từ `m8_account_catalog`; lưu `name`/`body` vào `worlds.state` SQLite, persist DB sang IndexedDB.

## Ảnh bìa catalog

Ảnh bìa nằm trong `assets/covers/`, được khai báo bằng `cover` trong `games.json` và đã cắt/đổi sang WebP trong repo; trang không hotlink ảnh từ nguồn ngoài.

| Game | Nguồn | Giấy phép / ghi chú |
|---|---|---|
| Tetris | [Tetris Boxshot](https://en.wikipedia.org/wiki/File:Tetris_Boxshot.jpg) | Ảnh bìa Game Boy chính thức, © Nintendo/Elorg; dùng để nhận diện game. |
| Pikachu | [Pikachu artwork](https://archives.bulbagarden.net/wiki/File:025Pikachu.png) | Artwork chính thức của Ken Sugimori, © Nintendo/Creatures/GAME FREAK; dùng để nhận diện game. |
| Flappy Bird | [Flappy Bird icon](https://en.wikipedia.org/wiki/File:Flappy_Bird_icon.png) | App icon chính thức, © .Gears/Dong Nguyen; dùng để nhận diện game. |
| Plants vs. Zombies GOTY | [Steam library capsule](https://store.steampowered.com/app/3590/Plants_vs_Zombies_GOTY_Edition/) | Ảnh capsule chính thức, © PopCap/EA; dùng để nhận diện game. |
| Ô ăn quan | [Oanquan0.JPG](https://commons.wikimedia.org/wiki/File:Oanquan0.JPG) | Tieu ngao giang ho1970, Public domain/CC0; ảnh đã cắt. |
| Cờ caro | [Renju.jpg](https://commons.wikimedia.org/wiki/File:Renju.jpg) | Matěj Baťha, CC BY-SA 3.0 (đồng thời CC BY 2.5/GFDL); ảnh cắt là tác phẩm phái sinh, giữ CC BY-SA 3.0. |
| Cờ tướng | [Xiangqi_Board.svg](https://commons.wikimedia.org/wiki/File:Xiangqi_Board.svg) | Inductiveload, Public domain (PD-self). |
| Rắn săn mồi | [Snake 3310 photo](https://commons.wikimedia.org/wiki/File:Snake_3310_(27719733447).jpg) | Art Replik, Public domain (Flickr PDM). |
| 2048 | [2048_logo.svg](https://commons.wikimedia.org/wiki/File:2048_logo.svg) | Davod, Public domain (PD-textlogo); tên/biểu tượng có thể là trademark. |
| Dò mìn | [KMines.png](https://commons.wikimedia.org/wiki/File:KMines.png) | User:Ysangkok, GPL; ảnh chụp KMines. |
| Phá gạch | Ảnh chụp canvas của game trong repo | Không dùng ảnh ngoài; dùng khi không có ảnh bìa dọc phù hợp. |

Các ảnh bìa chính thức của game thương mại không nằm dưới giấy phép MIT của repo; chúng được dùng với mục đích nhận diện trong catalog của dự án fan-made.

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
- **Output Cloudflare:** mặc định chỉ phục vụ `main.pak` + `properties/` (game gốc) để giảm first load; `hd/` và `wide/` vẫn nằm trong repo, do `scripts/pvz/trim-pvz.cjs` bỏ khỏi output Cloudflare trước khi upload.
- **Source zip:** [cloudflare-pvz-source-2026-11-27](https://github.com/NCQH/May-Game/releases/tag/cloudflare-pvz-source-2026-11-27) — 33.5 MB, vượt giới hạn 25 MiB của Cloudflare nên không nằm trong output Cloudflare; build artifact vẫn có `engine/source.zip`. Giữ link này trong bản phân phối.
- **Dữ liệu GOTY và texture HD:** bộ dữ liệu local đã chọn được đưa vào `games/pvz-goty/data/` và artifact theo yêu cầu người duy trì. Manifest `resources.json` có 467 file, gồm game gốc, properties, ảnh HD và nền widescreen. Game tự nạp từ host và nhớ cục bộ bằng IndexedDB; save của người chơi không đưa lên Git. Giấy phép engine không áp dụng cho tài nguyên thương mại hoặc gói mod HD.
- Không thêm hình minh họa mới cho GOTY. Nâng asset phải giữ hình vẽ, bố cục, frame/cel, phông chữ và màu sắc gốc.
- Ảnh bìa PvZ trên catalog dùng Steam library capsule trong `assets/covers/pvz-goty.webp`; xem mục “Ảnh bìa catalog”. Không dùng `titlescreen.png` làm ảnh bìa nữa.
