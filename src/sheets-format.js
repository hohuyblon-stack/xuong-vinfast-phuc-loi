'use strict';

/**
 * Professional Google Sheets formatting for VinFast Workshop reports.
 *
 * Design system:
 * - Primary:    #1a73e8 (header blue)
 * - Surface:    #f8f9fa (light background)
 * - Section:    #e8eaed (section dividers)
 * - Urgent:     #fce4ec (soft red)
 * - Warning:    #fff8e1 (soft amber)
 * - Normal:     #e8f5e9 (soft green)
 * - Completed:  #e3f2fd (soft blue)
 * - Text:       #202124 (near-black)
 * - Subtle:     #5f6368 (grey)
 * - Border:     #dadce0 (light border)
 */

const COLORS = {
  primary:    { red: 0.102, green: 0.451, blue: 0.910 },
  white:      { red: 1, green: 1, blue: 1 },
  surface:    { red: 0.973, green: 0.976, blue: 0.980 },
  section:    { red: 0.910, green: 0.918, blue: 0.929 },
  urgent:     { red: 0.988, green: 0.894, blue: 0.906 },
  warning:    { red: 1, green: 0.973, blue: 0.882 },
  normal:     { red: 0.910, green: 0.961, blue: 0.914 },
  completed:  { red: 0.890, green: 0.949, blue: 0.992 },
  summary:    { red: 0.957, green: 0.961, blue: 0.965 },
  text:       { red: 0.125, green: 0.129, blue: 0.141 },
  subtle:     { red: 0.373, green: 0.388, blue: 0.416 },
  border:     { red: 0.855, green: 0.867, blue: 0.878 },
  borderDark: { red: 0.741, green: 0.753, blue: 0.769 },
};

const FONT_FAMILY = 'Google Sans';
const FONT_FALLBACK = 'Roboto';

// Column indices for 10-col daily report
const COL = { stt: 0, type: 1, plate: 2, model: 3, timeIn: 4, timeOut: 5, duration: 6, priority: 7, status: 8, note: 9 };

// ──────────────────────────────────────────────
// Main export: build ALL formatting for daily report tab
// ──────────────────────────────────────────────

function buildDailyReportFormatting(sheetId, totalRows, totalCols, sectionRowIndices, summaryRowIndex) {
  const requests = [];

  // 1. Global defaults: font, text color, alignment
  requests.push(globalDefaults(sheetId, totalRows, totalCols));

  // 2. Header row: blue background, white bold text
  requests.push(headerRow(sheetId, totalCols));

  // 3. Freeze header + set row height
  requests.push(freezeHeader(sheetId));
  requests.push(setRowHeight(sheetId, 0, 36)); // header taller

  // 4. Column widths (manual for clean look)
  requests.push(...columnWidths(sheetId));

  // 5. Column alignments
  requests.push(alignCenter(sheetId, totalRows, COL.stt));       // STT
  requests.push(alignCenter(sheetId, totalRows, COL.type));      // Loại
  requests.push(alignCenter(sheetId, totalRows, COL.duration));  // Thời gian
  requests.push(alignCenter(sheetId, totalRows, COL.priority));  // Ưu Tiên
  requests.push(alignCenter(sheetId, totalRows, COL.status));    // Trạng Thái
  requests.push(alignCenter(sheetId, totalRows, COL.model));     // Loại xe

  // 6. Alternating row colors (banding)
  requests.push(banding(sheetId, totalRows, totalCols, sectionRowIndices));

  // 7. Section headers: grey bar, bold, merged text feel
  for (const rowIdx of sectionRowIndices) {
    requests.push(sectionHeaderRow(sheetId, rowIdx, totalCols));
    requests.push(setRowHeight(sheetId, rowIdx, 30));
  }

  // 8. Summary row: distinct styling
  if (summaryRowIndex != null) {
    requests.push(summaryRow(sheetId, summaryRowIndex, totalCols));
    requests.push(setRowHeight(sheetId, summaryRowIndex, 32));
  }

  // 9. Conditional formatting: priority colors (entire row, not just cell)
  requests.push(...priorityRowColors(sheetId, totalRows, totalCols));

  // 10. Conditional formatting: status column
  requests.push(...statusColors(sheetId, totalRows));

  // 11. Borders: clean outer + subtle inner
  requests.push(outerBorder(sheetId, totalRows, totalCols));
  requests.push(innerBorders(sheetId, totalRows, totalCols));

  // 12. Header bottom border: thick dark line
  requests.push(headerBottomBorder(sheetId, totalCols));

  return requests;
}

