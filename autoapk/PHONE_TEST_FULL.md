# Bản test AutoAPK — 22/10/2026

File cài: **AutoTapHoa_AutoAPK_full_chuc_nang_test.apk** (khoảng 1,13 GB).

## Cài và bật Auto

1. Giữ game gốc. Cài APK này; tên app là **Tiệm Tạp Hóa Auto**, gói riêng `com.longca.taphoa.auto`.
2. Nếu đã cài bản Auto song song bằng khóa test này, có thể cài cập nhật bản đó. Nếu máy báo lỗi, ghi lại thông báo; không gỡ game gốc để thử.
3. Đăng nhập trong app Auto. App có dữ liệu riêng nên có thể cần tải tài nguyên lại.
4. Vào nhân vật, chạm nút **Auto** nổi trên màn hình. Có thể kéo nút sang chỗ khác.
5. Chạm thanh nhóm để chuyển Hằng ngày/Sự kiện/Phim/Nhận thưởng…; chọn mục muốn chạy. Chạm **⚙** để chỉnh số lượt, ngân sách hoặc danh sách vật phẩm/người nhận.
6. Bấm **Chạy đã chọn**. Bấm **Dừng** để ngăn thao tác tiếp theo; request đã gửi cần chờ máy chủ trả kết quả.

## Phạm vi

- Đã nối 93/93 hàm PC hiện hành thành 96 mục Android, gồm nhóm/alias/tác vụ con. Bỏ quản lý giả lập Windows và Tooladmin.
- 191 kiểm tra JavaScript và 22 kiểm tra đóng gói Python đạt. Chữ ký, CRC, căn chỉnh và mã nhúng bốn ABI được kiểm tra độc lập.
- **Chưa test bản này trên điện thoại thật và chưa xác nhận mọi sự kiện chạy thành công.** Đây là bản test để kiểm tra trực tiếp theo yêu cầu của anh.
- Đỉnh Cao xử lý Stage 1 theo luồng PC; gói Mùa Thẻ chọn thẻ tùy ý vẫn chọn trong game. Worker sự kiện cũ cần kiểm tra thêm khi sự kiện mở.
- Nên thử từng tác vụ/nhóm trước khi chọn tất cả. Tác vụ nhóm và tác vụ con đã thành công được chống chạy lặp trong cùng lượt.

## Riêng Mùa Vụ

Mặc định nhận quà/nhiệm vụ/mốc đóng góp/chiến lệnh trước, rồi đọc ủy thác thật. Nếu đã làm việc thì giữ nguyên. Nếu chưa nhận thì chọn nhiệm vụ khả thi cao nhất trên bảng; làm mới miễn phí tối đa 1 lần; giữ trợ thủ cũ, ghép đủ lực và chỉ bắt đầu sau khi xác nhận đúng đội ba người. Không tự hủy nhiệm vụ cũ đang chờ để đổi sang nhiệm vụ cao hơn.

Nếu một tác vụ báo chưa xác nhận, mở đúng giao diện game để đối chiếu và gửi tên tác vụ cùng log/màn hình. Số test đạt không thay cho kết quả từ game thật.

Source và giới hạn chi tiết: `FULL_PORT_STATUS.md`, `FULL_PORT_COVERAGE.json`. ZIP source không chứa APK đầu vào, khóa ký, tài khoản hoặc dữ liệu phiên.
