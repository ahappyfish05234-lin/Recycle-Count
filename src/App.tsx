import React, { useState, useEffect, useMemo } from 'react';
import { submitRecords, fetchRecords, deleteRecords, RecyclingRecord } from './services/gasService';
import { 
  format, startOfMonth, parseISO, eachMonthOfInterval, startOfYear, endOfYear
} from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line
} from 'recharts';
import { Recycle, Plus, Upload, AlertCircle, FileText, BarChart3, CalendarDays, Clock, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import './index.css';

const CATEGORIES = [
  { id: 'paper', label: '紙', color: 'paper', isCount: false },
  { id: 'cans', label: '鋁鐵罐', color: 'cans', isCount: false },
  { id: 'plastic', label: '塑膠', color: 'plastic', isCount: false },
  { id: 'dialysis', label: '洗腎桶', color: 'dialysis', isCount: true },
  { id: 'oil', label: '廢油', color: 'oil', isCount: false }
];

// 初始化表單狀態
const initialFormState = CATEGORIES.reduce((acc, cat) => ({
  ...acc,
  [`${cat.id}_qty`]: '',
  [`${cat.id}_price`]: ''
}), {} as Record<string, string>);

export default function App() {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [entries, setEntries] = useState<RecyclingRecord[]>([]);
  
  // Tabs
  const [view, setView] = useState<'input' | 'monthly_report' | 'yearly_report' | 'history'>('input');
  const [yearlySubView, setYearlySubView] = useState<'overview' | 'by_category'>('overview');
  const [inputType, setInputType] = useState<'daily' | 'monthly'>('daily');
  
  // Forms
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formData, setFormData] = useState(initialFormState);
  
  // CSV Import
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  
  const [toast, setToast] = useState<{msg: string, isError: boolean} | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // History View States
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const [rawDebug, setRawDebug] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setFetching(true);
    try {
      const data = await fetchRecords('all');
      console.log('[DEBUG] raw daily sample:', data.daily?.slice(0,2));
      console.log('[DEBUG] raw monthly sample:', data.monthly?.slice(0,2));
      setRawDebug(data.monthly?.slice(0, 3) || []);
      const all: RecyclingRecord[] = [];
      
      const normalizeDate = (val: any, isMonthly: boolean) => {
        let str = String(val || '').trim();
        if (!str) return '';
        if (str.includes('T')) {
          try {
            return format(new Date(str), isMonthly ? 'yyyy-MM' : 'yyyy-MM-dd');
          } catch (e) { return str; }
        }
        // 將可能的斜線轉換為減號並補零
        str = str.replace(/\//g, '-');
        const parts = str.split('-');
        if (parts.length >= 2) {
          const y = parts[0];
          const m = parts[1].padStart(2, '0');
          if (isMonthly) return `${y}-${m}`;
          const d = parts[2] ? parts[2].padStart(2, '0') : '01';
          return `${y}-${m}-${d}`;
        }
        return str;
      };
      
      // 合併與轉換資料格式
      if (data.daily) {
        data.daily.forEach((d: any) => {
          all.push({
            no: Number(d['NO']),
            type: 'daily',
            date: normalizeDate(d['日期'], false),
            name: d['名稱'],
            price: Number(d['單價']),
            quantity: Number(d['重量(Kg)/數量(個)']),
            createdAt: (d['時間'] || d['TIME']) ? format(new Date(d['時間'] || d['TIME']), 'yyyy-MM-dd HH:mm') : ''
          });
        });
      }
      if (data.monthly) {
        data.monthly.forEach((m: any) => {
          // ⚠️ 欄位錯位修正：CSV 匯入時 日期(年+月)=名稱, 名稱=日期ISO字串
          const rawDate = String(m['名稱'] || '');
          // Google Sheets 回傳 UTC ISO 字串，如 2022-12-31T16:00:00Z 代表台灣 2023-01-01
          // 必須轉成本地時間（UTC+8）再取年月，否則跨日邊界的月份會偏移一個月
          const dateStr = rawDate.includes('T')
            ? (() => {
                const d = new Date(rawDate);
                // 以 UTC+8 計算本地年月
                const localMs = d.getTime() + 8 * 60 * 60 * 1000;
                const local = new Date(localMs);
                const y = local.getUTCFullYear();
                const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
                return `${y}-${mo}`;
              })()
            : normalizeDate(rawDate, true);
          const nameStr = String(m['日期(年+月)'] || m['名稱'] || '');
          
          all.push({
            no: Number(m['NO']),
            type: 'monthly',
            date: dateStr,
            name: nameStr,
            price: Number(m['單價']),
            quantity: Number(m['重量(Kg)/數量(個)']),
            hasDailyRecord: m['是否有日記錄'] === '是',
            createdAt: m['紀錄時間'] ? format(new Date(m['紀錄時間']), 'yyyy-MM-dd HH:mm') : ''
          });
        });
      }
      
      // 以 NO 作為主要排序 (最新新增在最前面)
      all.sort((a, b) => (b.no || 0) - (a.no || 0));
      setEntries(all);

      // 自動預設最近一次的各項單價
      setFormData(prev => {
        const next = { ...prev };
        let hasChanges = false;
        CATEGORIES.forEach(cat => {
          if (!next[`${cat.id}_price`]) {
            // 從由新到舊排序的陣列中找出該類別第一筆有效單價
            const latest = all.find(e => e.name === cat.label && e.price > 0);
            if (latest) {
              next[`${cat.id}_price`] = String(latest.price);
              hasChanges = true;
            }
          }
        });
        return hasChanges ? next : prev;
      });
    } catch (err) {
      console.error(err);
      showToast('讀取資料失敗，請檢查 GAS 網址與權限設定', true);
    } finally {
      setFetching(false);
    }
  };

  /**
   * 表單送出
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const recordsToSubmit: RecyclingRecord[] = [];
    const dateStr = inputType === 'daily' ? selectedDate : format(parseISO(selectedDate), 'yyyy-MM');

    CATEGORIES.forEach(cat => {
      const price = Number(formData[`${cat.id}_price`]);
      const qty = Number(formData[`${cat.id}_qty`]);
      if (qty > 0 || price > 0) {
        recordsToSubmit.push({
          type: inputType,
          date: dateStr,
          name: cat.label,
          price: price,
          quantity: qty,
          hasDailyRecord: inputType === 'monthly' ? false : undefined
        });
      }
    });

    if (recordsToSubmit.length === 0) {
      showToast('請至少填寫一個項目的數量或單價', true);
      setLoading(false);
      return;
    }

    try {
      await submitRecords(recordsToSubmit);
      showToast('資料新增成功！');
      
      setFormData(prev => {
        const next = { ...prev };
        CATEGORIES.forEach(cat => {
          next[`${cat.id}_qty`] = '';
        });
        return next;
      });
      loadData(); 
    } catch (err) {
      showToast('資料新增失敗，請稍後再試。', true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 批次/單筆刪除紀錄
   */
  const handleBatchDelete = async (targets: RecyclingRecord[]) => {
    const validTargets = targets.filter(t => t.no);
    if (validTargets.length === 0) return;

    const confirmDelete = window.confirm(`確定要從 Google Sheets 中真實刪除這 ${validTargets.length} 筆紀錄嗎？\n\n注意：此操作無法復原。`);
    if (!confirmDelete) return;

    setLoading(true);
    try {
      const payload = validTargets.map(t => ({ type: t.type, no: t.no! }));
      await deleteRecords(payload);
      showToast(`成功刪除 ${validTargets.length} 筆資料`);
      setSelectedIds(new Set());
      // 等待1秒讓GAS反應後重新讀取
      setTimeout(() => loadData(), 1000);
    } catch (err) {
      showToast('刪除失敗，請檢查權限及連線', true);
      setLoading(false);
    }
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  /**
   * CSV 匯入邏輯
   */
  const handleImport = async () => {
    if (!importText.trim()) return;
    setLoading(true);

    try {
      const lines = importText.split('\n').filter(l => l.trim().length > 0);
      const recordsToSubmit: RecyclingRecord[] = [];

      lines.forEach(line => {
        const parts = line.split(/[,\t]/).map(p => p.trim());
        if (parts.length >= 4) {
          const date = parts[0];
          const name = parts[1];
          const price = Number(parts[2] || 0);
          const quantity = Number(parts[3] || 0);
          
          if (!isNaN(price) && !isNaN(quantity)) {
            const isMonthly = date.length <= 7;
            recordsToSubmit.push({
              type: isMonthly ? 'monthly' : 'daily',
              date: isMonthly ? date.substring(0,7) : date,
              name,
              price,
              quantity,
              hasDailyRecord: isMonthly ? false : undefined
            });
          }
        }
      });

      if (recordsToSubmit.length > 0) {
        await submitRecords(recordsToSubmit);
        showToast(`成功批次匯入 ${recordsToSubmit.length} 筆資料！`);
        setImportText('');
        setShowImport(false);
        setTimeout(() => loadData(), 1000); // 延遲讓後端寫入完畢
      } else {
        showToast('找不到符合格式的資料行 (日期,名稱,單價,數量)', true);
      }
    } catch (err) {
      showToast('批次匯入失敗。', true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 智慧月度總結阻擋
   */
  const monthString = format(parseISO(selectedDate), 'yyyy-MM');
  const hasMonthlyRecord = entries.some(e => e.type === 'monthly' && e.date === monthString);
  const showDailyFormBlocked = inputType === 'daily' && hasMonthlyRecord;

  // ==== 報表與歷史紀錄計算區 ====

  const filteredHistory = useMemo(() => {
    let result = entries;
    if (historySearch.trim()) {
      const lower = historySearch.toLowerCase();
      result = entries.filter(e => 
        e.name.toLowerCase().includes(lower) ||
        e.date.includes(lower) ||
        (e.createdAt && e.createdAt.includes(lower))
      );
    }
    return result;
  }, [entries, historySearch]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / ITEMS_PER_PAGE));
  const currentHistoryPageData = filteredHistory.slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE);

  // 1. 月回收紀錄報表
  const currentMonthEntries = useMemo(() => {
    const monthlyInMonth = entries.filter(e => e.type === 'monthly' && e.date === monthString);
    const dailyInMonth = entries.filter(e => e.type === 'daily' && e.date.startsWith(monthString));
    
    // 找出已經統整為「月紀錄」的項目類別 (如：紙、塑膠)
    const categoriesWithMonthly = new Set(monthlyInMonth.map(e => e.name));
    
    // 針對「尚未」有月紀錄的分類，才放行它的「每日明細」
    const validDaily = dailyInMonth.filter(e => !categoriesWithMonthly.has(e.name));
    
    return [...monthlyInMonth, ...validDaily];
  }, [entries, monthString]);

  const monthReportData = useMemo(() => {
    const map = new Map();
    currentMonthEntries.forEach(e => {
      if (!map.has(e.date)) map.set(e.date, { date: e.date, total: 0 });
      const row = map.get(e.date);
      const amount = e.price * e.quantity;
      row[e.name] = (row[e.name] || 0) + e.quantity;
      row[`${e.name}金額`] = (row[`${e.name}金額`] || 0) + amount;
      row.total += amount;
    });
    return Array.from(map.values()).sort((a,b) => a.date.localeCompare(b.date));
  }, [currentMonthEntries]);

  // 2. 年回收紀錄報表
  const currentYearStr = format(parseISO(selectedDate), 'yyyy');
  const yearlyTrendData = useMemo(() => {
    const months = Array.from({length: 12}, (_, i) => `${currentYearStr}-${String(i+1).padStart(2,'0')}`);
    return months.map(mStr => {
      const data: any = { month: mStr.substring(5,7) + '月' };
      CATEGORIES.forEach(c => data[c.label] = 0);
      
      // 每個月份獨立進行「每月總結優先 (單一分類層級)」的判斷
      const monthlyInMonth = entries.filter(e => e.type === 'monthly' && e.date === mStr);
      const dailyInMonth = entries.filter(e => e.type === 'daily' && e.date.startsWith(mStr));
      
      const categoriesWithMonthly = new Set(monthlyInMonth.map(e => e.name));
      const validDaily = dailyInMonth.filter(e => !categoriesWithMonthly.has(e.name));

      const validEntries = [...monthlyInMonth, ...validDaily];

      validEntries.forEach(e => {
        if (data[e.name] !== undefined) {
          data[e.name] += (e.price * e.quantity);
        }
      });
      return data;
    });
  }, [entries, currentYearStr]);

  // 3. 以項目為單位的跟年比較：X軸=1~12月，每條線=一個年份，顯示數量(qty)
  const categoryTrendData = useMemo(() => {
    // 自動從資料中偵測所有年份
    const yearsSet = new Set<string>();
    entries.forEach(e => {
      const y = e.date?.substring(0, 4);
      if (y && /^\d{4}$/.test(y)) yearsSet.add(y);
    });
    const years = Array.from(yearsSet).sort();
    const monthNums = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'));

    return CATEGORIES.map(cat => ({
      cat,
      years,
      data: monthNums.map(m => {
        const row: Record<string, any> = { month: m + '月' };
        years.forEach(y => {
          const mStr = `${y}-${m}`;
          const monthlyInMonth = entries.filter(e => e.type === 'monthly' && e.date === mStr && e.name === cat.label);
          const dailyInMonth = entries.filter(e => e.type === 'daily' && e.date.startsWith(mStr) && e.name === cat.label);
          const valid = monthlyInMonth.length > 0 ? monthlyInMonth : dailyInMonth;
          const qty = valid.reduce((s, e) => s + e.quantity, 0);
          row[y] = qty > 0 ? +qty.toFixed(2) : null; // null 諦 recharts 不畫點
        });
        return row;
      })
    }));
  }, [entries]);

  return (
    <div className="app-container">
      {toast && (
        <div className={`alert-toast ${toast.isError ? 'error' : ''}`}>
          {toast.isError ? <AlertCircle size={20} /> : <Recycle size={20} className="text-emerald-500" />}
          <span className="font-medium text-sm text-gray-800">{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="header-title">
          <Recycle size={30} color="#16a34a" />
          <span>資源回收統計系統</span>
        </div>
        {!fetching && <span className="text-muted text-sm flex gap-2" style={{alignItems:'center'}}><div style={{width:8,height:8,borderRadius:'50%',background:'#22c55e',boxShadow:'0 0 6px #22c55e'}} /> 系統連線正常</span>}
        {fetching && <span className="text-muted text-sm flex gap-2" style={{alignItems:'center'}}><div className="loading-spinner" style={{width: 14, height:14, borderWidth:2}} /> 資料同步中...</span>}
      </header>

      {/* Navigation */}
      <div className="tabs" style={{width: '100%', borderRadius: '999px', justifyContent: 'center'}}>
        <button className={`tab-btn ${view === 'input' ? 'active' : ''}`} onClick={() => setView('input')}>
          <div className="flex items-center gap-2"><Plus size={15}/> 紀錄輸入</div>
        </button>
        <button className={`tab-btn ${view === 'monthly_report' ? 'active' : ''}`} onClick={() => setView('monthly_report')}>
          <div className="flex items-center gap-2"><FileText size={15}/> 月回收紀錄</div>
        </button>
        <button className={`tab-btn ${view === 'yearly_report' ? 'active' : ''}`} onClick={() => setView('yearly_report')}>
          <div className="flex items-center gap-2"><BarChart3 size={15}/> 年回收紀錄</div>
        </button>
        <button className={`tab-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
          <div className="flex items-center gap-2"><Clock size={15}/> 紀錄管理 / 刪除</div>
        </button>
      </div>

      {/* View: 輸入紀錄 */}
      {view === 'input' && (
        <div className="glass-panel" style={{ animation: 'fadeIn 0.4s ease' }}>
          <div className="flex items-center justify-between mb-8">
            <h2 className="flex items-center gap-2">
              {inputType === 'daily' ? '每日回收紀錄輸入' : '每月總結輸入'}
            </h2>
            <div className="flex gap-2">
              <button className="btn btn-outline" style={{padding: '0.4rem 0.8rem', fontSize: '0.85rem'}} onClick={() => setShowImport(true)}>
                <Upload size={16}/> CSV 匯入
              </button>
              <div className="tabs" style={{marginBottom: 0}}>
                <button className={`tab-btn ${inputType === 'daily' ? 'active' : ''}`} style={{padding: '0.3rem 0.8rem', fontSize: '0.85rem'}} onClick={() => setInputType('daily')}>每日</button>
                <button className={`tab-btn ${inputType === 'monthly' ? 'active' : ''}`} style={{padding: '0.3rem 0.8rem', fontSize: '0.85rem'}} onClick={() => setInputType('monthly')}>每月</button>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{maxWidth: '220px'}}>
              <label className="form-label">{inputType === 'daily' ? '記錄日期' : '記錄月份'}</label>
              <div className="flex items-center gap-2">
                <CalendarDays size={20} className="text-emerald-600"/>
                <input 
                  type={inputType === 'daily' ? 'date' : 'month'} 
                  value={inputType === 'daily' ? selectedDate : selectedDate.substring(0,7)} 
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedDate(inputType === 'daily' ? v : `${v}-01`);
                  }}
                  className="form-input" 
                  required 
                />
              </div>
            </div>

            {showDailyFormBlocked ? (
              <div className="mt-8 p-6 text-center" style={{ background: 'rgba(245, 158, 11, 0.1)', borderRadius: '1rem', border: '1px solid rgba(245, 158, 11, 0.3)'}}>
                <AlertCircle size={32} className="mx-auto text-amber-500 mb-2"/>
                <h3 className="text-amber-800 mb-1">{monthString} 已經有「每月回收紀錄」</h3>
                <p className="text-amber-700 text-sm">系統偵測到該月份已有月總結，依規則省略每日紀錄。如需修改，請切換至「每月」分頁。</p>
              </div>
            ) : (
              <>
                <div className="category-grid mt-8">
                  {CATEGORIES.map(cat => (
                    <div key={cat.id} className={`category-card ${cat.color}`}>
                      <div className="category-header">
                        {cat.label}
                      </div>
                      <div className="category-inputs">
                        <div className="flex-col gap-2">
                          <label className="text-xs text-muted">{cat.id === 'dialysis' ? '洗腎次數 (次)' : (cat.isCount ? '數量 (個)' : '重量 (kg)')}</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            className="form-input" 
                            placeholder="0"
                            value={formData[`${cat.id}_qty`]} 
                            onChange={(e) => setFormData({...formData, [`${cat.id}_qty`]: e.target.value})} 
                          />
                        </div>
                        <div className="flex-col gap-2">
                          <label className="text-xs text-muted">單價 ($)</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            className="form-input" 
                            placeholder="0.0"
                            value={formData[`${cat.id}_price`]} 
                            onChange={(e) => setFormData({...formData, [`${cat.id}_price`]: e.target.value})} 
                          />
                        </div>
                      </div>
                      <div className="mt-4 text-right">
                        <span className="text-xs text-muted font-medium">小計: </span>
                        <span className="font-bold text-emerald-600">
                          ${ (Number(formData[`${cat.id}_qty`]) * Number(formData[`${cat.id}_price`]) || 0).toFixed(2) }
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex justify-end">
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? <div className="loading-spinner" style={{width: 18, height: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white'}}></div> : <Plus size={20} />}
                    {loading ? '儲存中...' : '儲存紀錄'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}

      {/* View: 月報表 */}
      {view === 'monthly_report' && (
        <div className="glass-panel" style={{ animation: 'fadeIn 0.4s ease' }}>
          <div className="flex items-center justify-between mb-6">
            <h2>{monthString} 回收明細表</h2>
            <input 
              type="month" 
              className="form-input" 
              style={{width: '180px'}} 
              value={selectedDate.substring(0,7)} 
              onChange={(e) => setSelectedDate(`${e.target.value}-01`)} 
            />
          </div>

          {monthReportData.length === 0 ? (
            <div className="p-8 text-center text-muted">這個月份尚無任何回收資料。</div>
          ) : (
            <div className="glass-table-wrapper">
              <table className="glass-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    {CATEGORIES.map(c => <th key={c.id}>{c.label} (單日量/金額)</th>)}
                    <th className="text-right">日總計</th>
                  </tr>
                </thead>
                <tbody>
                  {monthReportData.map((row, idx) => (
                    <tr key={idx}>
                      <td className="font-medium">{row.date}</td>
                      {CATEGORIES.map(c => (
                        <td key={c.id}>
                          {row[c.label] ? (
                            <div>
                              <span className="font-bold">{Number(row[c.label]).toFixed(1)}</span> {c.id === 'dialysis' ? '次' : (c.isCount ? '個' : 'kg')}
                              <div className="text-xs text-muted">${Number(row[`${c.label}金額`]).toFixed(1)}</div>
                            </div>
                          ) : '-'}
                        </td>
                      ))}
                      <td className="text-right font-bold text-emerald-600">${Number(row.total).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* View: 年報表 */}
      {view === 'yearly_report' && (
        <div className="glass-panel" style={{ animation: 'fadeIn 0.4s ease' }}>
          <div className="flex items-center justify-between mb-6">
            <h2>回收趨勢比較</h2>
            <div className="flex items-center gap-3">
              <div className="tabs" style={{marginBottom: 0}}>
                <button
                  className={`tab-btn ${yearlySubView === 'overview' ? 'active' : ''}`}
                  style={{padding: '0.3rem 0.9rem', fontSize: '0.85rem'}}
                  onClick={() => setYearlySubView('overview')}
                >綜合總覽</button>
                <button
                  className={`tab-btn ${yearlySubView === 'by_category' ? 'active' : ''}`}
                  style={{padding: '0.3rem 0.9rem', fontSize: '0.85rem'}}
                  onClick={() => setYearlySubView('by_category')}
                >項目比較</button>
              </div>
              {/* 綜合總覽才需要選年 */}
              {yearlySubView === 'overview' && (
                <input
                  type="number"
                  className="form-input"
                  style={{width: '110px'}}
                  value={currentYearStr}
                  onChange={(e) => setSelectedDate(`${e.target.value}-01-01`)}
                  min="2000" max="2100"
                />
              )}
            </div>
          </div>

          {/* 綜合總覽：原有 BarChart */}
          {yearlySubView === 'overview' && (
            <div style={{ height: 400, width: '100%', padding: '1rem', background: 'rgba(255,255,255,0.3)', borderRadius: '1rem' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearlyTrendData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="month" stroke="#64748b" tickMargin={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#64748b" axisLine={false} tickLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    cursor={{fill: 'rgba(0,0,0,0.03)'}}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                    formatter={(value: any, name: string) => [`$${Number(value).toFixed(1)}`, name]}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }}/>
                  <Bar dataKey="紙" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="鋁鐵罐" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="塑膠" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="洗腎桶" fill="#e11d48" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="廢油" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 項目比較：每個類別一張跨年度 LineChart，X軸=月份，每條線=年份 */}
          {yearlySubView === 'by_category' && (() => {
            const CAT_COLORS: Record<string, string> = {
              '紙': '#3b82f6', '鋁鐵罐': '#f59e0b', '塑膠': '#14b8a6', '洗腎桶': '#e11d48', '廢油': '#8b5cf6',
            };
            // 年份配色盤：客製化 (灰色、藍色、橘色、紅色)
            const YEAR_PALETTE = [
              '#94a3b8', // 灰 (2022)
              '#3b82f6', // 藍 (2023)
              '#f97316', // 橘 (2024)
              '#ef4444', // 紅 (2025)
              '#64748b', // 備用1: 深灰
              '#0284c7', // 備用2: 深藍
              '#ea580c', // 備用3: 深橘
              '#b91c1c'  // 備用4: 深紅
            ];
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
                {categoryTrendData.map(({ cat, years, data }) => {
                  const catColor = CAT_COLORS[cat.label] || '#64748b';
                  const unit = cat.id === 'dialysis' ? '次' : cat.isCount ? '個' : 'kg';
                  const hasAnyData = data.some(row => years.some(y => row[y] !== null && row[y] > 0));
                  return (
                    <div key={cat.id} style={{
                      background: 'rgba(255,255,255,0.45)',
                      backdropFilter: 'blur(8px)',
                      borderRadius: '1rem',
                      padding: '1.25rem 1.25rem 0.75rem',
                      border: `1.5px solid ${catColor}28`,
                      boxShadow: `0 8px 24px ${catColor}12, inset 0 1px 0 rgba(255,255,255,0.6)`
                    }}>
                      {/* 標題 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: catColor, flexShrink: 0, boxShadow: `0 0 8px ${catColor}80` }} />
                        <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e293b' }}>{cat.label}</span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: 2, fontWeight: 600 }}>({unit})</span>
                        {!hasAnyData && <span style={{ fontSize: '0.75rem', color: '#cbd5e1', marginLeft: 'auto', fontWeight: 600 }}>尚無資料</span>}
                      </div>

                      {/* 年份 Legend */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginBottom: '1rem' }}>
                        {years.map((y, i) => (
                          <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                            <div style={{ width: 14, height: 4, borderRadius: 2, background: YEAR_PALETTE[i % YEAR_PALETTE.length] }} />
                            {y}年
                          </div>
                        ))}
                      </div>

                      {/* Chart */}
                      <div style={{ height: 230 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke="rgba(0,0,0,0.05)" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                              axisLine={false} tickLine={false}
                              tickMargin={8}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 500 }}
                              axisLine={false} tickLine={false}
                              tickFormatter={(v) => `${v}`}
                              tickMargin={8}
                            />
                            <Tooltip
                              contentStyle={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '0.85rem', fontWeight: 600 }}
                              formatter={(value: any, name: string) => [
                                value !== null ? `${value}${unit}` : '-',
                                name + '年'
                              ]}
                              itemSorter={(item: any) => -(item.value ?? 0)}
                            />
                            {years.map((y, i) => (
                              <Line
                                key={y}
                                type="monotone"
                                dataKey={y}
                                name={y}
                                stroke={YEAR_PALETTE[i % YEAR_PALETTE.length]}
                                strokeWidth={2.5}
                                dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: YEAR_PALETTE[i % YEAR_PALETTE.length] }}
                                activeDot={{ r: 6, strokeWidth: 0, fill: YEAR_PALETTE[i % YEAR_PALETTE.length] }}
                                connectNulls={false}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* 年度小計 */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', padding: '0.5rem 0 0', borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '0.5rem' }}>
                        {years.map((y, i) => {
                          const total = data.reduce((s, row) => s + (row[y] ?? 0), 0);
                          return total > 0 ? (
                            <span key={y} style={{ fontSize: '0.78rem', color: YEAR_PALETTE[i % YEAR_PALETTE.length], fontWeight: 600 }}>
                              {y}: {total.toFixed(1)}{unit}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}


        </div>
      )}

      {/* View: 歷史紀錄管理 / 刪除 */}
      {view === 'history' && (
        <div className="glass-panel" style={{ animation: 'fadeIn 0.4s ease' }}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="flex items-center gap-2">
              <Clock size={24} className="text-emerald-600"/>
              歷史紀錄與刪除管理
            </h2>
            {selectedIds.size > 0 && (
              <button 
                className="btn btn-outline" 
                style={{borderColor: '#f43f5e', color: '#f43f5e', padding: '0.4rem 0.8rem', fontSize: '0.85rem'}}
                onClick={() => handleBatchDelete(entries.filter(e => selectedIds.has(`${e.type}-${e.no}`)))}
                disabled={loading}
              >
                <Trash2 size={16}/> 批次刪除 ({selectedIds.size})
              </button>
            )}
          </div>
          <p className="text-muted text-sm mb-6">這裡會依照新增時間列出我們儲存的所有單筆明細。若不小心打錯或是匯入重複資料，您可以直接點擊右側的垃圾桶圖示將其真實刪除。<strong>(此操作無法復原)</strong></p>

          <div className="flex items-center gap-4 mb-4" style={{background: 'rgba(255,255,255,0.4)', padding: '0.8rem 1rem', borderRadius: '0.8rem'}}>
            <Search className="text-emerald-600" size={20} />
            <input 
              type="text" 
              className="form-input flex-1 m-0"
              style={{border: 'none', background: 'transparent', boxShadow: 'none'}}
              placeholder="輸入關鍵字以篩選資料 (如：紙、2026-03、或是匯入時間 10:45)..."
              value={historySearch}
              onChange={e => {
                setHistorySearch(e.target.value);
                setHistoryPage(1);
                setSelectedIds(new Set());
              }}
            />
          </div>

          <div className="glass-table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table className="glass-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input 
                      type="checkbox" 
                      style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                      checked={selectedIds.size === currentHistoryPageData.length && currentHistoryPageData.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(currentHistoryPageData.map(r => `${r.type}-${r.no}`)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  <th>NO.</th>
                  <th>匯入時間</th>
                  <th>類型</th>
                  <th>日期</th>
                  <th>項目名稱</th>
                  <th>單價</th>
                  <th>數量/重量</th>
                  <th>小計金額</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {currentHistoryPageData.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center p-8 text-muted">尚未有匹配的資料</td>
                  </tr>
                )}
                {currentHistoryPageData.map((req, idx) => {
                  const idStr = `${req.type}-${req.no}`;
                  return (
                  <tr key={`${idStr}-${idx}`}>
                    <td>
                      <input 
                        type="checkbox" 
                        style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                        checked={selectedIds.has(idStr)} 
                        onChange={() => toggleSelection(idStr)} 
                      />
                    </td>
                    <td className="text-muted text-sm">#{req.no}</td>
                    <td className="text-xs text-muted font-medium">{req.createdAt || '-'}</td>
                    <td>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${req.type==='daily' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {req.type === 'daily' ? '每日' : '每月'}
                      </span>
                    </td>
                    <td className="font-medium">{req.date}</td>
                    <td className="font-bold text-gray-700">{req.name}</td>
                    <td>${req.price}</td>
                    <td>{req.quantity}</td>
                    <td className="font-bold text-emerald-600">${(req.price * req.quantity).toFixed(2)}</td>
                    <td className="text-right">
                      <button 
                        onClick={() => handleBatchDelete([req])}
                        disabled={loading}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors inline-block"
                        title="刪除此筆資料"
                      >
                        {loading && selectedIds.size === 0 ? <div className="loading-spinner" style={{width: 14, height:14, borderWidth:2, borderColor:'rgba(244,63,94,0.3)', borderTopColor:'#f43f5e'}}></div> : <Trash2 size={18} />}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalHistoryPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <span className="text-sm text-muted">
                顯示第 {(historyPage - 1) * ITEMS_PER_PAGE + 1} 筆到第 {Math.min(historyPage * ITEMS_PER_PAGE, filteredHistory.length)} 筆，共 {filteredHistory.length} 筆資料
              </span>
              <div className="flex items-center gap-2">
                <button 
                  className="btn btn-outline p-2" 
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="px-3 py-1 font-medium text-emerald-700 bg-emerald-50 rounded-lg">
                  {historyPage} / {totalHistoryPages}
                </div>
                <button 
                  className="btn btn-outline p-2" 
                  disabled={historyPage === totalHistoryPages}
                  onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: CSV Import */}
      {showImport && (
        <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setShowImport(false) }}>
          <div className="modal-content">
            <h3 className="text-xl mb-4 font-bold flex items-center gap-2">
              <Upload className="text-emerald-500"/>
              匯入文字 / CSV 資料
            </h3>
            <p className="text-sm text-muted mb-4">
              請輸入資料（各欄位可用逗號(,)或Tab隔開）。<br/>
              <strong>格式要求：</strong> 日期,名稱,單價,數量/重量<br/>
              <em>範例：2026-03-29, 塑膠, 2.5, 9.6</em><br/>
            </p>
            <textarea 
              className="textarea-input"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="2026-03-29,紙,1.5,12.5&#10;2026-03-29,塑膠,2.0,8.2"
            ></textarea>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                className="btn" 
                style={{background: 'rgba(0,0,0,0.05)'}}
                onClick={() => setShowImport(false)}
              >
                取消
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleImport}
                disabled={loading}
              >
                {loading ? '匯入中...' : '確認匯入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