// ──────────────────────────────────────────────
// Also format the main "DANH SÁCH CHÍNH" tab
// ──────────────────────────────────────────────

function buildMainSheetFormatting(sheetId, totalRows, totalCols) {
  const requests = [];
  requests.push(globalDefaults(sheetId, totalRows, totalCols));
  requests.push(headerRow(sheetId, totalCols));
  requests.push(freezeHeader(sheetId));
  requests.push(setRowHeight(sheetId, 0, 36));
  requests.push(outerBorder(sheetId, totalRows, totalCols));
  requests.push(innerBorders(sheetId, totalRows, totalCols));
  requests.push(headerBottomBorder(sheetId, totalCols));
  return requests;
}

// ──────────────────────────────────────────────
// Request builders
// ──────────────────────────────────────────────

function globalDefaults(sheetId, totalRows, totalCols) {
  return {
    repeatCell: {
      range: gridRange(sheetId, 1, totalRows, 0, totalCols),
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontFamily: FONT_FAMILY,
            fontSize: 10,
            foregroundColor: COLORS.text,
          },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        },
      },
      fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)',
    },
  };
}

function headerRow(sheetId, totalCols) {
  return {
    repeatCell: {
      range: gridRange(sheetId, 0, 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.primary,
          textFormat: {
            fontFamily: FONT_FAMILY,
            fontSize: 10,
            bold: true,
            foregroundColor: COLORS.white,
          },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          padding: { top: 6, bottom: 6, left: 8, right: 8 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
    },
  };
}

function freezeHeader(sheetId) {
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  };
}

function setRowHeight(sheetId, rowIndex, height) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
      properties: { pixelSize: height },
      fields: 'pixelSize',
    },
  };
}

function columnWidths(sheetId) {
  // STT:50, Loại:120, Biển Số:110, Loại xe:100, Giờ Vào:150, Giờ Ra:150, Thời gian:90, Ưu Tiên:100, Trạng Thái:120, Ghi chú:180
  const widths = [50, 120, 110, 100, 150, 150, 90, 100, 120, 180];
  return widths.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  }));
}

function alignCenter(sheetId, totalRows, colIndex) {
  return {
    repeatCell: {
      range: gridRange(sheetId, 1, totalRows, colIndex, colIndex + 1),
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  };
}

function banding(sheetId, totalRows, totalCols, skipRows) {
  // Use addBanding for clean alternating rows
  return {
    addBanding: {
      bandedRange: {
        range: gridRange(sheetId, 1, totalRows, 0, totalCols),
        rowProperties: {
          headerColor: COLORS.white,
          firstBandColor: COLORS.white,
          secondBandColor: COLORS.surface,
        },
      },
    },
  };
}

function sectionHeaderRow(sheetId, rowIndex, totalCols) {
  return {
    repeatCell: {
      range: gridRange(sheetId, rowIndex, rowIndex + 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.section,
          textFormat: {
            fontFamily: FONT_FAMILY,
            fontSize: 10,
            bold: true,
            foregroundColor: COLORS.text,
          },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          padding: { left: 8 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
    },
  };
}

function summaryRow(sheetId, rowIndex, totalCols) {
  return {
    repeatCell: {
      range: gridRange(sheetId, rowIndex, rowIndex + 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.summary,
          textFormat: {
            fontFamily: FONT_FAMILY,
            fontSize: 11,
            bold: true,
            foregroundColor: COLORS.text,
          },
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
    },
  };
}

function priorityRowColors(sheetId, totalRows, totalCols) {
  // Color the ENTIRE row based on priority value (not just priority cell)
  const rules = [
    { text: 'Khẩn', color: COLORS.urgent },
    { text: 'Cảnh báo', color: COLORS.warning },
  ];

  return rules.map((rule, idx) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange(sheetId, 1, totalRows, 0, totalCols)],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: `=$H2="${rule.text}"` }],
          },
          format: { backgroundColor: rule.color },
        },
      },
      index: idx,
    },
  }));
}

