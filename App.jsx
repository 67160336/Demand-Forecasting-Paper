import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import {
  ComposedChart, Line, Area, Bar, BarChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Home, TrendingUp, Factory, Upload, FileSpreadsheet, Download,
  Droplets, FlaskConical, PackageCheck, ChevronRight, CheckCircle2,
  AlertTriangle, Layers, Gauge, ArrowUpRight, ArrowDownRight, X,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/*  Domain constants                                                      */
/* ---------------------------------------------------------------------- */

const PALETTE = ["#A9754F", "#3F6F66", "#B94A24", "#6B5B95", "#8C8354", "#4A6FA5"];

const KNOWN_GRADES = [
  { match: ["คราฟท์", "kraft"], name: "กระดาษคราฟท์ 150 แกรม", base: 420, growth: 0.018 },
  { match: ["ปอนด์", "offset"], name: "กระดาษปอนด์ (Offset) 80 แกรม", base: 610, growth: 0.010 },
  { match: ["ถุง", "bag"], name: "กระดาษถุง 120 แกรม", base: 260, growth: 0.028 },
  { match: ["แข็ง", "board"], name: "กระดาษแข็ง (Board) 300 แกรม", base: 340, growth: 0.014 },
];

const DEFAULT_RATIOS = (name) => {
  const n = name.toLowerCase();
  if (n.includes("คราฟท์") || n.includes("kraft")) return { pulp: 1.08, chemical: 0.045, water: 35 };
  if (n.includes("ปอนด์") || n.includes("offset")) return { pulp: 1.03, chemical: 0.060, water: 28 };
  if (n.includes("ถุง") || n.includes("bag")) return { pulp: 1.10, chemical: 0.050, water: 32 };
  if (n.includes("แข็ง") || n.includes("board")) return { pulp: 1.15, chemical: 0.070, water: 40 };
  return { pulp: 1.05, chemical: 0.050, water: 30 };
};

const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function ymKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function ymLabel(key) { const [y, m] = key.split("-").map(Number); return `${MONTH_TH[m - 1]} ${String(y).slice(2)}`; }
function fmt(n, d = 0) { return n.toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: d }); }

/* ---------------------------------------------------------------------- */
/*  Sample data generator                                                 */
/* ---------------------------------------------------------------------- */

function generateSample() {
  const rows = [];
  const now = new Date();
  now.setDate(1);
  const seasonal = [0.92, 0.90, 0.98, 1.00, 0.95, 0.97, 1.02, 1.05, 1.08, 1.15, 1.22, 1.18];
  for (const g of KNOWN_GRADES) {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthsElapsed = 23 - i;
      const trend = g.base * (1 + g.growth * (monthsElapsed / 12));
      const season = seasonal[d.getMonth()];
      const noise = 1 + (Math.sin(monthsElapsed * 1.7 + g.base) * 0.06) + (((monthsElapsed * 37 + g.base) % 11) / 11 - 0.5) * 0.05;
      const qty = Math.max(20, trend * season * noise);
      rows.push({
        date: d,
        grade: g.name,
        qty: Math.round(qty * 10) / 10,
        customer: ["บจก. สยามแพ็คเกจจิ้ง", "หจก. รุ่งเรืองบรรจุภัณฑ์", "บจก. ไทยกระดาษอุตสาหกรรม", "บจก. เอเชียมิลล์"][Math.floor(Math.abs(Math.sin(monthsElapsed + g.base)) * 4) % 4],
      });
    }
  }
  return rows;
}

/* ---------------------------------------------------------------------- */
/*  Forecast math                                                         */
/* ---------------------------------------------------------------------- */

function linreg(values) {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (values[i] - yMean); den += (xs[i] - xMean) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const residuals = values.map((v, i) => v - (intercept + slope * i));
  const std = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / n);
  return { slope, intercept, std };
}

function buildForecast(orders, grade, horizon) {
  const filtered = orders.filter((o) => o.grade === grade).sort((a, b) => a.date - b.date);
  const byMonth = new Map();
  for (const o of filtered) {
    const k = ymKey(o.date);
    byMonth.set(k, (byMonth.get(k) || 0) + o.qty);
  }
  const keys = [...byMonth.keys()].sort();
  const values = keys.map((k) => byMonth.get(k));
  if (values.length < 2) return { history: [], forecast: [], stats: null };

  const { slope, intercept, std } = linreg(values);

  const monthlyAvgByCal = Array(12).fill(0).map(() => ({ sum: 0, n: 0 }));
  keys.forEach((k, i) => { const m = Number(k.split("-")[1]) - 1; monthlyAvgByCal[m].sum += values[i]; monthlyAvgByCal[m].n++; });
  const overallAvg = values.reduce((a, b) => a + b, 0) / values.length;
  const seasonalIndex = monthlyAvgByCal.map((c) => (c.n ? (c.sum / c.n) / overallAvg : 1));

  const history = keys.map((k, i) => ({ month: k, label: ymLabel(k), actual: Math.round(values[i] * 10) / 10 }));

  const lastDate = filtered[filtered.length - 1].date;
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(lastDate.getFullYear(), lastDate.getMonth() + h, 1);
    const k = ymKey(d);
    const t = values.length - 1 + h;
    const trendVal = intercept + slope * t;
    const seasonFactor = seasonalIndex[d.getMonth()] || 1;
    const point = Math.max(0, trendVal * seasonFactor);
    const band = std * 1.28 * (1 + h * 0.06);
    forecast.push({
      month: k, label: ymLabel(k),
      forecast: Math.round(point * 10) / 10,
      low: Math.round(Math.max(0, point - band) * 10) / 10,
      high: Math.round((point + band) * 10) / 10,
    });
  }

  const growthRate = overallAvg ? ((forecast[0]?.forecast || 0) - values[values.length - 1]) / values[values.length - 1] : 0;
  const confidence = Math.max(45, Math.min(96, 100 - (std / overallAvg) * 100));

  return {
    history, forecast,
    stats: {
      nextMonth: forecast[0]?.forecast || 0,
      growthRate,
      confidence,
      avgHistorical: overallAvg,
      totalForecast: forecast.reduce((a, b) => a + b.forecast, 0),
    },
  };
}

