# HƯỚNG DẪN SỬ DỤNG
## Bot Theo Dõi Xe VinFast Phúc Lợi

---

## BOT LÀM GÌ?

Bạn chỉ cần **chụp ảnh biển số xe** và gửi lên Telegram.
Bot tự động nhận ra xe đó đang **VÀO** hay **RA** xưởng và ghi vào bảng theo dõi.

Không cần gõ gì thêm. Chỉ cần gửi ảnh.

---

## CÁCH DÙNG

### Bước 1 — Mở Telegram, vào đúng nhóm/chat của bot

### Bước 2 — Chụp ảnh biển số xe

Chụp sao cho:
- Biển số **rõ nét**, không bị mờ
- **Chụp thẳng** vào biển số (không chụp nghiêng)
- Đủ sáng, không bị bóng tối che

### Bước 3 — Gửi ảnh lên Telegram

Nhấn nút gửi ảnh như bình thường.

### Bước 4 — Đợi bot trả lời (thường dưới 10 giây)

---

## BOT TRẢ LỜI GÌ?

**Xe vào xưởng:**
```
DA GHI VAO: 51F-123.45
Luc: 08:30 27/02/2026
Ma luot: VH-20260227-083012
```

**Xe ra xưởng:**
```
DA GHI RA: 51F-123.45
Luc: 17:15 27/02/2026
Thoi gian luu: 8 gio 45 phut
Ma luot: VH-20260227-083012
```

Bot tự biết xe đang VÀO hay RA — bạn không cần chọn.

---

## KHI BỊ LỖI

| Bot nói gì | Nghĩa là gì | Làm gì |
|---|---|---|
| *"Không đọc rõ biển số"* | Ảnh mờ | Chụp lại rõ hơn |
| *"Đọc biển số không chắc chắn"* | Ảnh chưa đủ rõ | Chụp lại, chụp thẳng hơn |
| *"Biển số không đúng định dạng"* | AI đọc nhầm | Chụp lại gần hơn |
| *"Vui lòng gửi ảnh"* | Bạn gửi chữ thay vì ảnh | Gửi ảnh, không gửi tin nhắn chữ |

---

## MẸO CHỤP ẢNH ĐẸP

✅ Chụp gần, biển số chiếm phần lớn ảnh
✅ Chụp vuông góc, không nghiêng
✅ Đủ ánh sáng
✅ Không che khuất biển số

❌ Không chụp từ xa quá
❌ Không chụp ngược sáng
❌ Không để tay/vật che biển số

---

## LƯU Ý QUAN TRỌNG

- **Mỗi xe chỉ cần chụp 1 lần** khi vào và **1 lần** khi ra
- Nếu bot không trả lời sau 30 giây, thử gửi lại ảnh
- Không cần gõ chữ — bot chỉ xử lý ảnh

---

*Hệ thống ghi nhận tự động 24/7. Dữ liệu được lưu vào Google Sheets.*
