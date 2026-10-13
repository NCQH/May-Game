# Quy chuẩn giao diện Máy Game

Dành cho người phát triển game hiện tại và game mới. Giữ cùng một **máy arcade**, nhưng không ép mọi game có cùng artwork, bố cục bàn chơi hay điều khiển.

Tài liệu mô tả CSS hiện tại và quy tắc dùng lại. Những mục ghi **định hướng** chưa đồng nghĩa đã được triển khai. Khi thay đổi style chung, cập nhật tài liệu này và kiểm tra các game đang có.

## 1. Nguồn style và phạm vi

| Nguồn | Trách nhiệm |
| --- | --- |
| [typography.css](assets/css/typography.css) | Font body/display và fallback |
| [shared.css](assets/css/shared.css) | Token, cabinet và component chung cho game |
| [arcade.css](assets/css/arcade.css) | Trang chủ, catalog, contributors và hướng dẫn |
| [viewport.css](assets/css/viewport.css) | Các override responsive dùng chung và theo game |
| `games/<id>/game.css` | Bàn chơi, HUD, trạng thái và artwork riêng |
| [cabinet.css của PvZ](games/pvz-goty/cabinet.css) | Vỏ arcade, toolbar và canvas engine PvZ |

Không nạp cả `arcade.css` và `shared.css` chỉ để lấy một component: hai file có token và selector toàn cục riêng. Game dùng `shared.css`; trang thư viện/tài liệu dùng `arcade.css`.

Thứ tự hiện tại **không giống nhau**: Tetris/Flappy nạp `viewport.css` trước `game.css`; Pikachu/template nạp `game.css` trước `viewport.css`. Kiểm tra cascade khi sửa, không giả định rule đọc đầu tiên là rule cuối cùng có hiệu lực. Game mới bắt đầu từ [template](games/_template/index.html); scope override bằng class trang của game, tránh đổi `button`, `canvas` hoặc `.game-button` toàn site trong CSS riêng.

## 2. Màu sắc

Dùng biến CSS cho giao diện ngoài game; không sao chép mã màu sang mỗi game.

| Vai trò | Token game / token trang chủ | Giá trị |
| --- | --- | --- |
| Tường/nền trang | `--arcade-wall`, `--game-bg` / `--arcade-bg` | `#101814` |
| Vỏ máy olive | `--arcade-case` | `#94a951` |
| Viền vỏ sáng | `--arcade-case-light` | `#d6e99a` |
| Chân/độ sâu vỏ | `--arcade-case-dark` | `#596a38` |
| Bezel game | `--arcade-bezel` | `#19251c` |
| Màn hình | `--arcade-screen` | Game `#101b15`; trang chủ `#14221c` |
| Panel | `--game-panel` / `--arcade-panel` | `#1b2b23` |
| Đường phân cách game | `--game-line` | `#394a37` |
| Chữ chính | `--game-text` / `--arcade-text` | `#eff2cd` |
| Chữ phụ | `--game-muted` / `--arcade-muted` | `#abb99a` |
| CTA/nhấn mạnh | `--game-lime` / `--arcade-lime` | `#c7e875` |
| Lỗi/cảnh báo | `--game-coral` / `--arcade-coral` | `#ee886b` |
| Accent phụ | `--game-blue` / `--arcade-blue` | `#79c9c4` |
| Điểm/focus game | `--game-sand` | `#e0e8bd` |

Giao diện hiện tại dark-only (`color-scheme: dark`). Màu board/tetromino/Pokémon/engine là màu riêng của game, không phải token của cabinet. Tetris dùng palette riêng trong `game.css`; PvZ giữ UI engine gốc. Không dùng màu làm dấu hiệu duy nhất cho lỗi, lựa chọn hoặc trạng thái âm thanh.

## 3. Typography

