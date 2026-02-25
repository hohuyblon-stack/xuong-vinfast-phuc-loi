# HƯỚNG DẪN SỬ DỤNG - BẢO VỆ XƯỞNG VINFAST

**Hệ Thống Tracking Xe Vào/Ra** - Telegram Bot + OCR Biển Số

---

## 🚗 CÁCH HOẠT ĐỘNG

Bảo vệ chụp ảnh biển số xe → Gửi vào Telegram bot → Bot tự xác định **VAO** hay **RA** → Dữ liệu lưu vào Google Sheets

---

## 📱 BẮT ĐẦU SỬ DỤNG

### Bước 1: Mở Telegram

- Mở ứng dụng **Telegram** trên điện thoại
- Tìm bot: **@xuong_vinfast_bot**
- Hoặc nhấn link: https://t.me/xuong_vinfast_bot

### Bước 2: Bắt Đầu

- Gữi lệnh: `/start`
- Bot trả lời: xác nhận đã kết nối

### Bước 3: Xem Hướng Dẫn

- Gửi: `HELP`
- Bot sẽ hiển thị tất cả các lệnh

---

## 🚙 GIAO DIỆN CHÍNH

### Chụp Ảnh Biển Số

1. **Chuẩn bị:**
   - Chụp ảnh **trực tiếp** vào biển số xe
   - Ảnh phải **rõ ràng, sáng**, không bị mờ
   - Biển số chiếm ít nhất **1/3 khung hình**
   - Chụp từ góc **thẳng**, không chếch

2. **Gửi ảnh vào bot:**
   - Mở Telegram, tìm bot
   - Nhấn **📎 (icon kẹp giấy)** → **Hình ảnh** (hoặc **Ảnh/Video**)
   - Chọn ảnh vừa chụp
   - Bot sẽ **tự động xử lý**

3. **Bot trả lời:**
   - **Lần 1 (Xe vào):**
     ```
     ✅ ĐÃ GHI VÀO: 30A-12345 lúc 14:30:05
     ```
   - **Lần 2 (Cùng xe ra):**
     ```
     ✅ ĐÃ GHI RA: 30A-12345 lúc 14:45:20
     ⏱️ Lưu xh 15 phút
     ```

---

## 📋 CÁC LỆNH CHÍNH

### Lệnh 1: HELP (Xem Hướng Dẫn)

- **Gửi:** `HELP`
- **Bot trả lời:** Hiển thị tất cả lệnh có sẵn
- **Dùng khi:** Quên cách sử dụng

```
Ví dụ:
Bạn: HELP
Bot: [Danh sách hướng dẫn]
```

### Lệnh 2: TONKHO (Xem Xe Trong Xưởng)

- **Gửi:** `TONKHO`
- **Bot trả lời:** Danh sách xe đang ở trong xưởng
- **Dùng khi:** Muốn kiểm tra tồn kho

```
Ví dụ:
Bạn: TONKHO
Bot:
  Xe trong xưởng (3):
  1. 30A-12345 - Vào lúc 10:00 (4h)
  2. 51B-67890 - Vào lúc 13:30 (30m)
  3. 36C-11111 - Vào lúc 14:15 (15m)
```

### Lệnh 3: /start (Khởi Động)

- **Gửi:** `/start`
- **Bot trả lời:** Xác nhận khởi động
- **Dùng khi:** Bắt đầu phiên làm việc

---

## 🎯 HƯỚNG DẪN CHI TIẾT - TỪNG BƯỚC

### Quy Trình Hoàn Chỉnh

#### 1️⃣ Xe Vào Xưởng
```
1. Xe kéo vào xưởng
2. Bảo vệ chụp ảnh biển số (rõ ràng)
3. Mở Telegram, tìm bot
4. Gửi ảnh
5. Chờ bot trả lời (5-10 giây)
6. Bot: "✅ ĐÃ GHI VÀO: 30A-12345 lúc 14:30:05"
7. Xong! Dữ liệu đã lưu vào Google Sheets
```

#### 2️⃣ Xe Ra Xưởng
```
1. Xe sắp ra xưởng
2. Bảo vệ chụp lại ảnh biển số (cùng xe)
3. Mở Telegram
4. Gửi ảnh vào bot
5. Chờ bot trả lời (5-10 giây)
6. Bot nhận ra cùng xe, trả lời:
   "✅ ĐÃ GHI RA: 30A-12345 lúc 14:45:20"
   "⏱️ Lưu xh 15 phút"
7. Xe ra khỏi xưởng
8. Dữ liệu cập nhật vào Google Sheets (thời gian vào, ra, tổng thời gian)
```

---

## ⚠️ LƯU Ý QUAN TRỌNG

### Chụp Ảnh Đúng Cách

