/**
 * 負責與 Google Apps Script (GAS) 進行溝通的服務層
 */
const GAS_URL = import.meta.env.VITE_GOOGLE_APP_SCRIPT_URL;

export interface RecyclingRecord {
  no?: number;
  createdAt?: string;
  type: 'daily' | 'monthly';
  date: string; // YYYY-MM-DD or YYYY-MM
  name: string; // 紙、鋁鐵罐、塑膠、洗腎桶
  price: number;
  quantity: number;
  hasDailyRecord?: boolean; // 僅 monthly 紀錄使用
}

/**
 * 測試 API 或處理錯誤
 */
const handleResponse = async (res: Response) => {
  if (!res.ok) throw new Error('Network response was not ok');
  try {
    const json = await res.json();
    return json;
  } catch (error) {
    throw new Error('JSON parsing error or CORS issue');
  }
};

/**
 * 送出紀錄 (單筆或多筆批次)
 */
export const submitRecords = async (records: RecyclingRecord | RecyclingRecord[]) => {
  if (!GAS_URL) throw new Error('VITE_GOOGLE_APP_SCRIPT_URL is not defined in .env');

  const payload = Array.isArray(records) ? records : [records];
  try {
    // 使用 fetch 發送 POST
    // GAS 不支援手動設定 Access-Control-Allow-Origin 標頭，所以直接呼叫會遇到 CORS 阻擋讀取回應。
    // 但是資料其實有送過去！解法是使用 mode: 'no-cors'。
    // 使用 'no-cors' 後我們無法讀取 GAS 的回傳 json，所以只要 fetch 沒報錯就當作成功。
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8', 
      },
    });

    return true; // 假設送出成功
  } catch (err) {
    console.error('Submit Failed:', err);
    throw err;
  }
};

/**
 * 批次刪除紀錄 (支援單筆或多筆)
 */
export const deleteRecords = async (targets: { type: 'daily' | 'monthly', no: number }[]) => {
  if (!GAS_URL) throw new Error('VITE_GOOGLE_APP_SCRIPT_URL is not defined in .env');

  if (targets.length === 0) return true;

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({ action: 'delete', targets }),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8', 
      },
    });
    return true; // 假設刪除成功
  } catch (err) {
    console.error('Batch Delete Failed:', err);
    throw err;
  }
};

/**
 * 取得所有紀錄
 */
export const fetchRecords = async (type: 'daily' | 'monthly' | 'all' = 'all') => {
  if (!GAS_URL) throw new Error('VITE_GOOGLE_APP_SCRIPT_URL is not defined in .env');

  try {
    // 加入時間戳記避免 Google apps script 的 CDN/快取機制回傳舊資料
    const res = await fetch(`${GAS_URL}?type=${type}&_t=${Date.now()}`, {
      method: 'GET',
    });
    const result = await handleResponse(res);
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to fetch data');
  } catch (err) {
    console.error('Fetch Failed:', err);
    throw err;
  }
};