function statusColors(sheetId, totalRows) {
  const rules = [
    { text: 'Đã ra xưởng', color: COLORS.completed },
    { text: 'Đang trong xưởng', color: COLORS.normal },
  ];

  return rules.map((rule, idx) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange(sheetId, 1, totalRows, COL.status, COL.status + 1)],
        booleanRule: {
          condition: {
            type: 'TEXT_CONTAINS',
            values: [{ userEnteredValue: rule.text }],
          },
          format: { backgroundColor: rule.color },
        },
      },
      index: idx + 10, // offset to not conflict with priority rules
    },
  }));
}

function outerBorder(sheetId, totalRows, totalCols) {
  return {
    updateBorders: {
      range: gridRange(sheetId, 0, totalRows, 0, totalCols),
      top:    { style: 'SOLID', width: 2, color: COLORS.borderDark },
      bottom: { style: 'SOLID', width: 2, color: COLORS.borderDark },
      left:   { style: 'SOLID', width: 2, color: COLORS.borderDark },
      right:  { style: 'SOLID', width: 2, color: COLORS.borderDark },
    },
  };
}

function innerBorders(sheetId, totalRows, totalCols) {
  return {
    updateBorders: {
      range: gridRange(sheetId, 0, totalRows, 0, totalCols),
      innerHorizontal: { style: 'SOLID', width: 1, color: COLORS.border },
      innerVertical:   { style: 'SOLID', width: 1, color: COLORS.border },
    },
  };
}

function headerBottomBorder(sheetId, totalCols) {
  return {
    updateBorders: {
      range: gridRange(sheetId, 0, 1, 0, totalCols),
      bottom: { style: 'SOLID_MEDIUM', width: 2, color: COLORS.borderDark },
    },
  };
}

// ──────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────