✅ **LÀM ĐÚG:**
- Chụp thẳng vào biển số (góc 90°)
- Biển số rõ ràng, không bị mờ hoặc che khuất
- Ánh sáng đủ, không bị bóng đen che biển số
- Chụp từ khoảng cách vừa đủ để nhìn rõ
- Biển số chiếm khoảng 1/3 - 1/2 khung hình

❌ **TỪ ĐÂY:**
- Chụp từ góc quá chéch (không thẳng)
- Biển số mờ, không rõ các ký tự
- Chụp từ quá xa, biển số quá nhỏ
- Chụp từ quá gần, bị cắt một phần
- Ánh sáng yếu, bóng che mặt biển số
- Bị nước bẩn hoặc bụi che biển số

### Nếu Ảnh Không Được Nhận Diện

- **Lần đầu:** Bot sẽ **kiểm tra lại** (có thể mất 30-60 giây)
- **Nếu vẫn thất bại:** Bảo vệ cần **chụp lại** ảnh rõ hơn
- **Ảnh lỗi sẽ được lưu** vào tab **CAN KIEM TRA** trong Google Sheets để quản lý kiểm tra sau

### Khi Nào Liên Hệ Quản Lý

- ❓ Bot không phản hồi
- ❓ Ảnh gửi nhưng bot không nhận
- ❓ Ghi nhập sai xe
- ❓ Bot trả lời lỗi

---

## 📊 DỮ LIỆU ĐƯỢC LƯU

### Thông Tin Mỗi Xe
- **Biển số:** 30A-12345
- **Thời gian vào:** 14:30:05
- **Thời gian ra:** 14:45:20
- **Tổng thời gian lưu:** 15 phút
- **Ảnh lúc vào:** (link ảnh)
- **Ảnh lúc ra:** (link ảnh)
- **Trạng thái:** Đã ra / Đang trong
- **Ghi chú:** (nếu quản lý thêm)

### Nơi Lưu Dữ Liệu
- **Google Sheets:** Xưởng VinFast Phúc Lợi
- **3 tab chính:**
  1. **DANH SACH CHINH:** Danh sách tất cả xe vào/ra
  2. **NHAT KY:** Chi tiết mỗi lần chụp ảnh
  3. **CAN KIEM TRA:** Ảnh lỗi cần kiểm tra lại

---

## 🔔 CẢNH BÁO TỰ ĐỘNG

Bot sẽ **tự động cảnh báo** nếu xe lưu quá lâu:

- ⏰ **Sau 24 giờ:** Gửi cảnh báo (mức độ: *Cảnh báo*)
- ⏰ **Sau 48 giờ:** Gửi cảnh báo (mức độ: *Khẩn*)
- Cảnh báo được gửi cho **quản lý** (nếu được cấu hình)

---

## 🆘 XỬ LÝ SỰ CỐ

### Tình Huống 1: Bot Không Phản Hồi

**Nguyên nhân:**
- Server bị đứt internet
- Bot bị tắt

**Cách khắc phục:**
1. Kiểm tra kết nối internet điện thoại (có 4G/Wi-Fi không?)
2. Thử gửi lệnh `/start` để kiểm tra
3. Nếu vẫn không sao, thông báo cho quản lý

### Tình Huống 2: Ảnh Gửi Đi Nhưng Bot Không Nhận

**Nguyên nhân:**
- Internet yếu, ảnh upload không xong
- Bot bị lỗi xử lý ảnh

**Cách khắc phục:**
1. Chụp lại ảnh khác (rõ hơn, ảnh nhỏ hơn)
2. Gửi lại vào bot
3. Nếu vẫn không được, chụp ảnh khác và gửi lần nữa

### Tình Huống 3: Ghi Sai Thông Tin

**Ví dụ:** Chụp ảnh xe 30A-12345 nhưng Bot ghi thành 30A-12346

**Cách khắc phục:**
1. **Thông báo ngay cho quản lý**
2. Quản lý sẽ:
   - Xóa dữ liệu sai
   - Bảo vệ gửi lại ảnh rõ hơn
3. Bot sẽ xử lý lại và ghi đúng

### Tình Huống 4: Chụp Ảnh Không Rõ

**Dấu hiệu:**
- Bot trả lời: "Không đọc được biển số, vui lòng chụp lại"
- Hoặc ảnh xuất hiện trong tab **CAN KIEM TRA**

**Cách khắc phục:**
1. Chụp lại ảnh **rõ hơn, sáng hơn**
2. Đảm bảo biển số **chiếm đủ khung hình**
3. Chụp từ góc **thẳng**
4. Gửi lại vào bot

---

## 📞 LIÊN HỆ & HỖ TRỢ

### Khi Có Vấn Đề

**Liên hệ người quản lý:**
- Điện thoại: [Số điện thoại quản lý]
- Telegram: [ID Telegram quản lý]
- Email: [Email công ty]

**Thông tin cần cung cấp:**
- Biển số xe có vấn đề
- Thời gian xảy ra sự cố
- Ảnh minh chứng (nếu có)

