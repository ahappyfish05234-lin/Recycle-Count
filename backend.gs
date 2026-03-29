/**
 * ==========================================================
 * 回收金追蹤器 Google Apps Script 後端程式碼
 * ==========================================================
 * 
 * 若有更新程式碼，記得必須點選：部署 -> 管理部署作業 -> 編輯(鉛筆) -> 建立新版本 -> 部署！
 */

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const DAILY_SHEET_NAME = "每日回收紀錄";
const MONTHLY_SHEET_NAME = "每月回收紀錄";

/**
 * 處理 GET 請求：讀取資料
 */
function doGet(e) {
  try {
    const sheetType = e.parameter.type || 'all'; // 'daily', 'monthly', or 'all'
    let data = {};

    if (sheetType === 'daily' || sheetType === 'all') {
      data.daily = readSheetData(DAILY_SHEET_NAME);
    }
    if (sheetType === 'monthly' || sheetType === 'all') {
      data.monthly = readSheetData(MONTHLY_SHEET_NAME);
    }

    return respondJSON({ success: true, data });
  } catch (error) {
    return respondJSON({ success: false, error: error.message }, 400);
  }
}

/**
 * 處理 POST 請求：寫入資料或「刪除資料」
 */
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ========== 處理「刪除」邏輯 ==========
    if (postData.action === 'delete') {
      const targets = Array.isArray(postData.targets) ? postData.targets : [{ type: postData.type, no: postData.no }];
      
      const dailySheet = ss.getSheetByName(DAILY_SHEET_NAME);
      const monthlySheet = ss.getSheetByName(MONTHLY_SHEET_NAME);
      
      let deletedCount = 0;

      function deleteFromSheet(sheet, noArray) {
        if (!sheet || noArray.length === 0) return 0;
        let count = 0;
        const vals = sheet.getDataRange().getValues();
        // 一定要從最底層往上刪除，以免列數變動造成錯位刪除
        for (let i = vals.length - 1; i >= 1; i--) {
          if (noArray.includes(Number(vals[i][0]))) {
            sheet.deleteRow(i + 1);
            count++;
          }
        }
        return count;
      }
      
      const dailyNos = targets.filter(t => t.type === 'daily').map(t => Number(t.no));
      const monthlyNos = targets.filter(t => t.type === 'monthly').map(t => Number(t.no));

      deletedCount += deleteFromSheet(dailySheet, dailyNos);
      deletedCount += deleteFromSheet(monthlySheet, monthlyNos);

      if (deletedCount > 0) {
        return respondJSON({ success: true, message: "成功刪除 " + deletedCount + " 筆紀錄" });
      } else {
        throw new Error("找不到對應的流水號可以刪除");
      }
    }

    // ========== 處理「新增」批次邏輯 ==========
    const records = Array.isArray(postData) ? postData : [postData];
    const dailySheet = ss.getSheetByName(DAILY_SHEET_NAME);
    const monthlySheet = ss.getSheetByName(MONTHLY_SHEET_NAME);

    if (!dailySheet || !monthlySheet) {
      throw new Error("找不到工作表。請確保名稱為「每日回收紀錄」與「每月回收紀錄」");
    }

    // 取得當前最大流水號
    let dailyNo = dailySheet.getLastRow() > 1 ? Number(dailySheet.getRange(dailySheet.getLastRow(), 1).getValue()) || 0 : 0;
    let monthlyNo = monthlySheet.getLastRow() > 1 ? Number(monthlySheet.getRange(monthlySheet.getLastRow(), 1).getValue()) || 0 : 0;

    let count = 0;
    for (const record of records) {
      const type = record.type; 
      const now = new Date();
      // 防呆：單價 x 數量 = 金額
      const price = Number(record.price) || 0;
      const quantity = Number(record.quantity) || 0;
      const amount = Number((price * quantity).toFixed(2));

      if (type === 'daily') {
        dailyNo++;
        dailySheet.appendRow([
          dailyNo,                               // NO (流水號)
          record.date,                           // 日期 (YYYY-MM-DD)
          record.name,                           // 名稱
          price,                                 // 單價
          quantity,                              // 重量(Kg)/數量(個)
          amount,                                // 金額
          now                                    // 時間
        ]);
      } else if (type === 'monthly') {
        monthlyNo++;
        monthlySheet.appendRow([
          monthlyNo,                             // NO (流水號)
          record.date,                           // 日期(年+月)
          record.name,                           // 名稱
          price,                                 // 單價
          quantity,                              // 重量(Kg)/數量(個)
          amount,                                // 總金額
          record.hasDailyRecord ? "是" : "否",     // 是否有日記錄
          now                                    // 時間
        ]);
      }
      count++;
    }

    return respondJSON({ success: true, message: `成功寫入 ${count} 筆資料` });
  } catch (error) {
    return respondJSON({ success: false, error: error.message }, 400);
  }
}

/**
 * 統一回傳 JSON
 */
function respondJSON(responseObject, statusCode = 200) {
  return ContentService.createTextOutput(JSON.stringify(responseObject))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 讀取整張工作表資料
 */
function readSheetData(sheetName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // 只有標題列
  
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      if (row[index] instanceof Date) {
        obj[header] = row[index].toISOString();
      } else {
        obj[header] = row[index];
      }
    });
    return obj;
  });
}
