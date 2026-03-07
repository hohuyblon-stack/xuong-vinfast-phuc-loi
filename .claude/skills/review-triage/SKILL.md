---
name: review-triage
description: Triage the CAN KIEM TRA sheet — list pending OCR errors, group by failure type, suggest corrections, and mark resolved items.
---

# Review Triage

You are triaging the CAN KIEM TRA (review queue) sheet for the VinFast Phuc Loi workshop bot.

## Steps

1. **Read pending items** — call `sheets.getAllReviewPending()` or read the sheet directly. Filter rows where col I (Trang thai xu ly) = "Chua xu ly".

2. **Group by failure type** from col G (Ly do):
   - `Anh mo / khong thay bien so` — blurry, need reshoot
   - `OCR doc khong chac` — low confidence, plate may be partially correct
   - `Bien so khong dung dinh dang` — format validation failed

3. **For each item**, suggest:
   - Likely correct plate (if OCR partial match)
   - Action: reshoot / manual correct / skip

4. **Output a triage table**:
   ```
   Ma loi | Bien so AI | Bien so dung (de xuat) | Hanh dong
   ERR-xxx | 30A-1234   | 30A-12345              | Manual correct
   ERR-yyy | (trong)    | -                      | Yeu cau chup lai
   ```

5. **Ask user to confirm** corrections before applying.

6. **On confirmation**, update sheet rows:
   - Col F: corrected plate
   - Col I: "Da xu ly"
   - Col K: reviewer name (ask user if unknown)
   - Col L: current timestamp
   - Col M: linked vehicleId (if plate matched to a DANH SACH CHINH record)

## Notes

- Vietnamese plate regex: `\d{2,3}[A-Z][A-Z0-9]?-?\d{3,5}`
- Common OCR errors: O↔0, I↔1, 5↔S, missing trailing digit
- If corrected plate links to a vehicle in DANH SACH CHINH, populate col M with that vehicleId
