# Máy Game

Một thư viện game cổ điển chạy trực tiếp trong trình duyệt. Tiến trình được lưu cục bộ trên thiết bị người chơi.

## Chạy cục bộ

```sh
python3 -m http.server 8000
```

Mở `http://localhost:8000`. Trang không cần cài gói hay build.

## Đưa lên GitHub Pages

GitHub Pages miễn phí với repository công khai trên GitHub Free; cả mã nguồn lẫn trang web đều sẽ công khai. Sau khi push nhánh `main`, vào **Settings → Pages** và chọn deploy từ branch `main`, thư mục `/ (root)`. Trang dùng đường dẫn tương đối, kể cả khi xuất bản ở dạng `username.github.io/repository/`.

## Thêm game

Xem [danh sách Contribute](./contributors.html) để biết ai đã góp game, hoặc mở [hướng dẫn Góp game](./contribute.html) để gửi pull request. Mỗi game mới là một thư mục trong `games/`, có một mục đăng ký trong `games.json`.

## Lưu tiến trình

Điểm cao và ván đang chơi được lưu trong `localStorage`. Dữ liệu không đồng bộ giữa thiết bị; xóa dữ liệu trang sẽ xóa tiến trình tương ứng.

## Asset

Các asset và nguồn cấp phép đang dùng được ghi trong [ASSETS.md](./ASSETS.md).