/* ---------------------------------------------------------------------- */
/*  Small UI atoms                                                        */
/* ---------------------------------------------------------------------- */

function RollGauge({ value, size = 110 }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E8DFCB" strokeWidth="10" />
      <circle cx={size / 2} cy={size / 2} r={r - 16} fill="none" stroke="#E8DFCB" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#3F6F66" strokeWidth="10"
        strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="47%" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="22" fontWeight="600" fill="#23201B">
        {Math.round(pct)}%
      </text>
      <text x="50%" y="64%" textAnchor="middle" fontFamily="'IBM Plex Sans', sans-serif" fontSize="9" fill="#6B6355" letterSpacing="0.05em">
        ความเชื่อมั่น
      </text>
    </svg>
  );
}

function TicketCard({ eyebrow, value, unit, sub, trend, accent = "#A9754F" }) {
  return (
    <div className="ticket">
      <div className="ticket-eyebrow" style={{ color: accent }}>{eyebrow}</div>
      <div className="ticket-value">
        {value}
        {unit && <span className="ticket-unit">{unit}</span>}
      </div>
      {sub && (
        <div className={`ticket-sub ${trend === "up" ? "up" : trend === "down" ? "down" : ""}`}>
          {trend === "up" && <ArrowUpRight size={14} />}
          {trend === "down" && <ArrowDownRight size={14} />}
          {sub}
        </div>
      )}
    </div>
  );
}