- Body, button, input, select, textarea: `--font-body` = **Be Vietnam Pro**, `system-ui`, `sans-serif`.
- Logo, heading, score: `--font-display` = **Chakra Petch**, Be Vietnam Pro, `system-ui`, `sans-serif`.
- Nút hành động: `--font-control` = Be Vietnam Pro 600, 14px, line-height 1.4. Token nền/viền/chữ/accent (`--control-bg`, `--control-border`, `--control-text`, `--control-accent`) nằm trong `typography.css`; dùng lại CSS hiện có, không thêm `controls.css` hoặc hệ class mới. Giữ artwork, tile và chữ vẽ trong canvas riêng.
- Luôn có fallback, không chặn chơi khi Google Fonts chưa tải. Không dùng font pixel khó đọc cho đoạn hướng dẫn dài.
- Heading game chung hiện tại 24px, xuống 21px ở ≤580px; một số tiêu đề trong meta xuống 16px ở ≤620px. Heading catalog 28–40px; heading tài liệu 28–48px.
- CSS cũ có nhiều label/helper 7–12px. Đây là **hiện trạng, không phải chuẩn bắt buộc cho game mới**. Định hướng: body/hướng dẫn 14–16px, label phụ khoảng 12px; kiểm tra khả năng đọc và bố cục trước khi áp dụng.
- Dùng `font-variant-numeric: tabular-nums` cho điểm, thời gian, tiến độ cần ổn định chiều rộng. Tiêu đề/đường dẫn dài phải wrap, không đẩy trang tràn ngang.

## 4. Khung máy và điều hướng

| Phần | Class game / trang thư viện | Style và cách dùng |
| --- | --- | --- |
| Khung ngoài | `.game-page.arcade-game` / `.arcade-cabinet` | Vỏ olive, viền sáng 3px, shadow bậc 4px/8px; góc vuông |
| Header | `.arcade-case-header` / `.cabinet-topline` | Logo trái, đèn trang trí phải; flex, không co mất tên |
| Logo/đèn | `.arcade-case-brand`, `.arcade-brand-mark`, `.arcade-case-lights` | Dấu pixel 2×2, ba đèn; phần trang trí `aria-hidden="true"` |
| Bezel | `.arcade-screen` / `.screen-bezel` | Viền tối 5px, inset highlight; `min-height: 0` cho vùng co giãn |
| Meta | `.arcade-screen-meta` / `.screen-meta` | Điều hướng/tên game; game hiện tại đặt back trái, title phải |
| Về thư viện | `.back-link` / `.screen-home-link` | Nhãn “← Màn hình chính”, link HTML thật; vùng chạm ≥44px |
| Nội dung | `.arcade-game-content` / `.page-content` | Nền màn hình; không thêm một cabinet lồng bên trong |
| Deck/loa | `.arcade-deck`, `.arcade-speaker` / `.cabinet-deck`, `.deck-speaker` | Trang trí đáy khung; không được chiếm chỗ khiến điều khiển mất khỏi viewport |

Khung game mặc định rộng tối đa 760px; các game override theo nội dung: Tetris 540px, Flappy 520px, Pikachu 1120px; Tetris/Flappy có override desktop 1100px. Trang chủ tối đa 1200px. Đây là giới hạn theo game, không yêu cầu game mới dùng chung một độ rộng.

Ưu tiên bàn chơi và điều khiển trước header/deck khi màn hình thấp. Không coi các lỗi responsive đã biết là bố cục cần sao chép. Trang tài liệu có nội dung dài nên cuộn đọc được đầy đủ, không ép hành vi một màn hình của game.

## 5. Component trong game

| Component | Quy tắc |
| --- | --- |
| Board/canvas | Giữ tỷ lệ gốc, không kéo méo. `canvas` chung có `image-rendering: pixelated`; chỉ dùng `touch-action: none` trên vùng thật sự xử lý gesture, không khóa cuộn toàn trang. Có tên truy cập/hướng dẫn đúng game. |
| Panel/HUD | Dùng `.game-panel`, viền `--game-line`, nền `--game-panel`, góc vuông (rule cuối của shared). Nhãn và giá trị rõ; không đóng khung mỗi con số nếu không cần. |
| Điểm/phụ chú | `.game-score`: display 15px, sand; `.game-small`: muted. HUD riêng phải đọc được trên màn hình nhỏ. |
| Action group | `.game-actions`: flex wrap, gap 8px. Gom thao tác chính cạnh bàn/kết quả, không lẫn với navigation. |
| Button phụ | `.game-button`: min-height 44px, padding ngang 13px, viền sáng 2px, góc vuông, shadow đáy 4px như nút “Vào chơi” home; hover nâng 1px, active hạ 3px/giảm shadow, disabled không nổi/chuyển động; nền `--control-bg` (`#203023`), chữ `--control-text`, font `--font-control`. |
| Button chính | `.game-button-primary`: lime, chữ tối; hover sáng hơn. Một CTA chính cho mỗi trạng thái. |
| Disabled | `.game-button:disabled`: opacity .45, cursor not-allowed; dùng thuộc tính `disabled`, không chỉ đổi màu. |
| Hướng dẫn/phím | `.game-help`, `kbd`: đúng phím/gesture của game. Mobile phải có chỉ dẫn chạm, không chỉ có P/C/M. |
| Thông báo | `.game-message`: lime, ẩn khi rỗng; `.is-error`: coral. Thông báo lỗi nói cách phục hồi, không chỉ “thất bại”. |
| Dialog/overlay | Pikachu có native `<dialog>` với title/message/actions, backdrop và góc vuông. Tetris có overlay trong board. Dialog cần focus/đóng/phục hồi focus; kết quả có CTA chơi lại gần nội dung. |
| Icon/menu | `.game-icon-button`: 44×44px, symbol có `aria-label`/`title`; SVG trang trí `aria-hidden`. Chỉ giữ pause/hold/hint/shuffle thiết yếu ngoài board. Nút ☰ mở native `#game-menu` qua `assets/js/game-menu.js`; hướng dẫn và cài đặt sound/restart/mode/size nằm trong menu, có chữ rõ. CTA kết quả/chọn chế độ giữ chữ. |
| Pause/mute/restart | Symbol phản ánh trạng thái thật; toggle dùng `aria-pressed`. Mở menu pause và chặn input game; Escape đóng/trả focus, không tự tiếp tục Tetris/Flappy. Pikachu dừng timer trong menu. Không mở chồng dialog; pause/resume không làm mất tiến trình. PvZ menu ngoài không đảm bảo pause engine: dùng Esc của engine trước. |

