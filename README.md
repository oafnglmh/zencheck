# Tra cứu dữ liệu văn bằng (Web tĩnh 100% offline)

Web hoàn toàn tĩnh (HTML, CSS, JavaScript thuần) để tra cứu dữ liệu văn bằng từ các file Excel đã số hóa.

- **Chạy trực tiếp offline**: Chỉ cần **bấm đúp chuột vào file `index.html`** trên máy tính là web mở ngay lập tức, **không cần backend, không cần server**.
- **Mỗi file Excel → 1 file JSON**: nằm trong `data/files/<năm>/<id>.json` (kèm file `.js` cùng tên để chạy offline trực tiếp).
- `data/index.json`: danh mục tất cả 620 file (30.984 bản ghi).

---

## 1. Cách xem và tra cứu (Rất đơn giản)

- **Bấm đúp chuột vào file `index.html`** để mở bằng Chrome, Edge, Cốc Cốc, Firefox... bất kỳ.
- Web sẽ tải danh sách tất cả các file và cho phép bạn tìm kiếm ngay lập tức.

---

## 2. Cập nhật dữ liệu khi có file Excel mới

Khi có thêm file Excel mới hoặc sửa các file hiện có trong thư mục `E:\Work_CCE\CCE_SOHOA\CCE_dữ liệu cuối_17102026`:

- Nhấp đúp chạy file **`build.bat`**.
- Script sẽ tự động nhận diện file mới/thay đổi và xuất ra các file dữ liệu tương ứng.

---

## 3. Các tính năng tìm kiếm

- **Tìm kiếm toàn diện**: Có thể chọn tìm trong *Tất cả các cột*, hoặc chỉ định cột cụ thể: *Họ tên*, *Số hiệu bằng*, *Số định danh*, *Ngày sinh*, *Ngành đào tạo*...
- **Tìm kiếm theo tên file**: Tìm theo tên lớp, năm, địa phương có trong tên file Excel.
- **Thêm nhiều điều kiện**: Bấm *＋ Thêm điều kiện* để kết hợp tìm (ví dụ: vừa tìm tên *Hoa*, vừa tìm năm sinh *1978*).
- **Gõ không dấu**: Gõ `nguyen thi hoa` vẫn tìm chính xác `Nguyễn Thị Hoa`.
- **Tùy chọn linh hoạt**:
  - *Khớp nguyên từ*: Tìm `hoa` sẽ không lẫn với `Hoàng`, `Thoa`.
  - *Khớp chính xác cả ô*.
  - *Phân biệt dấu*.
- **Xem chi tiết & Sao chép**: Bấm vào bất kỳ dòng nào để xem popup toàn bộ thông tin bản ghi, bấm phím mũi tên `←` `→` để duyệt nhanh, bấm nút *Sao chép* để copy dữ liệu.