function NavItem({ icon: Icon, label, sub, active, onClick }) {
  return (
    <button onClick={onClick} className={`nav-item ${active ? "active" : ""}`}>
      <Icon size={18} strokeWidth={1.8} />
      <span className="nav-item-text">
        <span className="nav-item-label">{label}</span>
        <span className="nav-item-sub">{sub}</span>
      </span>
      {active && <ChevronRight size={14} className="nav-item-chevron" />}
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/*  Page 1 — Home & Data Upload                                           */
/* ---------------------------------------------------------------------- */

function HomePage({ orders, setOrders, gradeList, onGoForecast }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef(null);

  const parseFile = useCallback((file) => {
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      Papa.parse(e.target.result, {
        header: true, dynamicTyping: true, skipEmptyLines: true,
        complete: (res) => {
          try {
            const cols = res.meta.fields.map((f) => f.toLowerCase().trim());
            const dateKey = res.meta.fields[cols.findIndex((c) => c.includes("date") || c.includes("วันที่"))];
            const gradeKey = res.meta.fields[cols.findIndex((c) => c.includes("grade") || c.includes("เกรด") || c.includes("ชนิด") || c.includes("product"))];
            const qtyKey = res.meta.fields[cols.findIndex((c) => c.includes("qty") || c.includes("quantity") || c.includes("จำนวน") || c.includes("ton"))];
            const custKey = res.meta.fields[cols.findIndex((c) => c.includes("customer") || c.includes("ลูกค้า"))];
            if (!dateKey || !gradeKey || !qtyKey) {
              setError("ไม่พบคอลัมน์ที่จำเป็น กรุณาตรวจสอบว่าไฟล์มีคอลัมน์ วันที่ / เกรดกระดาษ / จำนวน");
              return;
            }
            const parsed = res.data
              .filter((r) => r[dateKey] && r[gradeKey] && r[qtyKey] != null)
              .map((r) => ({
                date: new Date(r[dateKey]),
                grade: String(r[gradeKey]).trim(),
                qty: Number(r[qtyKey]),
                customer: custKey ? String(r[custKey] || "-") : "-",
              }))
              .filter((r) => !isNaN(r.date.getTime()) && !isNaN(r.qty));
            if (parsed.length === 0) {
              setError("อ่านไฟล์ได้ แต่ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบรูปแบบวันที่และตัวเลข");
              return;
            }
            setOrders(parsed);
          } catch (err) {
            setError("เกิดข้อผิดพลาดขณะประมวลผลไฟล์: " + err.message);
          }
        },
        error: (err) => setError("ไม่สามารถอ่านไฟล์ CSV ได้: " + err.message),
      });
    };
    reader.readAsText(file);
  }, [setOrders]);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("รองรับเฉพาะไฟล์ .csv เท่านั้น");
      return;
    }
    setFileName(file.name);
    parseFile(file);
  };

  const summary = useMemo(() => {
    if (orders.length === 0) return null;
    const dates = orders.map((o) => o.date).sort((a, b) => a - b);
    const total = orders.reduce((a, o) => a + o.qty, 0);
    return {
      count: orders.length,
      from: dates[0], to: dates[dates.length - 1],
      grades: gradeList.length,
      total,
    };
  }, [orders, gradeList]);

  return (
    <div className="page">
      <div className="page-hero">
        <div className="hero-eyebrow">มิลล์กระดาษ · แผนกวางแผนการผลิต</div>
        <h1 className="hero-title">พยากรณ์ยอดสั่งซื้อกระดาษล่วงหน้า</h1>
        <p className="hero-desc">
          นำเข้าประวัติคำสั่งซื้อ ระบบจะประมวลผลแนวโน้มและฤดูกาลของแต่ละเกรดกระดาษ
          เพื่อคาดการณ์ยอดสั่งซื้อล่วงหน้า และคำนวณความต้องการวัตถุดิบสำหรับสายการผลิต
        </p>
      </div>

      <div className="grid-2">
        <div
          className={`dropzone ${dragOver ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".csv" hidden onChange={(e) => handleFiles(e.target.files)} />
          <Upload size={30} strokeWidth={1.5} />
          <div className="dropzone-title">ลากไฟล์ CSV มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</div>
          <div className="dropzone-sub">ต้องมีคอลัมน์: วันที่ (date), เกรดกระดาษ (grade), จำนวน/ตัน (qty) — customer ไม่บังคับ</div>
          {fileName && <div className="dropzone-file"><FileSpreadsheet size={14} /> {fileName}</div>}
        </div>

        <div className="panel-quiet">
          <div className="panel-quiet-title">ยังไม่มีข้อมูล?</div>
          <p className="panel-quiet-desc">ใช้ชุดข้อมูลตัวอย่าง 24 เดือนย้อนหลัง ครอบคลุมกระดาษ 4 เกรดหลัก เพื่อทดลองใช้งานระบบทันที</p>
          <button className="btn-primary" onClick={() => { setOrders(generateSample()); setFileName(""); setError(""); }}>
            <Layers size={16} /> ใช้ข้อมูลตัวอย่าง
          </button>
          {orders.length > 0 && (
            <button className="btn-ghost" onClick={() => { setOrders([]); setFileName(""); }}>
              <X size={14} /> ล้างข้อมูลทั้งหมด
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-error"><AlertTriangle size={16} /> {error}</div>}

      {summary && (
        <>
          <div className="stat-row">
            <TicketCard eyebrow="รายการทั้งหมด" value={fmt(summary.count)} unit="รายการ" accent="#A9754F" />
            <TicketCard eyebrow="ช่วงเวลาข้อมูล" value={`${MONTH_TH[summary.from.getMonth()]} ${summary.from.getFullYear()}`} sub={`ถึง ${MONTH_TH[summary.to.getMonth()]} ${summary.to.getFullYear()}`} accent="#3F6F66" />
            <TicketCard eyebrow="จำนวนเกรดกระดาษ" value={summary.grades} unit="เกรด" accent="#B94A24" />
            <TicketCard eyebrow="ยอดสั่งซื้อรวม" value={fmt(summary.total, 1)} unit="ตัน" accent="#6B5B95" />
          </div>

          <div className="table-wrap">
            <div className="table-head-row">
              <div className="table-title"><FileSpreadsheet size={15} /> ตัวอย่างข้อมูล (10 รายการแรก)</div>
              <button className="btn-secondary" onClick={onGoForecast}>
                ไปหน้าพยากรณ์ยอดขาย <ChevronRight size={15} />
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>วันที่</th><th>เกรดกระดาษ</th><th>ลูกค้า</th><th className="num">จำนวน (ตัน)</th></tr>
              </thead>
              <tbody>
                {orders.slice(0, 10).map((o, i) => (
                  <tr key={i}>
                    <td>{o.date.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "2-digit" })}</td>
                    <td>{o.grade}</td>
                    <td>{o.customer}</td>
                    <td className="num mono">{fmt(o.qty, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!summary && (
        <div className="empty-note">
          <CheckCircle2 size={16} />
          หน้าพยากรณ์และวางแผนวัตถุดิบจะเปิดใช้งานได้หลังนำเข้าข้อมูล หรือกดใช้ข้อมูลตัวอย่างด้านบน
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Page 2 — Demand Forecasting Dashboard                                 */
/* ---------------------------------------------------------------------- */

function ForecastPage({ orders, gradeList, selectedGrade, setSelectedGrade, horizon, setHorizon }) {
  const result = useMemo(() => {
    if (!selectedGrade) return null;
    return buildForecast(orders, selectedGrade, horizon);
  }, [orders, selectedGrade, horizon]);

  const chartData = useMemo(() => {
    if (!result) return [];
    const hist = result.history.slice(-12).map((h) => ({ label: h.label, actual: h.actual }));
    const fc = result.forecast.map((f) => ({ label: f.label, forecast: f.forecast, band: [f.low, f.high] }));
    if (hist.length && fc.length) {
      fc[0].bridgeActual = hist[hist.length - 1].actual;
    }
    return [...hist, ...fc];
  }, [result]);

  if (orders.length === 0) {
    return (
      <div className="page">
        <EmptyState text="ยังไม่มีข้อมูลสำหรับพยากรณ์ — กรุณากลับไปนำเข้าข้อมูลที่หน้าแรกก่อน" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <div className="hero-eyebrow">แดชบอร์ด · การพยากรณ์ความต้องการ</div>
          <h1 className="page-title">ทำนายยอดสั่งซื้อล่วงหน้า</h1>
        </div>
        <div className="controls">
          <label className="control-label">
            เกรดกระดาษ
            <select value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)}>
              {gradeList.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="control-label">
            ระยะพยากรณ์
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              <option value={3}>3 เดือน</option>
              <option value={6}>6 เดือน</option>
              <option value={12}>12 เดือน</option>
            </select>
          </label>
        </div>
      </div>

      {result?.stats ? (
        <>
          <div className="stat-row">
            <TicketCard eyebrow="พยากรณ์เดือนถัดไป" value={fmt(result.stats.nextMonth, 1)} unit="ตัน" accent="#A9754F" />
            <TicketCard
              eyebrow="อัตราการเติบโต MoM"
              value={`${result.stats.growthRate >= 0 ? "+" : ""}${(result.stats.growthRate * 100).toFixed(1)}`}
              unit="%"
              trend={result.stats.growthRate >= 0 ? "up" : "down"}
              sub={result.stats.growthRate >= 0 ? "เพิ่มขึ้นจากเดือนล่าสุด" : "ลดลงจากเดือนล่าสุด"}
              accent="#3F6F66"
            />
            <TicketCard eyebrow={`รวม ${horizon} เดือนข้างหน้า`} value={fmt(result.stats.totalForecast, 0)} unit="ตัน" accent="#B94A24" />
            <TicketCard eyebrow="ค่าเฉลี่ยย้อนหลัง" value={fmt(result.stats.avgHistorical, 1)} unit="ตัน/เดือน" accent="#6B5B95" />
          </div>

          <div className="grid-chart">
            <div className="panel">
              <div className="panel-title">
                <TrendingUp size={16} /> แนวโน้มยอดสั่งซื้อจริง vs. พยากรณ์
                <span className="panel-title-tag">{selectedGrade}</span>
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3F6F66" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#3F6F66" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#E8DFCB" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B6355", fontFamily: "IBM Plex Sans" }} axisLine={{ stroke: "#D8CEB8" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B6355", fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    contentStyle={{ background: "#23201B", border: "none", borderRadius: 6, fontFamily: "IBM Plex Sans", fontSize: 12 }}
                    labelStyle={{ color: "#F3EEE3" }}
                    itemStyle={{ color: "#F3EEE3" }}
                    formatter={(v, name) => [`${fmt(v, 1)} ตัน`, name === "actual" ? "ยอดจริง" : name === "forecast" ? "พยากรณ์" : name]}
                  />
                  <Area type="monotone" dataKey="band" stroke="none" fill="url(#bandFill)" connectNulls />
                  <Line type="monotone" dataKey="actual" stroke="#23201B" strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
                  <Line type="monotone" dataKey="bridgeActual" stroke="#23201B" strokeWidth={2.2} dot={false} legendType="none" connectNulls />
                  <Line type="monotone" dataKey="forecast" stroke="#3F6F66" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
                  <ReferenceLine x={result.history.slice(-12)[result.history.slice(-12).length - 1]?.label} stroke="#B94A24" strokeDasharray="2 2" label={{ value: "วันนี้", fontSize: 10, fill: "#B94A24", position: "top" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="panel panel-narrow">
              <div className="panel-title"><Gauge size={16} /> ความเชื่อมั่นของแบบจำลอง</div>
              <div className="gauge-wrap">
                <RollGauge value={result.stats.confidence} />
                <p className="gauge-note">
                  คำนวณจากความผันผวนของข้อมูลย้อนหลังเทียบกับแนวโน้มเชิงเส้น
                  ยิ่งข้อมูลนิ่ง ค่าความเชื่อมั่นยิ่งสูง
                </p>
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <div className="table-head-row">
              <div className="table-title"><Layers size={15} /> รายละเอียดพยากรณ์รายเดือน — {selectedGrade}</div>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>เดือน</th><th className="num">พยากรณ์ (ตัน)</th><th className="num">ช่วงต่ำสุด</th><th className="num">ช่วงสูงสุด</th></tr>
              </thead>
              <tbody>
                {result.forecast.map((f) => (
                  <tr key={f.month}>
                    <td>{f.label}</td>
                    <td className="num mono">{fmt(f.forecast, 1)}</td>
                    <td className="num mono muted">{fmt(f.low, 1)}</td>
                    <td className="num mono muted">{fmt(f.high, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState text="ข้อมูลของเกรดนี้ยังไม่พอสำหรับการพยากรณ์ (ต้องมีอย่างน้อย 2 เดือน)" />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Page 3 — Material Planning & Export                                   */
/* ---------------------------------------------------------------------- */

function MaterialPage({ orders, gradeList, horizon, setHorizon, ratios, setRatios }) {
  const perGrade = useMemo(() => {
    return gradeList.map((g) => {
      const r = buildForecast(orders, g, horizon);
      const totalTon = r.forecast.reduce((a, f) => a + f.forecast, 0);
      const ratio = ratios[g] || DEFAULT_RATIOS(g);
      return {
        grade: g,
        totalTon,
        forecast: r.forecast,
        pulp: totalTon * ratio.pulp,
        chemical: totalTon * ratio.chemical,
        water: totalTon * ratio.water,
      };
    });
  }, [orders, gradeList, horizon, ratios]);

  const totals = useMemo(() => perGrade.reduce((a, g) => ({
    paper: a.paper + g.totalTon, pulp: a.pulp + g.pulp, chemical: a.chemical + g.chemical, water: a.water + g.water,
  }), { paper: 0, pulp: 0, chemical: 0, water: 0 }), [perGrade]);

  const updateRatio = (grade, field, value) => {
    setRatios((prev) => ({
      ...prev,
      [grade]: { ...(prev[grade] || DEFAULT_RATIOS(grade)), [field]: Number(value) },
    }));
  };

  const exportCSV = () => {
    const rows = [["เกรดกระดาษ", "เดือน", "พยากรณ์ (ตัน)", "เยื่อกระดาษที่ต้องใช้ (ตัน)", "สารเคมีที่ต้องใช้ (ตัน)", "น้ำที่ต้องใช้ (ลบ.ม.)"]];
    perGrade.forEach((g) => {
      const r = ratios[g.grade] || DEFAULT_RATIOS(g.grade);
      g.forecast.forEach((f) => {
        rows.push([g.grade, f.label, f.forecast.toFixed(1), (f.forecast * r.pulp).toFixed(2), (f.forecast * r.chemical).toFixed(2), (f.forecast * r.water).toFixed(0)]);
      });
    });
    rows.push([]);
    rows.push(["รวมทั้งหมด", `${horizon} เดือน`, totals.paper.toFixed(1), totals.pulp.toFixed(2), totals.chemical.toFixed(2), totals.water.toFixed(0)]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `material-plan-${horizon}m-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (orders.length === 0) {
    return <div className="page"><EmptyState text="ยังไม่มีข้อมูลสำหรับวางแผนวัตถุดิบ — กรุณากลับไปนำเข้าข้อมูลที่หน้าแรกก่อน" /></div>;
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <div className="hero-eyebrow">แดชบอร์ด · การวางแผนวัตถุดิบ</div>
          <h1 className="page-title">คำนวณวัตถุดิบและส่งออกรายงาน</h1>
        </div>
        <div className="controls">
          <label className="control-label">
            ระยะวางแผน
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              <option value={3}>3 เดือน</option>
              <option value={6}>6 เดือน</option>
              <option value={12}>12 เดือน</option>
            </select>
          </label>
          <button className="btn-primary" onClick={exportCSV}>
            <Download size={16} /> ส่งออก CSV
          </button>
        </div>
      </div>

      <div className="stat-row">
        <TicketCard eyebrow="ผลผลิตกระดาษรวม" value={fmt(totals.paper, 0)} unit="ตัน" accent="#A9754F" />
        <TicketCard eyebrow="เยื่อกระดาษที่ต้องใช้" value={fmt(totals.pulp, 0)} unit="ตัน" accent="#3F6F66" />
        <TicketCard eyebrow="สารเคมีที่ต้องใช้" value={fmt(totals.chemical, 1)} unit="ตัน" accent="#B94A24" />
        <TicketCard eyebrow="น้ำที่ต้องใช้" value={fmt(totals.water, 0)} unit="ลบ.ม." accent="#4A6FA5" />
      </div>

      <div className="panel">
        <div className="panel-title"><Factory size={16} /> อัตราแปลงวัตถุดิบต่อกระดาษ 1 ตัน (ปรับได้)</div>
        <table className="data-table ratio-table">
          <thead>
            <tr>
              <th>เกรดกระดาษ</th>
              <th className="num"><Layers size={12} /> เยื่อ (ตัน/ตัน)</th>
              <th className="num"><FlaskConical size={12} /> สารเคมี (ตัน/ตัน)</th>
              <th className="num"><Droplets size={12} /> น้ำ (ลบ.ม./ตัน)</th>
            </tr>
          </thead>
          <tbody>
            {gradeList.map((g) => {
              const r = ratios[g] || DEFAULT_RATIOS(g);
              return (
                <tr key={g}>
                  <td>{g}</td>
                  <td className="num"><input type="number" step="0.01" className="ratio-input" value={r.pulp} onChange={(e) => updateRatio(g, "pulp", e.target.value)} /></td>
                  <td className="num"><input type="number" step="0.005" className="ratio-input" value={r.chemical} onChange={(e) => updateRatio(g, "chemical", e.target.value)} /></td>
                  <td className="num"><input type="number" step="1" className="ratio-input" value={r.water} onChange={(e) => updateRatio(g, "water", e.target.value)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-title"><PackageCheck size={16} /> ความต้องการเยื่อกระดาษตามเกรด ({horizon} เดือนข้างหน้า)</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={perGrade} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
            <CartesianGrid stroke="#E8DFCB" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="grade" tick={{ fontSize: 10, fill: "#6B6355", fontFamily: "IBM Plex Sans" }} axisLine={{ stroke: "#D8CEB8" }} tickLine={false} angle={-12} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 11, fill: "#6B6355", fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              contentStyle={{ background: "#23201B", border: "none", borderRadius: 6, fontFamily: "IBM Plex Sans", fontSize: 12 }}
              labelStyle={{ color: "#F3EEE3" }} itemStyle={{ color: "#F3EEE3" }}
              formatter={(v, name) => [`${fmt(v, 1)} ตัน`, name === "pulp" ? "เยื่อกระดาษ" : name === "chemical" ? "สารเคมี" : name]}
            />
            <Bar dataKey="pulp" name="เยื่อกระดาษ" fill="#3F6F66" radius={[4, 4, 0, 0]} />
            <Bar dataKey="chemical" name="สารเคมี" fill="#A9754F" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap">
        <div className="table-head-row">
          <div className="table-title"><FileSpreadsheet size={15} /> สรุปวัตถุดิบรายเกรด</div>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>เกรดกระดาษ</th><th className="num">ผลผลิตพยากรณ์ (ตัน)</th><th className="num">เยื่อ (ตัน)</th><th className="num">สารเคมี (ตัน)</th><th className="num">น้ำ (ลบ.ม.)</th></tr>
          </thead>
          <tbody>
            {perGrade.map((g) => (
              <tr key={g.grade}>
                <td>{g.grade}</td>
                <td className="num mono">{fmt(g.totalTon, 1)}</td>
                <td className="num mono">{fmt(g.pulp, 1)}</td>
                <td className="num mono">{fmt(g.chemical, 2)}</td>
                <td className="num mono">{fmt(g.water, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>รวมทั้งหมด</td>
              <td className="num mono">{fmt(totals.paper, 1)}</td>
              <td className="num mono">{fmt(totals.pulp, 1)}</td>
              <td className="num mono">{fmt(totals.chemical, 2)}</td>
              <td className="num mono">{fmt(totals.water, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={22} strokeWidth={1.5} />
      <p>{text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App shell                                                             */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [page, setPage] = useState("home");
  const [orders, setOrders] = useState([]);
  const [selectedGrade, setSelectedGrade] = useState("");
  const [horizon, setHorizon] = useState(6);
  const [ratios, setRatios] = useState({});

  const gradeList = useMemo(() => [...new Set(orders.map((o) => o.grade))].sort(), [orders]);

  useEffect(() => {
    if (gradeList.length && !gradeList.includes(selectedGrade)) setSelectedGrade(gradeList[0]);
  }, [gradeList, selectedGrade]);

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .app-root {
          --paper: #F3EEE3;
          --paper-deep: #E8DFCB;
          --paper-line: #D8CEB8;
          --ink: #23201B;
          --ink-soft: #6B6355;
          --kraft: #A9754F;
          --pulp: #3F6F66;
          --rust: #B94A24;
          --slate: #202A32;
          --slate-soft: #2C3944;
          --slate-text: #EDE7D9;
          font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', sans-serif;
          color: var(--ink);
          background: var(--paper);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .app-root * { box-sizing: border-box; }

        @media (min-width: 900px) { .app-shell { display: flex; flex: 1; min-height: 0; } }
        .app-shell { display: flex; flex-direction: column; flex: 1; }

        /* Sidebar */
        .sidebar {
          background: var(--slate);
          color: var(--slate-text);
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 12px 16px;
          gap: 12px;
          border-bottom: 1px solid #142027;
        }
        @media (min-width: 900px) {
          .sidebar { flex-direction: column; align-items: stretch; width: 260px; padding: 24px 16px; border-bottom: none; border-right: 1px solid #142027; }
        }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-mark {
          width: 34px; height: 34px; border-radius: 8px; background: var(--pulp);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          background-image: repeating-linear-gradient(180deg, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.14) 1px, transparent 1px, transparent 4px);
        }
        .brand-text { display: none; }
        @media (min-width: 900px) { .brand-text { display: block; } }
        .brand-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 0.02em; }
        .brand-sub { font-size: 10.5px; color: #9BA6A2; letter-spacing: 0.04em; text-transform: uppercase; }

        .nav-list { display: none; }
        @media (min-width: 900px) { .nav-list { display: flex; flex-direction: column; gap: 4px; margin-top: 28px; } }
        .nav-list-mobile { display: flex; gap: 6px; margin-left: auto; }
        @media (min-width: 900px) { .nav-list-mobile { display: none; } }

        .nav-item {
          display: flex; align-items: center; gap: 10px;
          background: transparent; border: none; color: #C7CCC4;
          padding: 10px 12px; border-radius: 8px; cursor: pointer; text-align: left;
          font-family: inherit; width: 100%; transition: background 0.15s ease;
        }
        .nav-item:hover { background: rgba(255,255,255,0.05); }
        .nav-item.active { background: var(--slate-soft); color: var(--slate-text); }
        .nav-item-text { display: flex; flex-direction: column; flex: 1; }
        .nav-item-label { font-size: 13px; font-weight: 500; }
        .nav-item-sub { font-size: 10.5px; color: #8A948E; }
        .nav-item-chevron { margin-left: auto; color: var(--pulp); }

        .nav-item-mobile {
          background: transparent; border: 1px solid #3A4750; color: #C7CCC4; border-radius: 7px;
          padding: 7px 9px; cursor: pointer; display: flex; align-items: center;
        }
        .nav-item-mobile.active { background: var(--pulp); border-color: var(--pulp); color: #fff; }

        .sidebar-foot { display: none; }
        @media (min-width: 900px) { .sidebar-foot { display: block; margin-top: auto; padding-top: 20px; border-top: 1px solid #33404A; font-size: 10.5px; color: #7C877F; line-height: 1.6; } }

        /* Main */
        .main {
          flex: 1; min-width: 0; overflow-y: auto;
          background-image: repeating-linear-gradient(180deg, transparent 0px, transparent 27px, rgba(35,32,27,0.035) 28px);
        }
        .page { max-width: 1180px; margin: 0 auto; padding: 28px 22px 56px; }
        @media (min-width: 900px) { .page { padding: 40px 40px 64px; } }

        .page-hero { max-width: 720px; margin-bottom: 28px; }
        .hero-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kraft); margin-bottom: 10px; }
        .hero-title { font-family: 'Space Grotesk', sans-serif; font-size: 30px; font-weight: 700; line-height: 1.25; margin: 0 0 12px; }
        @media (min-width: 900px) { .hero-title { font-size: 38px; } }
        .hero-desc { font-size: 14.5px; line-height: 1.7; color: var(--ink-soft); margin: 0; }

        .page-header-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 24px; }
        .page-title { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; margin: 4px 0 0; }

        .controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
        .control-label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--ink-soft); font-weight: 500; }
        .control-label select {
          font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 13px; padding: 8px 10px; border-radius: 7px;
          border: 1px solid var(--paper-line); background: #fff; color: var(--ink); min-width: 150px;
        }

        /* Grids & panels */
        .grid-2 { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 24px; }
        @media (min-width: 800px) { .grid-2 { grid-template-columns: 1.4fr 1fr; } }
        .grid-chart { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 24px; }
        @media (min-width: 950px) { .grid-chart { grid-template-columns: 2fr 1fr; } }

        .dropzone {
          border: 2px dashed var(--paper-line); border-radius: 12px; background: #FBF8F1;
          padding: 36px 20px; display: flex; flex-direction: column; align-items: center; text-align: center;
          gap: 8px; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; color: var(--ink-soft);
        }
        .dropzone:hover, .dropzone.drag { border-color: var(--pulp); background: #F1F5F1; color: var(--pulp); }
        .dropzone-title { font-size: 14px; font-weight: 600; color: var(--ink); }
        .dropzone-sub { font-size: 11.5px; max-width: 380px; line-height: 1.6; }
        .dropzone-file { margin-top: 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace; color: var(--pulp); }

        .panel-quiet { background: var(--paper-deep); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
        .panel-quiet-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15px; }
        .panel-quiet-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 6px; }

        .btn-primary {
          font-family: inherit; display: inline-flex; align-items: center; gap: 8px; justify-content: center;
          background: var(--pulp); color: #fff; border: none; border-radius: 8px; padding: 10px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s ease;
        }
        .btn-primary:hover { background: #345D55; }
        .btn-secondary {
          font-family: inherit; display: inline-flex; align-items: center; gap: 6px;
          background: transparent; color: var(--kraft); border: 1px solid var(--kraft); border-radius: 8px;
          padding: 8px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer;
        }
        .btn-secondary:hover { background: rgba(169,117,79,0.08); }
        .btn-ghost {
          font-family: inherit; display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
          background: transparent; color: var(--ink-soft); border: none; padding: 2px 0; font-size: 11.5px; cursor: pointer; text-decoration: underline;
        }

        .alert-error {
          background: #FBEAE3; color: #8A3418; border: 1px solid #E7B49B; border-radius: 8px;
          padding: 10px 14px; font-size: 12.5px; display: flex; align-items: center; gap: 8px; margin-bottom: 20px;
        }

        /* Ticket cards */
        .stat-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
        @media (min-width: 700px) { .stat-row { grid-template-columns: repeat(4, 1fr); } }
        .ticket {
          position: relative; background: #fff; border-radius: 10px; padding: 16px 16px 14px;
          border: 1px solid var(--paper-line);
          background-image: radial-gradient(circle at 0 50%, var(--paper) 5px, transparent 5.5px),
                             radial-gradient(circle at 100% 50%, var(--paper) 5px, transparent 5.5px);
        }
        .ticket-eyebrow { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .ticket-value { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; color: var(--ink); }
        .ticket-unit { font-size: 12px; font-weight: 500; color: var(--ink-soft); margin-left: 4px; }
        .ticket-sub { font-size: 11px; color: var(--ink-soft); margin-top: 6px; display: flex; align-items: center; gap: 3px; }
        .ticket-sub.up { color: var(--pulp); }
        .ticket-sub.down { color: var(--rust); }

        /* Panels with charts */
        .panel { background: #fff; border: 1px solid var(--paper-line); border-radius: 12px; padding: 18px 18px 8px; margin-bottom: 20px; }
        .panel-narrow { display: flex; flex-direction: column; }
        .panel-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .panel-title-tag { font-family: 'IBM Plex Sans Thai', sans-serif; font-weight: 400; font-size: 11.5px; color: var(--ink-soft); background: var(--paper); padding: 2px 8px; border-radius: 5px; margin-left: 4px; }
        .gauge-wrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 12px 6px 20px; flex: 1; justify-content: center; }
        .gauge-note { font-size: 11.5px; color: var(--ink-soft); line-height: 1.6; max-width: 220px; }

        /* Tables */
        .table-wrap { background: #fff; border: 1px solid var(--paper-line); border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
        .table-head-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--paper-line); flex-wrap: wrap; gap: 10px; }
        .table-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 7px; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .data-table th { text-align: left; padding: 10px 18px; background: var(--paper-deep); color: var(--ink-soft); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
        .data-table td { padding: 9px 18px; border-top: 1px solid var(--paper); }
        .data-table tr:hover td { background: #FBF8F1; }
        .data-table .num { text-align: right; }
        .data-table .mono { font-family: 'IBM Plex Mono', monospace; }
        .data-table .muted { color: var(--ink-soft); }
        .data-table tfoot td { border-top: 2px solid var(--ink); font-weight: 600; background: var(--paper-deep); }
        .ratio-input {
          width: 78px; text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px;
          border: 1px solid var(--paper-line); border-radius: 5px; padding: 4px 7px; background: #FBF8F1;
        }
        .ratio-input:focus { outline: none; border-color: var(--pulp); background: #fff; }

        .empty-note { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--pulp); background: #EEF4F1; border: 1px solid #CFE0D6; border-radius: 8px; padding: 12px 16px; }
        .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; color: var(--ink-soft); padding: 80px 20px; }
        .empty-state svg { color: var(--rust); }
        .empty-state p { max-width: 380px; font-size: 13.5px; line-height: 1.7; margin: 0; }
      `}</style>

      <div className="app-shell">
        <div className="sidebar">
          <div className="brand">
            <div className="brand-mark" />
            <div className="brand-text">
              <div className="brand-title">PULPFLOW</div>
              <div className="brand-sub">Demand &amp; Material Planning</div>
            </div>
          </div>

          <nav className="nav-list">
            <NavItem icon={Home} label="หน้าแรก" sub="นำเข้าข้อมูล" active={page === "home"} onClick={() => setPage("home")} />
            <NavItem icon={TrendingUp} label="พยากรณ์ยอดขาย" sub="Demand Forecasting" active={page === "forecast"} onClick={() => setPage("forecast")} />
            <NavItem icon={Factory} label="วางแผนวัตถุดิบ" sub="Material &amp; Export" active={page === "material"} onClick={() => setPage("material")} />
          </nav>

          <div className="nav-list-mobile">
            <button className={`nav-item-mobile ${page === "home" ? "active" : ""}`} onClick={() => setPage("home")}><Home size={16} /></button>
            <button className={`nav-item-mobile ${page === "forecast" ? "active" : ""}`} onClick={() => setPage("forecast")}><TrendingUp size={16} /></button>
            <button className={`nav-item-mobile ${page === "material" ? "active" : ""}`} onClick={() => setPage("material")}><Factory size={16} /></button>
          </div>

          <div className="sidebar-foot">
            ระบบพยากรณ์ภายใน<br />สำหรับแผนกวางแผนการผลิต
          </div>
        </div>

        <main className="main">
          {page === "home" && (
            <HomePage orders={orders} setOrders={setOrders} gradeList={gradeList} onGoForecast={() => setPage("forecast")} />
          )}
          {page === "forecast" && (
            <ForecastPage
              orders={orders} gradeList={gradeList}
              selectedGrade={selectedGrade} setSelectedGrade={setSelectedGrade}
              horizon={horizon} setHorizon={setHorizon}
            />
          )}
          {page === "material" && (
            <MaterialPage orders={orders} gradeList={gradeList} horizon={horizon} setHorizon={setHorizon} ratios={ratios} setRatios={setRatios} />
          )}
        </main>
      </div>
    </div>
  );
}