Các biến thể `.pika-control`, `.tetris-*`, `.flappy-*` có thể giữ hình dáng riêng, nhưng phải thống nhất focus, vùng chạm, màu semantic và ngôn ngữ action với khung chung.

### Ngoại lệ PvZ

Canvas engine tỷ lệ **16:9**, `image-rendering: auto`; không áp pixelated lên art HD. `.pvz-display` có nền đen; toolbar gồm chất lượng, save và fullscreen, control cao ≥44px. UI nằm bên trong canvas không tự hưởng CSS ngoài game: phải kiểm tra riêng độ dễ đọc/chạm. Fullscreen là tùy chọn, không thay thế bố cục mặc định. Không chỉnh art/âm thanh engine chỉ để giống palette cabinet.

## 6. Trang thư viện và tài liệu

- **Catalog:** `.selection-row` và `.game-feature` chia artwork/copy; mô tả/controls 14px, overline/nhãn kỷ lục 12px, điểm 14px. Portrait ≤760px và cao >500px đặt previous/next trong hàng 44px dưới card, không dùng hai rail lấy chiều ngang; desktop/landscape thấp giữ rail. Phone cao ≤700px ẩn stats phụ, artwork 76px để CTA vẫn hiện. Card giữ artwork riêng, previous/next có tên truy cập và disabled thật. Nội dung dài/zoom vẫn được cuộn; card thông thường không tràn khi đổi game.
- **Search:** `.screen-search`/`.screen-search-toggle`, input và nút cao 44px; trạng thái mở dùng `aria-expanded`. Giữ focus hiển thị, có empty state khi không tìm thấy.
- **Loading/empty/error:** `.selection-loading`, `.loader-pixel`, `.empty-selection`. Luôn có chữ giải thích; loading kéo dài có tiến độ/ngữ cảnh, lỗi có retry phù hợp. Tránh thông báo chạy local trên site live.
- **Contributors:** `.contributor-grid` tự fit cột tối thiểu 280px hoặc toàn chiều rộng; `.contributor-card` có avatar, tên, profile và danh sách game. Link profile/game/chưa ghi nhận có vùng chạm ≥44×44px, nhãn chính 14px; tên/handle dài wrap, không tràn ngang. Giữ link semantic và focus outline chung.
- **Hướng dẫn:** `.page-heading`, `.guide-step`, `.guide-note`, `.guide-local-run`; đoạn đọc 14px cả mobile/landscape, chia bước rõ, code/path wrap hoặc cuộn trong block riêng. Không để nội dung cuối bị mất do chiều cao cố định.
- **Footer/link:** `.deck-link`, `.deck-link-primary`, `aria-current="page"` khi phù hợp. Link dẫn đi dùng `<a>`; thao tác tại chỗ dùng `<button>`.

## 7. Responsive và accessibility

Các breakpoint hiện có nằm trong CSS chung và riêng: 360, 580, 620, 760, 900px; màn hình thấp ≤500px có bố cục riêng. Không thêm breakpoint tùy tiện trước khi thử flex/grid và wrap. `viewport.css` dùng `100dvh` để theo chiều cao browser; shared có `100svh` làm nền tảng.

