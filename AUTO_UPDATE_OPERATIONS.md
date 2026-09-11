# AutoTapHoa – Quy trình phát hành và Auto Update

> Tài liệu vận hành chính thức cho mọi AI/nhân sự phụ trách build và đưa bản cập nhật AutoTapHoa lên GitHub.
>
> Repository phát hành: https://github.com/lamdungcm/autotaphoa-update

## 1. Phạm vi và nguyên tắc bắt buộc

Repository này chỉ dùng để phát hành cho khách hàng và lưu tài liệu vận hành Auto Update.

Được phép đưa lên:

- File ZIP cài đặt/phát hành của khách.
- File `.sha256`.
- File `manifest.json`.
- Release notes và tài liệu vận hành không chứa bí mật.

Tuyệt đối không đưa lên:

- Mã nguồn Python hoặc file `.py`.
- Tool Admin, AdminKeygen, keygen, license generator.
- Source/build/staging/dist nội bộ.
- Thư mục backup nội bộ.
- Dữ liệu xe, cấu hình, tài khoản, token, mật khẩu, UUID hoặc dữ liệu riêng của khách.
- API key, private key, credential hoặc log có dữ liệu nhạy cảm.

Không được sửa Tool Admin chỉ để làm bản phát hành khách. Bản phát hành khách phải được tạo từ source hiện hành sau khi kiểm tra; không lấy source từ backup cũ thay cho source hiện hành.

## 2. Các thư mục chuẩn trên máy build

- Source hiện hành: `D:\requestld`
- File điều khiển build duy nhất: `D:\requestld\Tooladmin\build_release\2_Dong_Goi_File_EXE.bat`
- Thư mục chứa bản gửi khách: `D:\requestld\file build gui khach`
- Backup nội bộ: `D:\requestld\Tooladmin\build_release\backup\`
- Log build: `D:\requestld\Tooladmin\build_release\logs\`
- Version ứng dụng: kiểm tra `D:\requestld\auto\version.py`

Không tự ý tạo thêm nhiều thư mục phát hành. Sau build, thư mục gửi khách chỉ được chứa ZIP, SHA-256 và manifest của bản đang phát hành.

## 3. Quy tắc version và tên file

Version phải theo dạng bốn số: `MAJOR.MINOR.PATCH.BUILD`, ví dụ `2.0.0.1`.

Tên bắt buộc:

- ZIP: `AutoTapHoa_v2.0.0.1.zip`
- Hash: `AutoTapHoa_v2.0.0.1.sha256`
- Release tag: `v2.0.0.1`
- Release title: `AutoTapHoa v2.0.0.1`

Không đổi tên tùy ý, không dùng tên có ngày giờ làm tên bản chính, không ghi đè một version đã phát hành. Nếu cần sửa bản đã phát hành, tạo version tăng lên.

## 4. Cơ chế cập nhật của ứng dụng khách

Ứng dụng đọc manifest, so sánh version hiện tại với version trên server. Khi có version mới:

1. Tải manifest và kiểm tra JSON.
2. Tải ZIP cập nhật.
3. Kiểm tra SHA-256 trước khi thay file.
4. Đóng ứng dụng AutoTapHoa trước khi cập nhật.
5. Tạo backup bản đang chạy để rollback.
6. Thay file chương trình an toàn.
7. Giữ nguyên dữ liệu khách trong `%APPDATA%\AutoGameLD`, gồm catalog xe, cấu hình, UUID/id xe, thiết lập và dữ liệu được updater bảo vệ.
8. Mở lại bản mới.
9. Nếu cập nhật lỗi, rollback bản trước và ghi log.

Không được xóa hoặc thay thế dữ liệu khách chỉ vì cập nhật file EXE.

## 5. URL phát hành chuẩn

URL manifest ổn định đề xuất cho ứng dụng:

`https://github.com/lamdungcm/autotaphoa-update/releases/latest/download/manifest.json`

Mỗi manifest phải trỏ đến đúng ZIP của release tương ứng, ví dụ:

`https://github.com/lamdungcm/autotaphoa-update/releases/download/v2.0.0.1/AutoTapHoa_v2.0.0.1.zip`

Không dùng lại URL miền cũ `update.anhlongauto.com` nếu chưa cấu hình DNS/server thật.

Lưu ý chuyển tiếp: các bản khách cũ đang trỏ URL cũ sẽ không tự biết repository GitHub. Cần tạo một bản bridge thủ công, trong đó đổi `DEFAULT_MANIFEST_URL` sang URL GitHub ổn định, build và gửi một lần cho khách. Từ bản bridge trở đi, các bản sau có thể tự cập nhật.

## 6. Quy trình bắt buộc khi có yêu cầu “update”

AI phải đọc tài liệu này trước khi làm. Sau đó thực hiện theo thứ tự:

1. Kiểm tra source hiện hành tại `D:\requestld`; xác định thay đổi đã nằm trong source chưa.
2. Không sửa Tool Admin, source không liên quan hoặc dữ liệu khách.
3. Kiểm tra version hiện tại trong `auto\version.py`; tăng version đúng quy tắc nếu có thay đổi.
4. Chạy build duy nhất bằng `Tooladmin\build_release\2_Dong_Goi_File_EXE.bat`.
5. Xác nhận build đã tự backup source/release trước khi tạo bản mới.
6. Kiểm tra thư mục gửi khách chỉ có đúng các file phát hành.
7. Tính SHA-256 lại từ ZIP thực tế; không tin hash cũ nếu ZIP đã thay đổi.
8. Tạo manifest với version, release name, URL ZIP đúng tag, SHA-256 đúng, ngày phát hành và release notes.
9. Kiểm tra ZIP không chứa source, Tool Admin, license/keygen, backup nội bộ hay dữ liệu động của khách.
10. Tạo GitHub Release tag tương ứng và đưa lên đúng ba file: ZIP, SHA-256, manifest.
11. Kiểm tra lại link tải ở chế độ công khai, JSON manifest, hash và dung lượng ZIP.
12. Báo cáo cho người dùng: version, URL release, URL manifest, SHA-256, kết quả kiểm tra và các giới hạn còn lại.

Nếu một bước thất bại thì không được báo “đã phát hành thành công”.

## 7. Checklist kiểm tra trước khi gửi khách

- [ ] EXE mở được trên máy không có Python/Tkinter cài sẵn.
- [ ] EXE có icon đúng.
- [ ] ZIP chỉ chứa thành phần khách cần chạy.
- [ ] Không có `.py`, source, admin tool, keygen, license generator hoặc backup nội bộ.
- [ ] Có `AutoTapHoa_Updater.exe`.
- [ ] Manifest JSON hợp lệ.
- [ ] SHA-256 trong manifest trùng hash ZIP thực tế.
- [ ] URL manifest và URL ZIP truy cập được từ máy ngoài.
- [ ] Version mới lớn hơn version cũ.
- [ ] Updater đóng app trước khi thay file.
- [ ] Dữ liệu trong `%APPDATA%\AutoGameLD` còn nguyên sau update.
- [ ] Có thử rollback khi ZIP sai hash hoặc cập nhật lỗi.
- [ ] Không báo hoàn tất nếu chưa kiểm tra link thật.

## 8. Cấu trúc Release mẫu

Mỗi GitHub Release:

```
v2.0.0.1
├── AutoTapHoa_v2.0.0.1.zip
├── AutoTapHoa_v2.0.0.1.sha256
└── manifest.json
```

File `manifest.json` mẫu:

```json
{
  "version": "2.0.0.1",
  "release_name": "AutoTapHoa_v2.0.0.1",
  "download_url": "https://github.com/lamdungcm/autotaphoa-update/releases/download/v2.0.0.1/AutoTapHoa_v2.0.0.1.zip",
  "sha256": "<SHA256 CUA ZIP THUC TE>",
  "release_date": "YYYY-MM-DD",
  "minimum_supported_version": "2.0.0.0",
  "release_notes": "Mo ta ngan gon thay doi va cach khac phuc neu co."
}
```

## 9. Quy tắc cho AI tiếp nhận sau này

Khi AI mới được giao việc phát hành:

- Đọc file này trước, kiểm tra repository và source hiện hành.
- Không suy đoán rằng đã build/upload nếu chưa kiểm tra kết quả thật.
- Không tạo thêm repo hoặc URL mới khi chưa có yêu cầu.
- Không upload source hoặc công cụ quản trị.
- Không ghi đè dữ liệu khách.
- Không lấy backup cũ làm source.
- Nếu cần sửa tính năng, sửa source trước; build/release chỉ là bước đóng gói sau cùng.
- Nếu người dùng chỉ yêu cầu build, không tự sửa chức năng.
- Nếu người dùng yêu cầu update, phải tạo version mới và release mới.
- Nếu upload binary lớn không thực hiện được bằng công cụ hiện tại, phải nói rõ chưa upload và không giả vờ hoàn tất; có thể hoàn thành phần tài liệu/manifest nhưng phải đánh dấu phát hành chưa hoàn tất.

## 10. Trạng thái ban đầu của repository

Repository được tạo để thay thế URL update cũ. Bản ZIP hiện có ở máy build là `AutoTapHoa_v2.0.0.0.zip`. Trước khi phát hành cho khách, cần bảo đảm manifest của release trỏ về URL GitHub của chính release đó, không còn trỏ `update.anhlongauto.com`.

Cập nhật tài liệu này mỗi khi thay đổi quy trình, tên file, cơ chế updater hoặc chính sách bảo toàn dữ liệu.