---

## 💡 MẸO & THỦ THUẬT

### Mẹo 1: Gửi Ảnh Nhanh

- Đặt Telegram trên **thanh tìm nhanh** (home screen) để truy cập nhanh
- Hoặc tạo **shortcut** để mở bot ngay

### Mẹo 2: Chụp Ảnh Chất Lượng

- **Ánh sáng:** Chụp vào giờ sáng hoặc dùng đèn flash
- **Góc:** Chụp từ **trực diện** hoặc **45 độ** (không chéch quá)
- **Khoảng cách:** Chụp từ **1-2 mét**, không quá gần, không quá xa
- **Khung hình:** Để biển số **ở giữa** khung ảnh

### Mẹo 3: Kiểm Tra Trước Khi Gửi

- Trước khi gửi, **xem lại ảnh**:
  - Biển số có rõ không?
  - Ánh sáng có đủ không?
  - Góc chụp có thẳng không?
- Nếu không ổn, chụp lại rồi mới gửi

### Mẹo 4: Xem Lịch Sử

- Trong Telegram bot, có thể **scroll up** để xem lịch sử các lệnh
- Giúp kiểm tra những xe đã gửi trước đó

---

## 🎓 ĐIỀU CẦN NHỚ

**✓ Quy Trình:**
1. Xe vào → Chụp ảnh → Gửi bot → Ghi VÀO
2. Xe ra → Chụp ảnh → Gửi bot → Ghi RA

**✓ Chất Lượng Ảnh:**
- Rõ ràng, sáng, thẳng
- Biển số chiếm 1/3 - 1/2 khung

**✓ Cách Gửi:**
- Mở bot, nhấn **📎** → **Hình ảnh**
- Chọn ảnh rồi gửi
- Chờ bot trả lời

**✓ Thời Gian Chờ:**
- Bình thường: 5-10 giây
- Nếu Internet yếu: có thể lên đến 30 giây

**✓ Khi Có Lỗi:**
- Thông báo quản lý ngay
- Cung cấp thông tin chi tiết

---

## 📅 PHÂN CA / GIAO CA

### Kiểm Tra Vào Đầu Ca

```
1. Mở Telegram bot
2. Gửi: TONKHO
3. Bot hiển thị xe đang trong xưởng từ ca trước
4. Ghi nhận thông tin
5. Bắt đầu theo dõi xe trong ca hôm nay
```

### Giao Ca Cho Ca Tiếp Theo

```
1. Tại thời điểm giao ca:
2. Gửi lệnh: TONKHO
3. Bot hiển thị danh sách xe chưa ra
4. Giao danh sách cho bảo vệ ca tiếp theo
5. Cả hai xác nhận danh sách (để tránh sai sót)
```

---

## 🔒 BẢO MẬT

- **Không chia sẻ:** Bot username/token với người lạ
- **Không chỉnh sửa:** Dữ liệu trong Google Sheets (chỉ quản lý)
- **Thông báo ngay:** Nếu nghi ngờ có người lạ sử dụng bot

---

## ❓ CÂU HỎI THƯỜNG GẶP

**Q: Nếu chụp ảnh mà biển số quá mờ sao?**
A: Chụp lại ảnh khác sáng hơn, làm sạch kính camera, rồi gửi lại.

**Q: Một lần chụp 2 xe được không?**
A: Không, mỗi ảnh chỉ chứa **1 xe**. Nếu 2 xe, phải chụp 2 ảnh riêng biệt.

**Q: Có thể xóa hoặc sửa lại dữ liệu không?**
A: Bảo vệ không được phép xóa. Nếu có sai sót, báo cáo cho quản lý để sửa.

**Q: Bot có thể nhận biết chính xác biển số không?**
A: Hầu hết các trường hợp rõ ràng, tỷ lệ thành công 95%+. Nếu ảnh xấu, bot sẽ yêu cầu chụp lại.

**Q: Dữ liệu được lưu ở đâu?**
A: Google Sheets - dịch vụ lưu trữ đám mây của Google, tự động sao lưu, an toàn.

**Q: Nếu quên lệnh thì sao?**
A: Gửi `HELP` để xem tất cả lệnh và cách dùng.

---

## 📌 QUICK REFERENCE

| Cần | Lệnh | Bot Trả Lời |
|-----|------|------------|
| Bắt đầu | `/start` | Xác nhận khởi động |
| Xem hướng dẫn | `HELP` | Danh sách lệnh |
| Xem tồn kho | `TONKHO` | Danh sách xe trong xưởng |
| Ghi vào/ra | Gửi ảnh | ✅ Xác nhận + thời gian |

---

**Sử dụng thành thạo hệ thống = Quản lý tốt xe = Hiệu suất cao!** 🚗✅

Nếu có bất kỳ câu hỏi, liên hệ quản lý ngay!

**Chúc bạn làm việc hiệu quả!** 💪