Yêu cầu khi sửa/thêm game:

1. Kiểm tra 320×568, 390×844, 844×390 và desktop thông thường 1366×768, 1440×900, 1920×1080; xoay trong lúc chơi. Không tràn ngang trang, không kéo méo canvas; action thiết yếu phải dễ tiếp cận.
2. Vùng chạm thao tác ≥44×44px. Focus chung game là outline 3px sand; trang thư viện dùng vàng `#fff2a8`, offset 3px. Không xóa outline.
3. Dùng HTML semantic, label/ARIA cho icon/canvas, `hidden` cho trạng thái không hiển thị; không để phần tử ẩn còn nhận tương tác. Có luồng keyboard và touch tương ứng.
4. Giữ `prefers-reduced-motion`: shared giảm animation/transition về .01ms; loader catalog tắt animation hoàn toàn, không lặp vô hạn với duration cực ngắn. Hiệu ứng mới phải có phương án tắt/giảm, không nhấp nháy mạnh.
5. Texture/scanline chỉ trang trí, `pointer-events: none`; không làm chữ dài khó đọc. Kiểm tra contrast sau khi đổi màu; có CSS/ARIA không đồng nghĩa đã đạt WCAG.
6. Test trang thực và xem screenshot, không chỉ lint/CSS. Kiểm tra font fallback, loading/error, pause, game-over và dữ liệu lưu qua reload.

## 8. Âm thanh và hiệu ứng

Trang chủ có âm boot tổng hợp bằng Web Audio, không cần file âm thanh hoặc dependency. Âm thanh trong từng game giữ cài đặt riêng.

- Boot 300ms, âm lượng nhẹ, tối đa một lần mỗi lần mở trang, chỉ sau click/phím thật (không Tab/phím modifier). Không autoplay, không đợi âm thanh trước khi vào game; API lỗi hoặc storage bị chặn không ảnh hưởng catalog.
- Nút loa `.home-sound` 44×44px ở deck dùng SVG và tên truy cập/title, `aria-pressed="true"` nghĩa là tắt tiếng. Lưu `may-game:v1:home-muted`; mặc định bật, mute ngắt âm đã lên lịch và chặn resume đang chờ. Bấm mute trước không phát boot; bật lại phát nếu chưa yêu cầu boot trong lần mở trang này.
- Card trang chủ fade 160ms (opacity .85→1), chỉ khi `prefers-reduced-motion: no-preference`; không translate cả card vì sẽ làm vùng `overflow: auto` xuất hiện scrollbar thoáng qua. Nút giữ hover/active raised arcade có sẵn.
- Không tự thêm backend, leaderboard online hoặc bộ điều khiển ảo chung như một phần của style.

## 9. Component UX đã cập nhật

- Tetris: “Cách chơi” trong menu giải thích gesture/phím; kết quả có CTA chơi lại/đổi chế độ ngay trên board. Pause overlay vẫn cho phép chạm canvas để tiếp tục. Layout ngang thấp đặt board giữa, HUD/hold trái và next/actions phải.
- Flappy: pause/resume bằng symbol ngoài canvas; mute và hướng dẫn đầy đủ trong menu chung. Hồi sinh ghi rõ một lần/ván; CTA kết quả giữ chữ. Layout ngang thấp đặt hướng dẫn ngắn/actions cạnh board.
- PvZ: gợi ý xoay ngang ở portrait; toolbar ngoài nằm trong menu chung. Loading phân biệt kiểm tra dữ liệu, tải tệp và khởi động engine; native progress chỉ đo số tệp hoàn tất, không phải phần trăm dung lượng/ETA. Lỗi có “Thử lại”, cập nhật lỗi giữ bộ dữ liệu cache đầy đủ. Menu touch bên trong engine và gameplay cần kiểm tra với build WASM.

## 10. Checklist game mới

- Sao chép [template](games/_template/index.html), dùng font/token/component chung và một class trang riêng.
- Giữ cabinet, back link, title, vùng board, action và thông báo theo các mục trên; chỉ override phần gameplay cần khác.
- Đăng ký `games.json`, mô tả controls đúng và ghi nguồn/giấy phép asset theo [CONTRIBUTING.md](CONTRIBUTING.md) và [ASSETS.md](ASSETS.md).
- Kiểm tra đủ viewport/trạng thái; không thêm dependency cho style mà CSS/native HTML đã giải quyết được.
- Nếu thay đổi quy chuẩn dùng chung, cập nhật STYLE.md cùng commit thay vì để từng game tự tạo một phiên bản khác.