function gridRange(sheetId, startRow, endRow, startCol, endCol) {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

// ──────────────────────────────────────────────
// Dashboard tab (TỔNG QUAN) formatting
// ──────────────────────────────────────────────

/**
 * Build formatting requests for the dashboard tab.
 *
 * @param {number} sheetId
 * @param {Array<{type: string, startRow: number, endRow: number, level?: string, columns?: number}>} blockPositions
 * @param {number} totalRows
 * @param {number} totalCols
 * @returns {Array} Sheets API formatting requests
 */
function buildDashboardFormatting(sheetId, blockPositions, totalRows, totalCols) {
  const requests = [];

  // 1. Global font defaults
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, totalRows, 0, totalCols),
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontFamily: FONT_FAMILY,
            fontSize: 10,
            foregroundColor: COLORS.text,
          },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        },
      },
      fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)',
    },
  });

  // 2. Column widths: A=220px, B=150px, C-F=120px
  const dashWidths = [220, 150, 120, 120, 120, 150];
  for (let i = 0; i < Math.min(dashWidths.length, totalCols); i++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: dashWidths[i] },
        fields: 'pixelSize',
      },
    });
  }

  // 3. Process each block
  for (const block of blockPositions) {
    if (block.type === 'summary') {
      // Header row: bold, blue background, white text, font 12, merge A-B
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow, block.startRow + 1, 0, totalCols),
          cell: {
            userEnteredFormat: {
              backgroundColor: COLORS.primary,
              textFormat: {
                fontFamily: FONT_FAMILY,
                fontSize: 12,
                bold: true,
                foregroundColor: COLORS.white,
              },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
              padding: { left: 8 },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
        },
      });
      // Merge header cells across all columns
      requests.push({
        mergeCells: {
          range: gridRange(sheetId, block.startRow, block.startRow + 1, 0, totalCols),
          mergeType: 'MERGE_ALL',
        },
      });
      // Bold labels (col A), right-align values (col B)
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow + 1, block.endRow, 0, 1),
          cell: {
            userEnteredFormat: {
              textFormat: { fontFamily: FONT_FAMILY, fontSize: 11, bold: true, foregroundColor: COLORS.text },
              padding: { left: 12 },
            },
          },
          fields: 'userEnteredFormat(textFormat,padding)',
        },
      });
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow + 1, block.endRow, 1, 2),
          cell: {
            userEnteredFormat: {
              textFormat: { fontFamily: FONT_FAMILY, fontSize: 11, bold: true, foregroundColor: COLORS.primary },
              horizontalAlignment: 'LEFT',
            },
          },
          fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
        },
      });
      // Light surface background for summary data rows
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow + 1, block.endRow, 0, totalCols),
          cell: { userEnteredFormat: { backgroundColor: COLORS.surface } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }

    if (block.type === 'alert') {
      const bgColor = block.level === 'urgent' ? COLORS.urgent : COLORS.warning;
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow, block.endRow, 0, totalCols),
          cell: {
            userEnteredFormat: {
              backgroundColor: bgColor,
              textFormat: { fontFamily: FONT_FAMILY, fontSize: 10, foregroundColor: COLORS.text },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
      // Bold the header line of each alert block
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow, block.startRow + 1, 0, totalCols),
          cell: {
            userEnteredFormat: {
              textFormat: { fontFamily: FONT_FAMILY, fontSize: 11, bold: true, foregroundColor: COLORS.text },
            },
          },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }

    if (block.type === 'table') {
      const cols = block.columns || totalCols;
      // Table header: blue background, white bold text
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow, block.startRow + 1, 0, cols),
          cell: {
            userEnteredFormat: {
              backgroundColor: COLORS.primary,
              textFormat: {
                fontFamily: FONT_FAMILY,
                fontSize: 10,
                bold: true,
                foregroundColor: COLORS.white,
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              padding: { top: 4, bottom: 4, left: 6, right: 6 },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
        },
      });
      // Alternating rows for table data
      const dataRows = block.endRow - block.startRow - 1;
      for (let r = block.startRow + 1; r < block.endRow; r++) {
        const isEven = (r - block.startRow - 1) % 2 === 0;
        requests.push({
          repeatCell: {
            range: gridRange(sheetId, r, r + 1, 0, cols),
            cell: {
              userEnteredFormat: {
                backgroundColor: isEven ? COLORS.white : COLORS.surface,
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        });
      }
      // Borders for the table
      requests.push({
        updateBorders: {
          range: gridRange(sheetId, block.startRow, block.endRow, 0, cols),
          top:    { style: 'SOLID', width: 1, color: COLORS.borderDark },
          bottom: { style: 'SOLID', width: 1, color: COLORS.borderDark },
          left:   { style: 'SOLID', width: 1, color: COLORS.borderDark },
          right:  { style: 'SOLID', width: 1, color: COLORS.borderDark },
          innerHorizontal: { style: 'SOLID', width: 1, color: COLORS.border },
          innerVertical:   { style: 'SOLID', width: 1, color: COLORS.border },
        },
      });
      // Freeze header is not needed for dashboard — it's short
      // Center-align STT column
      requests.push({
        repeatCell: {
          range: gridRange(sheetId, block.startRow + 1, block.endRow, 0, 1),
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      });
    }
  }

  return requests;
}

module.exports = { buildDailyReportFormatting, buildMainSheetFormatting, buildDashboardFormatting };
