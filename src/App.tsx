/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp,
  deleteDoc,
  doc,
  setDoc,
  writeBatch,
  User 
} from './firebase';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameDay, 
  parseISO,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  setYear,
  setMonth,
  setDate
} from 'date-fns';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { 
  Plus, 
  Trash2, 
  TrendingUp, 
  Calendar as CalendarIcon, 
  PieChart as PieChartIcon,
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  Recycle,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as pdfjs from 'pdfjs-dist';

// Set worker source for PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RecyclingEntry {
  id: string;
  date: string;
  paper_weight: number;
  paper_price: number;
  paper_amount: number;
  bottles_weight: number;
  bottles_price: number;
  bottles_amount: number;
  iron_cans_weight: number;
  iron_cans_price: number;
  iron_cans_amount: number;
  aluminum_cans_weight: number;
  aluminum_cans_price: number;
  aluminum_cans_amount: number;
  plastic_weight: number;
  plastic_price: number;
  plastic_amount: number;
  appliances_weight: number;
  appliances_price: number;
  appliances_amount: number;
  iron_weight: number;
  iron_price: number;
  iron_amount: number;
  aluminum_weight: number;
  aluminum_price: number;
  aluminum_amount: number;
  newspaper_weight: number;
  newspaper_price: number;
  newspaper_amount: number;
  dialysis_buckets_count: number;
  dialysis_buckets_price: number;
  dialysis_buckets_amount: number;
  waste_oil_weight: number;
  waste_oil_price: number;
  waste_oil_amount: number;
  uid: string;
  createdAt: any;
}

const CATEGORIES = [
  { id: 'paper', label: '紙', color: 'emerald' },
  { id: 'bottles', label: '瓶罐', color: 'blue' },
  { id: 'iron_cans', label: '鐵罐', color: 'amber' },
  { id: 'aluminum_cans', label: '鋁罐', color: 'orange' },
  { id: 'plastic', label: '塑膠', color: 'cyan' },
  { id: 'appliances', label: '電器', color: 'purple' },
  { id: 'iron', label: '鐵', color: 'gray' },
  { id: 'aluminum', label: '鋁', color: 'slate' },
  { id: 'newspaper', label: '報紙', color: 'indigo' },
  { id: 'dialysis_buckets', label: '洗腎桶', color: 'rose', isCount: true },
  { id: 'waste_oil', label: '廢油', color: 'yellow' }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<RecyclingEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formData, setFormData] = useState<any>(
    CATEGORIES.reduce((acc, cat) => ({
      ...acc,
      [`${cat.id}_${cat.isCount ? 'count' : 'weight'}`]: '',
      [`${cat.id}_price`]: ''
    }), {})
  );
  const [view, setView] = useState<'daily' | 'monthly' | 'yearly'>('daily');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showReceipt, setShowReceipt] = useState<RecyclingEntry | null>(null);
  const [hasPrefilled, setHasPrefilled] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<{ success?: string; error?: string }>({});
  const [isImporting, setIsImporting] = useState(false);
  const [isReadingPDF, setIsReadingPDF] = useState(false);

  // Helper to calculate amount
  const calculateAmount = (qty: string, price: string) => {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    return (q * p).toFixed(2);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setEntries([]);
      return;
    }

    const q = query(
      collection(db, 'recycling_entries'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RecyclingEntry[];
      setEntries(newEntries);
    }, (error) => {
      console.error("Firestore Error: ", error);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (entries.length > 0 && !hasPrefilled) {
      setFormData(prev => {
        const next = { ...prev };
        CATEGORIES.forEach(cat => {
          const priceKey = `${cat.id}_price`;
          if (entries[0][priceKey as keyof RecyclingEntry]) {
            next[priceKey] = entries[0][priceKey as keyof RecyclingEntry].toString();
          }
        });
        return next;
      });
      setHasPrefilled(true);
    }
  }, [entries, hasPrefilled]);

  const handleBatchImport = async () => {
    if (!user || !importText.trim()) return;
    setIsImporting(true);
    setImportStatus({});

    try {
      const lines = importText.split('\n').filter(l => l.trim());
      const batch = writeBatch(db);
      let count = 0;

      for (const line of lines) {
        // Expected format: Date [Category] Price Weight [Total]
        // Example: 2026/1/2 紙 1.7 318 541
        // Example: 2026/1/21 紙 1.7 1205 2,049
        const parts = line.trim().split(/[\s,]+/).filter(p => p.trim());
        if (parts.length < 3) continue;

        let dateStr = '';
        let price = NaN;
        let weight = NaN;
        let category = CATEGORIES[0]; // Default to first

        // 1. Find the date
        let date = new Date(currentMonth);
        let dateFound = false;

        // Try YYYY/M/D or M/D
        const fullDateMatch = line.match(/(\d{4})[/-](\d+)[/-](\d+)/);
        const shortDateMatch = line.match(/(\d+)[月/](\d+)[日]?/);

        if (fullDateMatch) {
          const y = parseInt(fullDateMatch[1]);
          const m = parseInt(fullDateMatch[2]) - 1;
          const d = parseInt(fullDateMatch[3]);
          date = new Date(y, m, d);
          dateFound = true;
          dateStr = fullDateMatch[0];
        } else if (shortDateMatch) {
          const m = parseInt(shortDateMatch[1]) - 1;
          const d = parseInt(shortDateMatch[2]);
          date = setMonth(date, m);
          date = setDate(date, d);
          dateFound = true;
          dateStr = shortDateMatch[0];
        }

        if (!dateFound) continue;

        // 2. Find the category (longest match first to avoid '鐵' matching '鐵罐')
        const sortedCategories = [...CATEGORIES].sort((a, b) => b.label.length - a.label.length);
        const foundCat = sortedCategories.find(c => line.includes(c.label));
        if (foundCat) category = foundCat;

        // 3. Find price, weight, and total
        // Remove commas from the line to handle numbers like 2,049 correctly
        let cleanLine = line.replace(dateStr, '').replace(category.label, '').replace(/,/g, '');
        const numbers = cleanLine.match(/\d+\.?\d*/g);

        let providedTotal = NaN;
        if (numbers && numbers.length >= 2) {
          // Order: Price, Weight, [Total]
          price = parseFloat(numbers[0]);
          weight = parseFloat(numbers[1]);
          if (numbers.length >= 3) {
            providedTotal = parseFloat(numbers[2]);
          }
        } else {
          // Fallback to parts if regex fails
          const numericParts = parts.filter(p => !isNaN(parseFloat(p.replace(/,/g, ''))) && !p.includes('/') && !p.includes('月'));
          if (numericParts.length >= 2) {
            price = parseFloat(numericParts[0].replace(/,/g, ''));
            weight = parseFloat(numericParts[1].replace(/,/g, ''));
            if (numericParts.length >= 3) {
              providedTotal = parseFloat(numericParts[2].replace(/,/g, ''));
            }
          }
        }

        if (isNaN(price) || isNaN(weight)) continue;

        const formattedDate = format(date, 'yyyy-MM-dd');
        
        const entry: any = {
          uid: user.uid,
          date: formattedDate,
          createdAt: serverTimestamp()
        };

        // Initialize all categories to 0
        CATEGORIES.forEach(cat => {
          const qtyKey = `${cat.id}_${cat.isCount ? 'count' : 'weight'}`;
          const priceKey = `${cat.id}_price`;
          const amountKey = `${cat.id}_amount`;
          entry[qtyKey] = 0;
          entry[priceKey] = 0;
          entry[amountKey] = 0;
        });

        // Set the parsed category
        const qtyKey = `${category.id}_${category.isCount ? 'count' : 'weight'}`;
        const priceKey = `${category.id}_price`;
        const amountKey = `${category.id}_amount`;

        entry[qtyKey] = weight;
        entry[priceKey] = price;
        // Use provided total if available, otherwise calculate
        entry[amountKey] = !isNaN(providedTotal) ? providedTotal : Number((weight * price).toFixed(2));

        const docRef = doc(collection(db, 'recycling_entries'));
        batch.set(docRef, entry);
        count++;
      }

      if (count > 0) {
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'recycling_entries');
        }
        setImportStatus({ success: `成功匯入 ${count} 筆資料！` });
        setImportText('');
        setTimeout(() => setShowImportModal(false), 2000);
      } else {
        setImportStatus({ error: '找不到有效的資料行，請檢查格式。' });
      }
    } catch (error) {
      console.error("Batch import error", error);
      setImportStatus({ error: '匯入失敗，請稍後再試。' });
    } finally {
      setIsImporting(false);
    }
  };

  const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReadingPDF(true);
    setImportStatus({});
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument(arrayBuffer).promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const strings = textContent.items.map((item: any) => item.str);
        
        // Group strings by their vertical position (y-coordinate) to reconstruct lines
        // This is a bit more robust than just joining all strings
        const items = textContent.items as any[];
        const lines: { [key: number]: string[] } = {};
        
        items.forEach(item => {
          const y = Math.round(item.transform[5]);
          if (!lines[y]) lines[y] = [];
          lines[y].push(item.str);
        });

        // Sort lines by y descending (top to bottom)
        const sortedY = Object.keys(lines).map(Number).sort((a, b) => b - a);
        const pageText = sortedY.map(y => lines[y].join(' ')).join('\n');
        
        fullText += pageText + '\n';
      }

      setImportText(prev => prev + (prev ? '\n' : '') + fullText);
      setImportStatus({ success: 'PDF 內容已讀取，請檢查後匯入。' });
    } catch (error) {
      console.error("PDF reading error", error);
      setImportStatus({ error: '無法讀取 PDF 檔案。' });
    } finally {
      setIsReadingPDF(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Create/update user document
      const userDocRef = doc(db, 'users', user.uid);
      try {
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email,
          role: 'client', // Default role
          lastLogin: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Error creating user document", err);
      }
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const entry: any = {
      uid: user.uid,
      date: selectedDate,
      createdAt: serverTimestamp()
    };

    CATEGORIES.forEach(cat => {
      const qtyKey = `${cat.id}_${cat.isCount ? 'count' : 'weight'}`;
      const priceKey = `${cat.id}_price`;
      const amountKey = `${cat.id}_amount`;
      
      entry[qtyKey] = Number(formData[qtyKey]) || 0;
      entry[priceKey] = Number(formData[priceKey]) || 0;
      entry[amountKey] = Number(calculateAmount(formData[qtyKey], formData[priceKey]));
    });

    try {
      await addDoc(collection(db, 'recycling_entries'), entry);
      // Keep the prices for the next entry, only clear weights/counts
      setFormData(prev => {
        const next = { ...prev };
        CATEGORIES.forEach(cat => {
          next[`${cat.id}_${cat.isCount ? 'count' : 'weight'}`] = '';
        });
        return next;
      });
    } catch (error) {
      console.error("Error adding entry", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'recycling_entries', id));
    } catch (error) {
      console.error("Error deleting entry", error);
    }
  };

  const monthlyData = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });

    return days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayEntries = entries.filter(e => e.date === dateStr);
      const data: any = {
        date: format(day, 'MM/dd'),
        totalAmount: 0
      };
      
      CATEGORIES.forEach(cat => {
        const qtyKey = `${cat.id}_${cat.isCount ? 'count' : 'weight'}`;
        const amountKey = `${cat.id}_amount`;
        const weight = dayEntries.reduce((sum, e) => sum + ((e as any)[qtyKey] || 0), 0);
        const amount = dayEntries.reduce((sum, e) => sum + ((e as any)[amountKey] || 0), 0);
        data[cat.id] = weight;
        data[`${cat.id}_amount`] = amount;
        data.totalAmount += amount;
      });
      
      return data;
    });
  }, [entries, currentMonth]);

  const yearlyTrend = useMemo(() => {
    const start = startOfYear(currentMonth);
    const end = endOfYear(currentMonth);
    const months = eachMonthOfInterval({ start, end });

    return months.map(month => {
      const monthStr = format(month, 'yyyy-MM');
      const monthEntries = entries.filter(e => e.date.startsWith(monthStr));
      const data: any = {
        month: format(month, 'MMM'),
        total: 0
      };
      
      CATEGORIES.forEach(cat => {
        const amount = monthEntries.reduce((sum, e) => sum + (e as any)[`${cat.id}_amount`], 0);
        data[cat.id] = amount;
        data.total += amount;
      });
      
      return data;
    });
  }, [entries, currentMonth]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-xl text-center"
        >
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Recycle className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-2">回收金追蹤器</h1>
          <p className="text-gray-600 mb-8">記錄每日回收收入，為地球盡一份心力。</p>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-emerald-600 text-white py-4 rounded-full font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
          >
            <LogIn className="w-5 h-5" />
            使用 Google 帳號登入
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-gray-900 font-sans pb-12">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Recycle className="w-6 h-6 text-emerald-600" />
            <span className="font-serif font-bold text-xl">回收金小幫手</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 mr-4">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-gray-200" />
              <span className="text-sm font-medium">{user.displayName}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 transition-colors"
              title="登出"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Navigation Tabs */}
        <div className="flex bg-white p-1 rounded-2xl shadow-sm mb-8 max-w-md mx-auto">
          {[
            { id: 'daily', label: '每日記錄' },
            { id: 'monthly', label: '月度報表' },
            { id: 'yearly', label: '年度趨勢' }
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id as any)}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-xl transition-all",
                view === v.id ? "bg-emerald-600 text-white shadow-md" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {view === 'daily' && (
            <motion.div
              key="daily"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              {/* Entry Form */}
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
                <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
                  <Plus className="w-6 h-6 text-emerald-600" />
                  新增回收記錄
                </h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="max-w-xs space-y-2">
                    <label className="text-sm font-medium text-gray-700">日期</label>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {CATEGORIES.map((cat) => (
                      <div key={cat.id} className="p-6 bg-gray-50 rounded-[24px] border border-gray-100 space-y-4">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full bg-${cat.color}-500`} />
                          {cat.label}
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500">{cat.isCount ? '數量 (個)' : '重量 (kg)'}</label>
                            <input
                              type="number"
                              step="0.01"
                              value={formData[`${cat.id}_${cat.isCount ? 'count' : 'weight'}`]}
                              onChange={(e) => setFormData({ ...formData, [`${cat.id}_${cat.isCount ? 'count' : 'weight'}`]: e.target.value })}
                              placeholder="0.00"
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500">單價 ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={formData[`${cat.id}_price`]}
                              onChange={(e) => setFormData({ ...formData, [`${cat.id}_price`]: e.target.value })}
                              placeholder="0.00"
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200/50">
                          <span className="text-xs text-gray-400">計算金額</span>
                          <span className="font-bold text-emerald-600">
                            ${calculateAmount(formData[`${cat.id}_${cat.isCount ? 'count' : 'weight'}`], formData[`${cat.id}_price`])}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      className="w-full bg-emerald-600 text-white py-4 rounded-full font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                    >
                      儲存記錄
                    </button>
                  </div>
                </form>
              </div>

              {/* Recent Entries */}
              <div className="space-y-4">
                <h3 className="text-xl font-serif font-bold px-2">最近記錄</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {entries.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="bg-white p-6 rounded-[24px] shadow-sm border border-gray-100 group relative">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="absolute top-4 right-4 p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="text-sm text-emerald-600 font-bold mb-2">{format(parseISO(entry.date), 'yyyy/MM/dd')}</div>
                      <div className="space-y-3">
                        {CATEGORIES.filter(cat => (entry as any)[`${cat.id}_amount`] > 0).slice(0, 4).map((cat, i) => (
                          <div key={i} className="flex flex-col text-sm">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500">{cat.label}</span>
                              <span className="font-medium">${(entry as any)[`${cat.id}_amount`].toFixed(2)}</span>
                            </div>
                            <div className="text-[10px] text-gray-400 flex gap-2">
                              <span>{cat.isCount ? '數量' : '重量'}: {(entry as any)[`${cat.id}_${cat.isCount ? 'count' : 'weight'}`]}{cat.isCount ? '個' : 'kg'}</span>
                              <span>單價: ${(entry as any)[`${cat.id}_price`]}</span>
                            </div>
                          </div>
                        ))}
                        {CATEGORIES.filter(cat => (entry as any)[`${cat.id}_amount`] > 0).length > 4 && (
                          <div className="text-[10px] text-gray-400 text-center">... 還有更多項目</div>
                        )}
                        <div className="pt-3 border-t border-gray-50 flex justify-between font-bold text-emerald-700">
                          <span>總計</span>
                          <span>${CATEGORIES.reduce((sum, cat) => sum + (entry as any)[`${cat.id}_amount`], 0).toFixed(2)}</span>
                        </div>
                        <button 
                          onClick={() => setShowReceipt(entry)}
                          className="w-full mt-2 py-2 text-xs font-bold text-emerald-600 border border-emerald-100 rounded-xl hover:bg-emerald-50 transition-all"
                        >
                          查看收據範本
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'monthly' && (
            <motion.div
              key="monthly"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8"
            >
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
                    <CalendarIcon className="w-6 h-6 text-emerald-600" />
                    月度報表
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-2xl text-sm font-medium hover:bg-gray-50 transition-all shadow-sm"
                    >
                      <Upload className="w-4 h-4 text-emerald-600" />
                      批次匯入
                    </button>
                    <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-2xl">
                      <button 
                        onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))}
                        className="p-2 hover:bg-white rounded-xl transition-all"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <span className="font-bold min-w-[120px] text-center">{format(currentMonth, 'yyyy年 MMMM')}</span>
                      <button 
                        onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))}
                        className="p-2 hover:bg-white rounded-xl transition-all"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="h-[300px] w-full mb-8">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        formatter={(value: any, name: string) => {
                          const cat = CATEGORIES.find(c => c.label === name);
                          return [`${value} ${cat?.isCount ? '個' : 'kg'}`, name];
                        }}
                      />
                      <Legend iconType="circle" />
                      {CATEGORIES.slice(0, 5).map((cat, idx) => (
                        <Bar 
                          key={cat.id}
                          name={cat.label} 
                          dataKey={cat.id} 
                          stackId="a" 
                          fill={
                            cat.color === 'emerald' ? '#10b981' : 
                            cat.color === 'blue' ? '#3b82f6' : 
                            cat.color === 'amber' ? '#f59e0b' : 
                            cat.color === 'orange' ? '#f97316' : 
                            '#06b6d4'
                          } 
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <th className="pb-4 pl-2">日期</th>
                        {CATEGORIES.map(cat => (
                          <th key={cat.id} className="pb-4 px-2">{cat.label}({cat.isCount ? '個' : 'kg'})</th>
                        ))}
                        <th className="pb-4 pr-2 text-right">總金額</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {monthlyData.filter(d => d.totalAmount > 0).map((day, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="py-4 pl-2 font-medium text-xs whitespace-nowrap">{day.date}</td>
                          {CATEGORIES.map(cat => (
                            <td key={cat.id} className="py-4 px-2 text-[10px] text-gray-600">
                              {day[cat.id] > 0 ? day[cat.id].toFixed(1) : '-'}
                            </td>
                          ))}
                          <td className="py-4 pr-2 text-right font-bold text-emerald-600 text-xs">${day.totalAmount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-50 font-bold">
                        <td className="py-4 pl-2 rounded-l-2xl text-xs">總結</td>
                        {CATEGORIES.map(cat => (
                          <td key={cat.id} className="py-4 px-2 text-[10px]">
                            {monthlyData.reduce((s, d) => s + d[cat.id], 0).toFixed(1)}
                          </td>
                        ))}
                        <td className="py-4 pr-2 text-right rounded-r-2xl text-emerald-700 text-xs">
                          ${monthlyData.reduce((s, d) => s + d.totalAmount, 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'yearly' && (
            <motion.div
              key="yearly"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-emerald-600" />
                    年度趨勢分析
                  </h2>
                  <div className="bg-gray-50 px-4 py-2 rounded-2xl font-bold">
                    {format(currentMonth, 'yyyy年')}
                  </div>
                </div>

                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={yearlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      />
                      <Legend iconType="circle" />
                      {CATEGORIES.slice(0, 5).map((cat, idx) => (
                        <Line 
                          key={cat.id}
                          name={cat.label} 
                          type="monotone" 
                          dataKey={cat.id} 
                          stroke={
                            cat.color === 'emerald' ? '#10b981' : 
                            cat.color === 'blue' ? '#3b82f6' : 
                            cat.color === 'amber' ? '#f59e0b' : 
                            cat.color === 'orange' ? '#f97316' : 
                            '#06b6d4'
                          } 
                          strokeWidth={3} 
                          dot={{ r: 4 }} 
                          activeDot={{ r: 6 }} 
                        />
                      ))}
                      <Line name="總計" type="monotone" dataKey="total" stroke="#111827" strokeWidth={4} strokeDasharray="5 5" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mt-8">
                  {CATEGORIES.map((cat) => (
                    <div key={cat.id} className="p-4 rounded-2xl text-center bg-gray-50 border border-gray-100">
                      <div className="text-xs font-bold uppercase opacity-70 mb-1">{cat.label}總計</div>
                      <div className="text-xl font-bold text-gray-900">
                        ${yearlyTrend.reduce((s, m) => s + (m[cat.id] || 0), 0).toFixed(0)}
                      </div>
                    </div>
                  ))}
                  <div className="p-4 rounded-2xl text-center bg-emerald-600 text-white col-span-2 sm:col-span-4 lg:col-span-1">
                    <div className="text-xs font-bold uppercase opacity-90 mb-1">年度總金額</div>
                    <div className="text-xl font-bold">
                      ${yearlyTrend.reduce((s, m) => s + m.total, 0).toFixed(0)}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Receipt Modal */}
      <AnimatePresence>
        {showReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowReceipt(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#fff9e6] w-full max-w-sm p-8 rounded-sm shadow-2xl border-2 border-[#d4c59a] relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Paper Texture Effect */}
              <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
              
              <div className="relative z-10 font-serif text-[#4a3f2a]">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold tracking-[0.2em] mb-1">仟環資源回收</h2>
                  <div className="flex justify-between text-xs border-b border-[#4a3f2a]/30 pb-2">
                    <span>寶號: {user?.displayName}</span>
                    <span>{format(parseISO(showReceipt.date), 'yyyy年 MM月 dd日')}</span>
                  </div>
                </div>

                  <table className="w-full text-sm border-collapse border border-[#4a3f2a]/40">
                    <thead>
                      <tr className="bg-[#f2e8c4]">
                        <th className="border border-[#4a3f2a]/40 p-1 font-bold">品名</th>
                        <th className="border border-[#4a3f2a]/40 p-1 font-bold">數量</th>
                        <th className="border border-[#4a3f2a]/40 p-1 font-bold">單價</th>
                        <th className="border border-[#4a3f2a]/40 p-1 font-bold">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map((cat, i) => {
                        const amount = (showReceipt as any)[`${cat.id}_amount`];
                        const qty = (showReceipt as any)[`${cat.id}_${cat.isCount ? 'count' : 'weight'}`];
                        const price = (showReceipt as any)[`${cat.id}_price`];
                        
                        if (!amount || amount === 0) return null;

                        return (
                          <tr key={i} className="h-8">
                            <td className="border border-[#4a3f2a]/40 p-1 text-center font-bold">{cat.label}</td>
                            <td className="border border-[#4a3f2a]/40 p-1 text-center">{qty}{cat.isCount ? '個' : 'kg'}</td>
                            <td className="border border-[#4a3f2a]/40 p-1 text-center">{price}</td>
                            <td className="border border-[#4a3f2a]/40 p-1 text-right">{amount.toFixed(0)}</td>
                          </tr>
                        );
                      })}
                      {/* Add empty rows to maintain receipt look if only few items */}
                      {CATEGORIES.filter(cat => (showReceipt as any)[`${cat.id}_amount`] > 0).length < 5 && 
                        Array.from({ length: 5 - CATEGORIES.filter(cat => (showReceipt as any)[`${cat.id}_amount`] > 0).length }).map((_, i) => (
                          <tr key={`empty-${i}`} className="h-8">
                            <td className="border border-[#4a3f2a]/40 p-1"></td>
                            <td className="border border-[#4a3f2a]/40 p-1"></td>
                            <td className="border border-[#4a3f2a]/40 p-1"></td>
                            <td className="border border-[#4a3f2a]/40 p-1"></td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>

                <div className="mt-6 flex justify-between items-end border-t-2 border-[#4a3f2a]/20 pt-4">
                  <div className="text-[10px] opacity-60">
                    電話: 0960622573
                  </div>
                  <div className="text-lg font-bold flex items-baseline gap-2">
                    <span className="text-xs">合計 NT$</span>
                    <span className="text-2xl underline decoration-double underline-offset-4">
                      {CATEGORIES.reduce((sum, cat) => sum + (showReceipt as any)[`${cat.id}_amount`], 0).toFixed(0)}
                    </span>
                  </div>
                </div>

                <button 
                  onClick={() => setShowReceipt(null)}
                  className="w-full mt-8 py-2 bg-[#4a3f2a] text-[#fff9e6] rounded-sm font-bold hover:opacity-90 transition-all"
                >
                  關閉
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowImportModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl p-8 rounded-[32px] shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowImportModal(false)}
                className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-600 transition-all"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-xl font-serif font-bold">批次匯入資料</h3>
                  <p className="text-sm text-gray-500">請貼上文字資料進行解析與匯入</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl text-xs text-amber-800 space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 匯入說明：
                  </p>
                  <p>1. 支援直接讀取 PDF 檔案或貼上文字。</p>
                  <p>2. 格式：<code className="bg-amber-100 px-1 rounded">日期 單價 重量 [項目]</code></p>
                  <p>3. 範例：<code className="bg-amber-100 px-1 rounded">9月1日 1.945 248 紙</code></p>
                  <p>項目可填：紙, 瓶罐, 鐵罐, 鋁罐, 塑膠, 電器, 鐵, 鋁, 報紙, 洗腎桶, 廢油</p>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex-1 flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all cursor-pointer group">
                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-emerald-600" />
                    <span className="text-sm font-medium text-gray-600 group-hover:text-emerald-700">
                      {isReadingPDF ? '讀取中...' : '選擇 PDF 檔案'}
                    </span>
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={handlePDFUpload} 
                      className="hidden" 
                      disabled={isReadingPDF}
                    />
                  </label>
                  <button
                    onClick={() => setImportText('')}
                    className="p-4 text-gray-400 hover:text-red-500 transition-all"
                    title="清除文字"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="在此貼上資料內容，或從上方上傳 PDF..."
                  className="w-full h-64 p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-sm resize-none"
                />

                {importStatus.success && (
                  <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-xl">
                    <CheckCircle2 className="w-4 h-4" />
                    {importStatus.success}
                  </div>
                )}

                {importStatus.error && (
                  <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-xl">
                    <AlertCircle className="w-4 h-4" />
                    {importStatus.error}
                  </div>
                )}

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-full transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchImport}
                    disabled={isImporting || !importText.trim()}
                    className="flex-2 bg-emerald-600 text-white py-4 px-8 rounded-full font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:shadow-none"
                  >
                    {isImporting ? '處理中...' : '開始匯入'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
