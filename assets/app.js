const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("en-IN");

const COLORS = {
  blue: "#2563eb",
  teal: "#0f766e",
  gold: "#c78118",
  rose: "#be3455",
  green: "#15803d",
  slate: "#334155",
  subscription: "#2563eb",
  pay_as_you_go: "#0f766e",
  day_pass: "#c78118",
  accent: "#be3455",
  muted: "#94a3b8",
};

Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
Chart.defaults.color = "#475569";
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.tooltip.backgroundColor = "#111827";

const CHARTS = {};
let DASHBOARD_DATA = null;
let SELECTED_PERIOD = "weekly";
const TABLE_FILTERS = {
  payerSegment: { segment: "all", limit: 25 },
  payerFamilySegment: { family_label: "all", segment: "all", limit: 25 },
  pack: { family_label: "all", limit: 20 },
  rawPack: { family_label: "all", limit: 20 },
  dailyPack: { family_label: "all", day: "all", limit: 25 },
  acquisitionSegment: { segment: "all", limit: 25 },
  segmentOpportunity: { segment: "all", limit: 20 },
  followupSegment: { segment: "all", limit: 25 },
  followupEntity: { entity_match_type: "all", limit: 20 },
  retentionSegment: { segment: "all", day: "1", limit: 20 },
  botCohort: { user_cohort: "all", limit: 20 },
  botSegment: { segment: "all", limit: 25 },
  sessionSegment: { segment: "all", limit: 25 },
};

function money(value) {
  return INR.format(Number(value || 0));
}

function optionalMoney(value) {
  return value === null || value === undefined || value === "" ? "All" : money(value);
}

function number(value) {
  return NUM.format(Number(value || 0));
}

function pct(value) {
  if (value === null || value === undefined) return "-";
  return `${Number(value).toFixed(2)}%`;
}

function safePercent(num, den) {
  return den ? (Number(num || 0) / Number(den || 0)) * 100 : 0;
}

function familyLabel(value) {
  return ({
    subscription: "Subscription",
    pay_as_you_go: "Pay as you go",
    day_pass: "Day pass",
  })[value] || String(value || "Other").replaceAll("_", " ");
}

function familyRows(monetization) {
  return monetization.kpis?.by_family || monetization.family || [];
}

function familyMetric(monetization, familyId) {
  return familyRows(monetization).find((row) => row.family === familyId) || {
    family: familyId,
    family_label: familyLabel(familyId),
    revenue: 0,
    payers: 0,
    transactions: 0,
    avg_transaction: 0,
    avg_revenue_per_payer: 0,
    revenue_share_pct: 0,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isUnknownLike(value) {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes("unknown");
}

function rowHasUnknown(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return isUnknownLike(row);
  return Object.values(row).some((value) => {
    if (isUnknownLike(value)) return true;
    if (value && typeof value === "object") return rowHasUnknown(value);
    return false;
  });
}

function hideUnknownRows(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !rowHasUnknown(item))
      .map((item) => hideUnknownRows(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, hideUnknownRows(nestedValue)]));
  }
  return value;
}

function shortDate(value) {
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function trend(value) {
  if (value === null || value === undefined) return "";
  const direction = Number(value) >= 0 ? "up" : "down";
  const sign = Number(value) >= 0 ? "+" : "";
  return `<span class="trend ${direction}">${sign}${Number(value).toFixed(1)}%</span>`;
}

function card(label, value, sub = "") {
  return `
    <article class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </article>
  `;
}

function insightCard(label, value, sub = "", tone = "neutral") {
  return `
    <article class="insight-card ${tone}">
      <div class="insight-label">${escapeHtml(label)}</div>
      <div class="insight-value">${value}</div>
      <div class="insight-sub">${sub}</div>
    </article>
  `;
}

function actionCard(label, value, sub = "", tone = "neutral") {
  return `
    <article class="action-card ${tone}">
      <div class="action-label">${escapeHtml(label)}</div>
      <div class="action-value">${value}</div>
      <div class="action-sub">${sub}</div>
    </article>
  `;
}

function funnelStep(label, value, sub = "") {
  return `
    <article class="funnel-step">
      <div class="funnel-label">${escapeHtml(label)}</div>
      <div class="funnel-value">${value}</div>
      <div class="funnel-sub">${sub}</div>
    </article>
  `;
}

function streamCard(row, accent = COLORS.blue) {
  return `
    <article class="stream-card" style="--accent: ${accent}">
      <div>
        <div class="stream-title">${escapeHtml(row.family_label || familyLabel(row.family))}</div>
        <div class="stream-value">${money(row.revenue)}</div>
      </div>
      <div class="stream-metrics">
        <span>Share <strong>${pct(row.revenue_share_pct)}</strong></span>
        <span>Payers <strong>${number(row.payers)}</strong></span>
        <span>Avg txn <strong>${money(row.avg_transaction)}</strong></span>
        <span>Growth <strong>${trend(row.revenue_growth_vs_prior_7_pct) || "-"}</strong></span>
      </div>
    </article>
  `;
}

function table(containerId, rows, columns, limit = 12) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sliced = (rows || []).slice(0, limit);
  if (!sliced.length) {
    container.innerHTML = `<div class="kpi-sub">No data in this window.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${columns.map((c) => `<th class="${c.text ? "text" : ""}">${c.label}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${sliced
            .map(
              (row) => `
                <tr>
                  ${columns
                    .map((c) => {
                      const value = c.format ? c.format(row[c.key], row) : row[c.key];
                      return `<td class="${c.text ? "text" : ""}">${escapeHtml(value)}</td>`;
                    })
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function groupedDaily(rows, familyKey = "family", valueKey = "revenue") {
  const labels = [...new Set(rows.map((r) => r.day))].sort();
  const families = [...new Set(rows.map((r) => r[familyKey]))];
  return {
    labels,
    datasets: families.map((family) => ({
      label: familyKey === "family" ? familyLabel(family) : String(family).replaceAll("_", " "),
      data: labels.map((day) => {
        const row = rows.find((r) => r.day === day && r[familyKey] === family);
        return row ? Number(row[valueKey]) : 0;
      }),
      backgroundColor: COLORS[family] || COLORS.muted,
      borderColor: COLORS[family] || COLORS.muted,
      borderWidth: 1,
    })),
  };
}

function groupedLine(rows, xKey, groupKey, valueKey) {
  const labels = [...new Set((rows || []).map((r) => r[xKey]))].sort();
  const groups = [...new Set((rows || []).map((r) => r[groupKey]))].sort();
  const palette = [COLORS.blue, COLORS.teal, COLORS.gold, COLORS.rose, COLORS.green, COLORS.slate];
  return {
    labels,
    datasets: groups.map((group, index) => ({
      label: groupKey === "family" ? familyLabel(group) : String(group),
      data: labels.map((label) => {
        const row = rows.find((r) => r[xKey] === label && r[groupKey] === group);
        return row ? Number(row[valueKey] || 0) : 0;
      }),
      borderColor: COLORS[group] || palette[index % palette.length],
      backgroundColor: "transparent",
      tension: 0.25,
    })),
  };
}

function topRows(rows, valueKey, limit = 10) {
  return [...(rows || [])]
    .sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0))
    .slice(0, limit);
}

function uniqueSorted(rows, key) {
  return [...new Set((rows || []).map((row) => row[key]).filter((value) => value !== null && value !== undefined))]
    .map(String)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function tableControlButton(label, value, active) {
  return `<button type="button" data-limit="${value}" class="${active ? "active" : ""}">${label}</button>`;
}

function optionLabel(value, filter) {
  const raw = String(value);
  if (filter.prefix) return `${filter.prefix}${raw}`;
  return raw.replaceAll("_", " ");
}

function renderFilteredTable({ controlsId, tableId, rows, columns, stateKey, filters = [], sortKey, limitOptions = [10, 25, 50] }) {
  const sourceRows = rows || [];
  const state = TABLE_FILTERS[stateKey];
  const controls = document.getElementById(controlsId);
  if (!controls || !state) {
    table(tableId, sourceRows, columns, limitOptions[1] || 25);
    return;
  }

  filters.forEach((filter) => {
    const values = uniqueSorted(sourceRows, filter.key);
    if (state[filter.key] !== "all" && !values.includes(String(state[filter.key]))) {
      state[filter.key] = filter.defaultValue && values.includes(String(filter.defaultValue)) ? String(filter.defaultValue) : "all";
    }
  });

  controls.innerHTML = `
    ${filters
      .map((filter) => {
        const values = uniqueSorted(sourceRows, filter.key);
        return `
          <label>${filter.label}
            <select data-filter="${escapeHtml(filter.key)}">
              <option value="all"${state[filter.key] === "all" ? " selected" : ""}>${escapeHtml(filter.allLabel || "All")}</option>
              ${values
                .map((value) => `<option value="${escapeHtml(value)}"${String(state[filter.key]) === value ? " selected" : ""}>${escapeHtml(optionLabel(value, filter))}</option>`)
                .join("")}
            </select>
          </label>
        `;
      })
      .join("")}
    <div class="limit-toggle" aria-label="Rows to show">
      ${limitOptions.map((limit) => tableControlButton(`Top ${limit}`, limit, Number(state.limit) === limit)).join("")}
    </div>
  `;

  controls.querySelectorAll("select[data-filter]").forEach((select) => {
    select.addEventListener("change", (event) => {
      state[event.target.dataset.filter] = event.target.value;
      renderFilteredTable({ controlsId, tableId, rows: sourceRows, columns, stateKey, filters, sortKey, limitOptions });
    });
  });
  controls.querySelectorAll("button[data-limit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.limit = Number(button.dataset.limit);
      renderFilteredTable({ controlsId, tableId, rows: sourceRows, columns, stateKey, filters, sortKey, limitOptions });
    });
  });

  const filtered = sourceRows
    .filter((row) => filters.every((filter) => state[filter.key] === "all" || String(row[filter.key]) === String(state[filter.key])))
    .sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0))
    .slice(0, Number(state.limit));
  table(tableId, filtered, columns, Number(state.limit));
}

function trendSection(sectionKey) {
  if (SELECTED_PERIOD === "daily") {
    return DASHBOARD_DATA.periods?.weekly?.[sectionKey] || selectedData()[sectionKey];
  }
  return selectedData()[sectionKey];
}

function trendWindowLabel() {
  return SELECTED_PERIOD === "daily" ? "Last 7 days" : "Selected period";
}

function dashboardDateOptions() {
  const weekly = DASHBOARD_DATA.periods?.weekly;
  const days = new Set();
  (weekly?.monetization?.daily_summary || []).forEach((row) => days.add(row.day));
  (weekly?.acquisition?.daily || []).forEach((row) => days.add(row.signup_date));
  (weekly?.engagement?.session_daily || []).forEach((row) => days.add(row.date));
  return [...days].filter(Boolean).sort();
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const columns = ["area", "table", ...[...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !["area", "table"].includes(key))];
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dayRows(rows, key, day) {
  return (rows || []).filter((row) => row[key] === day);
}

function buildDayExportRows(day) {
  const weekly = DASHBOARD_DATA.periods?.weekly || selectedData();
  const sections = [
    ["Monetization", "Daily revenue by stream", dayRows(weekly.monetization?.daily, "day", day)],
    ["Monetization", "Daily pack detail", dayRows(weekly.monetization?.daily_pack_merged || weekly.monetization?.daily_pack, "day", day)],
    ["Monetization", "Daily new vs old revenue", dayRows(weekly.monetization?.daily_user_cohort, "day", day)],
    ["Acquisition", "Daily new user funnel", dayRows(weekly.acquisition?.daily, "signup_date", day)],
    ["Acquisition", "Daily payment family", dayRows(weekly.acquisition?.daily_payment_family, "signup_date", day)],
    ["Engagement", "Daily sessions", dayRows(weekly.engagement?.session_daily, "date", day)],
    ["Engagement", "Daily BIM opens", dayRows(weekly.engagement?.bim_daily, "date", day)],
    ["Engagement", "Session new vs old", dayRows(weekly.engagement?.session_user_cohort_daily, "date", day)],
    ["Engagement", "BIM new vs old", dayRows(weekly.engagement?.bim_user_cohort_daily, "date", day)],
  ];
  return sections.flatMap(([area, tableName, rows]) => rows.map((row) => ({ area, table: tableName, ...row })));
}

function setupDayDownloadControls() {
  const controls = document.getElementById("dayDownloadControls");
  if (!controls) return;
  const days = dashboardDateOptions();
  if (!days.length) {
    controls.innerHTML = "";
    return;
  }
  const defaultDay = days[days.length - 1];
  controls.innerHTML = `
    <select id="downloadDaySelect" aria-label="Day to download">
      ${days.map((day) => `<option value="${escapeHtml(day)}"${day === defaultDay ? " selected" : ""}>${escapeHtml(shortDate(day))}</option>`).join("")}
    </select>
    <button type="button" id="downloadDayCsv">Download CSV</button>
  `;
  document.getElementById("downloadDayCsv").addEventListener("click", () => {
    const day = document.getElementById("downloadDaySelect").value;
    downloadCsv(`hiastro-dashboard-${day}.csv`, buildDayExportRows(day));
  });
}

function renderRetentionSegmentTable(rows) {
  const sourceRows = rows || [];
  const state = TABLE_FILTERS.retentionSegment;
  const segments = uniqueSorted(sourceRows, "segment");
  const days = uniqueSorted(sourceRows, "day_n");
  if (state.segment !== "all" && !segments.includes(String(state.segment))) state.segment = "all";
  if (state.day !== "all" && !days.includes(String(state.day))) state.day = days.includes("1") ? "1" : "all";

  const controls = document.getElementById("retentionSegmentControls");
  controls.innerHTML = `
    <label>Segment
      <select data-filter="segment">
        <option value="all"${state.segment === "all" ? " selected" : ""}>All</option>
        ${segments.map((segment) => `<option value="${escapeHtml(segment)}"${state.segment === segment ? " selected" : ""}>${escapeHtml(segment.replaceAll("_", " "))}</option>`).join("")}
      </select>
    </label>
    <label>Day
      <select data-filter="day">
        <option value="all"${state.day === "all" ? " selected" : ""}>All days</option>
        ${days.map((day) => `<option value="${escapeHtml(day)}"${state.day === day ? " selected" : ""}>D${escapeHtml(day)}</option>`).join("")}
      </select>
    </label>
    <div class="limit-toggle" aria-label="Rows to show">
      ${[10, 20, 50].map((limit) => tableControlButton(`Top ${limit}`, limit, Number(state.limit) === limit)).join("")}
    </div>
  `;

  controls.querySelector('select[data-filter="segment"]').addEventListener("change", (event) => {
    state.segment = event.target.value;
    renderRetentionSegmentTable(sourceRows);
  });
  controls.querySelector('select[data-filter="day"]').addEventListener("change", (event) => {
    state.day = event.target.value;
    renderRetentionSegmentTable(sourceRows);
  });
  controls.querySelectorAll("button[data-limit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.limit = Number(button.dataset.limit);
      renderRetentionSegmentTable(sourceRows);
    });
  });

  const filtered = sourceRows
    .filter((row) => state.segment === "all" || String(row.segment) === state.segment)
    .filter((row) => state.day === "all" || String(row.day_n) === state.day)
    .sort((a, b) => Number(b.cohort_users || 0) - Number(a.cohort_users || 0))
    .slice(0, Number(state.limit));
  table("retentionSegmentTable", filtered, [
    { key: "selection", label: "Selection", text: true },
    { key: "day_n", label: "Day", text: true, format: (v) => `D${v}` },
    { key: "cohort_users", label: "Cohort", format: number },
    { key: "retained_users", label: "Retained", format: number },
    { key: "retention_pct", label: "Retention", format: pct },
  ], Number(state.limit));
}

function renderBotSegmentTable(rows) {
  const sourceRows = rows || [];
  const state = TABLE_FILTERS.botSegment;
  const segments = uniqueSorted(sourceRows, "segment");
  if (state.segment !== "all" && !segments.includes(String(state.segment))) state.segment = "all";

  const controls = document.getElementById("botSegmentControls");
  controls.innerHTML = `
    <label>Segment
      <select data-filter="segment">
        <option value="all"${state.segment === "all" ? " selected" : ""}>All</option>
        ${segments.map((segment) => `<option value="${escapeHtml(segment)}"${state.segment === segment ? " selected" : ""}>${escapeHtml(segment.replaceAll("_", " "))}</option>`).join("")}
      </select>
    </label>
    <div class="limit-toggle" aria-label="Rows to show">
      ${[10, 25, 50].map((limit) => tableControlButton(`Top ${limit}`, limit, Number(state.limit) === limit)).join("")}
    </div>
  `;

  controls.querySelector('select[data-filter="segment"]').addEventListener("change", (event) => {
    state.segment = event.target.value;
    renderBotSegmentTable(sourceRows);
  });
  controls.querySelectorAll("button[data-limit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.limit = Number(button.dataset.limit);
      renderBotSegmentTable(sourceRows);
    });
  });

  const filtered = sourceRows
    .filter((row) => state.segment === "all" || String(row.segment) === state.segment)
    .sort((a, b) => Number(b.active_users || 0) - Number(a.active_users || 0))
    .slice(0, Number(state.limit));
  table("botSegmentTable", filtered, [
    { key: "selection", label: "Selection", text: true },
    { key: "active_users", label: "Users", format: number },
    { key: "repeat_users_2plus_days", label: "Repeat Users", format: number },
    { key: "repeat_rate_pct", label: "Repeat Rate", format: pct },
    { key: "sessions", label: "Sessions", format: number },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], Number(state.limit));
}

function chart(id, type, data, options = {}) {
  const el = document.getElementById(id);
  if (CHARTS[id]) {
    CHARTS[id].destroy();
  }
  CHARTS[id] = new Chart(el, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: type === "doughnut" ? {} : {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "#eef2f6" } },
      },
      ...options,
    },
  });
  return CHARTS[id];
}

function renderOverview(data) {
  const m = data.monetization.kpis.current;
  const g7 = data.monetization.kpis.growth_vs_prior_7;
  const sub = familyMetric(data.monetization, "subscription");
  const payg = familyMetric(data.monetization, "pay_as_you_go");
  const dayPass = familyMetric(data.monetization, "day_pass");
  const a = data.acquisition.kpis;
  const r = data.retention.curve.find((x) => x.day_n === 1);
  const e = data.engagement.kpis;
  const comparison = data.metadata?.comparison_window?.label || "previous period";
  document.getElementById("overviewCards").innerHTML = [
    card("Revenue", money(m.revenue), `vs ${comparison} ${trend(g7.revenue)}`),
    card("Subscription Rev", money(sub.revenue), `${pct(sub.revenue_share_pct)} of revenue | ${number(sub.payers)} payers`),
    card("PayG Rev", money(payg.revenue), `${pct(payg.revenue_share_pct)} of revenue | ${number(payg.payers)} payers`),
    card("Day Pass Rev", money(dayPass.revenue), `${pct(dayPass.revenue_share_pct)} of revenue | ${number(dayPass.payers)} payers`),
    card("Payers", number(m.payers), `vs ${comparison} ${trend(g7.payers)}`),
    card("Avg Transaction", money(m.avg_transaction), `vs ${comparison} ${trend(g7.avg_transaction)}`),
    card("New Users", number(a.new_users), `${pct(a.new_user_to_followup_pct)} reached follow-up`),
    card("D1 Chat Retention", pct(r?.retention_pct || 0), `${number(r?.retained_users || 0)} retained users`),
    card("Avg Time / User", `${e.avg_minutes_per_user}m`, `${number(e.sessions)} app sessions`),
    card("BIM Opens", number(e.bim_notification_opens), `${number(e.bim_notification_users)} users`),
  ].join("");

  const materialFamilies = familyRows(data.monetization).filter((row) => Number(row.revenue_share_pct || 0) >= 5);
  const bestFamily = topRows(materialFamilies.length ? materialFamilies : familyRows(data.monetization), "revenue_growth_vs_prior_7_pct", 1)[0] || sub;
  const weakestFamily = [...familyRows(data.monetization)].sort((x, y) => Number(x.revenue_growth_vs_prior_7_pct || 0) - Number(y.revenue_growth_vs_prior_7_pct || 0))[0] || payg;
  const bestFamilyGrowth = Number(bestFamily.revenue_growth_vs_prior_7_pct || 0);
  const bestFamilyLabel = bestFamilyGrowth > 0 ? "Growing Stream" : "Least Decline";
  const paymentGap = Number(a.new_user_to_followup_pct || 0) - Number(a.new_user_to_payment_pct || 0);
  document.getElementById("decisionInsights").innerHTML = [
    insightCard("Revenue Momentum", `${trend(g7.revenue)} vs prior`, `${money(m.revenue)} total revenue`, Number(g7.revenue || 0) >= 0 ? "good" : "risk"),
    insightCard(bestFamilyLabel, bestFamily.family_label || familyLabel(bestFamily.family), `${trend(bestFamily.revenue_growth_vs_prior_7_pct)} revenue growth | ${money(bestFamily.revenue)}`, bestFamilyGrowth > 0 ? "good" : "risk"),
    insightCard("Watch Area", weakestFamily.family_label || familyLabel(weakestFamily.family), `${trend(weakestFamily.revenue_growth_vs_prior_7_pct)} revenue growth | ${number(weakestFamily.payers)} payers`, Number(weakestFamily.revenue_growth_vs_prior_7_pct || 0) < 0 ? "risk" : "neutral"),
    insightCard("Conversion Gap", `${paymentGap.toFixed(1)} pts`, `${pct(a.new_user_to_followup_pct)} follow-up vs ${pct(a.new_user_to_payment_pct)} payment`, paymentGap > 30 ? "risk" : "neutral"),
  ].join("");
}

function renderMonetization(data) {
  const meta = data.metadata;
  const m = data.monetization;
  const mTrend = trendSection("monetization");
  const chartLabel = trendWindowLabel();
  const k = m.kpis.current;
  const g7 = m.kpis.growth_vs_prior_7;
  const g30 = m.kpis.growth_vs_prior_30_7day_baseline;
  const sub = familyMetric(m, "subscription");
  const payg = familyMetric(m, "pay_as_you_go");
  const dayPass = familyMetric(m, "day_pass");
  const comparison = meta.comparison_window || meta.prior_7_window;
  document.getElementById("monetizationNote").textContent = `${meta.current_window.start} to ${meta.current_window.end}; growth vs ${comparison.start} to ${comparison.end}.`;
  document.getElementById("monetizationCards").innerHTML = [
    card("Total Revenue", money(k.revenue), `${comparison.label || "previous period"} ${trend(g7.revenue)} | 30-day baseline ${trend(g30.revenue)}`),
    card("Subscription", money(sub.revenue), `${pct(sub.revenue_share_pct)} share | ${trend(sub.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Pay as you go", money(payg.revenue), `${pct(payg.revenue_share_pct)} share | ${trend(payg.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Day Pass", money(dayPass.revenue), `${pct(dayPass.revenue_share_pct)} share | ${trend(dayPass.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Payers", number(k.payers), `${comparison.label || "previous period"} ${trend(g7.payers)} | 30-day baseline ${trend(g30.payers)}`),
    card("Transactions", number(k.transactions), `${comparison.label || "previous period"} ${trend(g7.transactions)} | 30-day baseline ${trend(g30.transactions)}`),
    card("Avg Transaction", money(k.avg_transaction), `${comparison.label || "previous period"} ${trend(g7.avg_transaction)} | 30-day avg ${trend(g30.avg_transaction)}`),
  ].join("");

  document.getElementById("streamSplitCards").innerHTML = [
    streamCard(sub, COLORS.subscription),
    streamCard(payg, COLORS.pay_as_you_go),
    streamCard(dayPass, COLORS.day_pass),
  ].join("");

  const daily = groupedDaily(mTrend.daily || m.daily);
  daily.labels = daily.labels.map(shortDate);
  chart("revenueDailyChart", "line", daily, {
    plugins: { title: { display: true, text: `${chartLabel}: Daily Revenue by Family` }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f6" } } },
  });

  const dailySummary = mTrend.daily_summary || m.daily_summary || [];
  chart("revenueRateChart", "line", {
    labels: dailySummary.map((r) => shortDate(r.day)),
    datasets: [
      { label: "Revenue", data: dailySummary.map((r) => r.revenue), borderColor: COLORS.blue, backgroundColor: "rgba(37,99,235,0.12)", yAxisID: "y", tension: 0.25 },
      { label: "Payers", data: dailySummary.map((r) => r.payers), borderColor: COLORS.teal, yAxisID: "y1", tension: 0.25 },
      { label: "Avg txn", data: dailySummary.map((r) => r.avg_transaction), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: Revenue, Payers and Avg Transaction` } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Revenue" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Payers / Avg txn" } },
    },
  });

  const familyPayers = groupedDaily(mTrend.daily || m.daily || [], "family", "payers");
  familyPayers.labels = familyPayers.labels.map(shortDate);
  chart("familyPayerChart", "line", familyPayers, {
    plugins: { title: { display: true, text: `${chartLabel}: Payers by Revenue Stream` } },
  });

  const familyAvgTxn = groupedDaily(mTrend.daily || m.daily || [], "family", "avg_transaction");
  familyAvgTxn.labels = familyAvgTxn.labels.map(shortDate);
  chart("familyAvgTxnChart", "line", familyAvgTxn, {
    plugins: { title: { display: true, text: `${chartLabel}: Avg Transaction by Stream` } },
  });

  chart("revenueFamilyChart", "doughnut", {
    labels: m.family.map((r) => r.family_label || familyLabel(r.family)),
    datasets: [{ data: m.family.map((r) => r.revenue), backgroundColor: [COLORS.subscription, COLORS.pay_as_you_go, COLORS.day_pass] }],
  }, {
    plugins: { title: { display: true, text: "Revenue Mix" }, legend: { position: "bottom" } },
  });

  chart("streamEfficiencyChart", "bar", {
    labels: m.family.map((r) => r.family_label || familyLabel(r.family)),
    datasets: [
      { label: "Revenue share %", data: m.family.map((r) => r.revenue_share_pct), backgroundColor: COLORS.blue },
      { label: "Payer share %", data: m.family.map((r) => r.payer_share_pct), backgroundColor: COLORS.teal },
      { label: "Transaction share %", data: m.family.map((r) => r.transaction_share_pct), backgroundColor: COLORS.gold },
    ],
  }, {
    plugins: { title: { display: true, text: "Revenue, Payer and Transaction Distribution" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "#eef2f6" } } },
  });

  const cohortRevenue = groupedLine(mTrend.daily_user_cohort || m.daily_user_cohort || [], "day", "user_cohort", "revenue");
  cohortRevenue.labels = cohortRevenue.labels.map(shortDate);
  chart("revenueCohortChart", "line", cohortRevenue, {
    plugins: { title: { display: true, text: `${chartLabel}: Revenue by New vs Old Users` } },
  });

  table("revenueStreamKpiTable", m.kpis?.by_family || m.family || [], [
    { key: "selection", label: "Selection", text: true },
    { key: "family_label", label: "Revenue Stream", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "payer_share_pct", label: "Payer Share", format: pct },
    { key: "transactions", label: "Txns", format: number },
    { key: "transaction_share_pct", label: "Txn Share", format: pct },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
  ], 10);

  table("revenueDailyTable", m.daily, [
    { key: "day", label: "Date", text: true, format: shortDate },
    { key: "family", label: "Family", text: true, format: familyLabel },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Day Share", format: pct },
  ], 30);

  table("revenueCohortTable", m.daily_user_cohort || [], [
    { key: "day", label: "Date", text: true, format: shortDate },
    { key: "user_cohort", label: "User Type", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Daily Share", format: pct },
  ], 20);

  const payerSegmentColumns = [
    { key: "selection", label: "Selection", text: true },
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
  ];
  renderFilteredTable({
    controlsId: "payerSegmentControls",
    tableId: "payerSegmentTable",
    rows: m.payer_segments || [],
    columns: payerSegmentColumns,
    stateKey: "payerSegment",
    filters: [{ key: "segment", label: "Segment" }],
    sortKey: "revenue",
  });

  renderFilteredTable({
    controlsId: "payerFamilySegmentControls",
    tableId: "payerFamilySegmentTable",
    rows: m.payer_segments_by_family || [],
    columns: [
    { key: "selection", label: "Selection", text: true },
    { key: "family_label", label: "Revenue Stream", text: true },
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "family_revenue_share_pct", label: "Stream Share", format: pct },
    { key: "total_revenue_share_pct", label: "Total Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    ],
    stateKey: "payerFamilySegment",
    filters: [
      { key: "family_label", label: "Stream" },
      { key: "segment", label: "Segment" },
    ],
    sortKey: "revenue",
  });

  table("revenueFamilyTable", m.family, [
    { key: "selection", label: "Selection", text: true },
    { key: "family_label", label: "Family", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "payer_share_pct", label: "Payer Share", format: pct },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
  ], 10);

  const subscriptionPlans = m.subscription_plan_performance || [];
  const subscriptionStages = m.subscription_stage_performance || [];
  const subscriptionPacks = m.subscription_pack || [];
  const renewal = m.subscription_renewal || { kpis: {}, due_daily: [], due_by_plan: [], status_breakdown: [], notes: [] };
  const paygMergedRows = m.payg_merged || [];
  const paygMerged = paygMergedRows[0] || familyMetric(m, "pay_as_you_go");
  const paygAmounts = m.payg_amount_breakdown || [];
  const topPlan = subscriptionPlans[0] || {};
  const topWalletAmount = paygAmounts[0] || {};
  const mainPackRows = subscriptionStages
    .filter((row) => row.stage === "Main" && [199, 499].includes(Number(row.amount)))
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const main499 = mainPackRows.find((row) => Number(row.amount) === 499) || {};
  const main199 = mainPackRows.find((row) => Number(row.amount) === 199) || {};
  const trialRows = subscriptionStages.filter((row) => row.stage === "Trial");
  const trialBuyers = trialRows.reduce((sum, row) => sum + Number(row.payers || 0), 0);
  const trialRevenue = trialRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const mainBuyers = mainPackRows.reduce((sum, row) => sum + Number(row.payers || 0), 0);
  const mainRevenue = mainPackRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const main499BuyerShare = safePercent(main499.payers, mainBuyers);
  const main199BuyerShare = safePercent(main199.payers, mainBuyers);
  const main499RevenueShare = safePercent(main499.revenue, mainRevenue);
  const main199RevenueShare = safePercent(main199.revenue, mainRevenue);
  const trialToMainPct = safePercent(mainBuyers, trialBuyers);
  const bestConversionPlan = [...subscriptionPlans]
    .filter((row) => Number(row.trial_buyers || 0) >= 10)
    .sort((a, b) => Number(b.main_to_trial_buyer_pct || 0) - Number(a.main_to_trial_buyer_pct || 0))[0] || {};
  const bestRevenuePlan = topRows(subscriptionPlans, "revenue", 1)[0] || {};
  const mainPackDailyRows = (mTrend.daily_pack || m.daily_pack || [])
    .filter((row) => row.family === "subscription" && String(row.pack || "").startsWith("Main Rs ") && [199, 499].includes(Number(row.amount)))
    .map((row) => ({ ...row, pack_amount: `Rs ${Number(row.amount)}` }));
  const mainPackDaily = groupedLine(mainPackDailyRows, "day", "pack_amount", "payers");
  mainPackDaily.labels = mainPackDaily.labels.map(shortDate);

  document.getElementById("subscriptionFocusCards").innerHTML = [
    card("Subscription Revenue", money(sub.revenue), `${pct(sub.revenue_share_pct)} of total | ${trend(sub.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Sub Payers", number(sub.payers), `${number(sub.transactions)} transactions | ARPP ${money(sub.avg_revenue_per_payer)}`),
    card("Rs 499 Main Users", number(main499.payers), `${money(main499.revenue)} revenue`),
    card("Rs 199 Main Users", number(main199.payers), `${money(main199.revenue)} revenue`),
    card("Trial Buyers", number(trialBuyers), `${money(trialRevenue)} from Rs 1 and Rs 49 trials`),
    card("Main Buyers", number(mainBuyers), `${pct(trialToMainPct)} of trial buyers | ${money(mainRevenue)}`),
  ].join("");
  document.getElementById("subscriptionConversionCards").innerHTML = [
    actionCard("Trial to Main", pct(trialToMainPct), `${number(mainBuyers)} main buyers from ${number(trialBuyers)} trial buyers`, trialToMainPct >= 20 ? "good" : "risk"),
    actionCard("Rs 499 Main Share", pct(main499BuyerShare), `${number(main499.payers)} users | ${pct(main499RevenueShare)} of main revenue`, main499BuyerShare >= main199BuyerShare ? "good" : "neutral"),
    actionCard("Best Plan Conversion", bestConversionPlan.plan_code || "-", `${pct(bestConversionPlan.main_to_trial_buyer_pct)} main/trial | ${number(bestConversionPlan.main_buyers)} main buyers`, "good"),
  ].join("");

  document.getElementById("packPerformanceCards").innerHTML = [
    card("Rs 499 Main Users", number(main499.payers), `${money(main499.revenue)} | ${number(main499.transactions)} txns`),
    card("Rs 199 Main Users", number(main199.payers), `${money(main199.revenue)} | ${number(main199.transactions)} txns`),
    card("Rs 499 vs 199", `${number(main499.payers)} / ${number(main199.payers)}`, `${pct(main499BuyerShare)} / ${pct(main199BuyerShare)} of main buyers`),
    card("Best Sub Plan", topPlan.plan_code || "No plan", `${money(topPlan.revenue)} | ${pct(topPlan.main_to_trial_buyer_pct)} main/trial`),
    card("Sub Main Buyers", number(mainBuyers), `${pct(trialToMainPct)} converted from trial`),
    card("Sub Trial Buyers", number(trialBuyers), `${money(trialRevenue)} trial revenue`),
    card("Merged PayG", money(paygMerged.revenue), `${number(paygMerged.payers)} payers | ${trend(paygMerged.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Top Wallet Amount", optionalMoney(topWalletAmount.amount), `${money(topWalletAmount.revenue)} | ${number(topWalletAmount.transactions)} txns`),
  ].join("");
  document.getElementById("packConversionCards").innerHTML = [
    actionCard("Main Conversion", pct(trialToMainPct), `${number(trialBuyers)} trial buyers to ${number(mainBuyers)} main buyers`, trialToMainPct >= 20 ? "good" : "risk"),
    actionCard("499 vs 199 Revenue", `${pct(main499RevenueShare)} / ${pct(main199RevenueShare)}`, `${money(main499.revenue)} vs ${money(main199.revenue)}`, main499RevenueShare >= main199RevenueShare ? "good" : "neutral"),
    actionCard("Best Revenue Plan", bestRevenuePlan.plan_code || "-", `${money(bestRevenuePlan.revenue)} | ${number(bestRevenuePlan.payers)} payers`, "neutral"),
  ].join("");

  document.getElementById("paygFocusCards").innerHTML = [
    card("PayG Revenue", money(paygMerged.revenue), `${pct(paygMerged.revenue_share_pct)} of total | ${trend(paygMerged.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("PayG Payers", number(paygMerged.payers), `${number(paygMerged.transactions)} transactions`),
    card("PayG Avg Transaction", money(paygMerged.avg_transaction), `ARPP ${money(paygMerged.avg_revenue_per_payer)}`),
    card("Top Wallet Amount", optionalMoney(topWalletAmount.amount), `${money(topWalletAmount.revenue)} | ${number(topWalletAmount.payers)} payers`),
  ].join("");

  chart("mainPackBuyerChart", "line", mainPackDaily, {
    plugins: { title: { display: true, text: `${chartLabel}: Rs 499 vs Rs 199 Main Buyers` }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Users" } } },
  });

  chart("subscriptionStageChart", "doughnut", {
    labels: subscriptionStages.map((row) => `${row.stage} ${money(row.amount)}`),
    datasets: [{ data: subscriptionStages.map((row) => row.revenue), backgroundColor: [COLORS.blue, COLORS.teal, COLORS.gold, COLORS.rose] }],
  }, {
    plugins: { title: { display: true, text: "Subscription Revenue: Trial vs Main" }, legend: { position: "bottom" } },
  });

  table("mainPackAmountTable", mainPackRows, [
    { key: "selection", label: "Selection", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "payers", label: "Users", format: number },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Sub Share", format: pct },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], 10);

  const subscriptionPlanDaily = groupedLine(
    (mTrend.daily_pack || m.daily_pack || []).filter((row) => row.family === "subscription"),
    "day",
    "plan_code",
    "revenue",
  );
  subscriptionPlanDaily.labels = subscriptionPlanDaily.labels.map(shortDate);
  chart("subscriptionPlanDailyChart", "line", subscriptionPlanDaily, {
    plugins: { title: { display: true, text: `${chartLabel}: Subscription Revenue by Plan` }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f6" } } },
  });

  const renewalKpis = renewal.kpis || {};
  const dueDaily = renewal.due_daily || [];
  const dueByPlan = renewal.due_by_plan || [];
  const highestRiskPlan = topRows(dueByPlan, "renewal_revenue_at_risk", 1)[0] || {};
  document.getElementById("renewalCards").innerHTML = [
    card("Active Paid Subs", number(renewalKpis.active_paid_subscriptions), "Currently active paid plans"),
    card("Trial Active", number(renewalKpis.trial_active_subscriptions), "Trial users that may convert"),
    card("Renewal Due 7D", number(renewalKpis.renewal_due_next_7_days), `${money(renewalKpis.renewal_revenue_at_risk)} renewal revenue at risk`),
    card("Autopay Ready", number(renewalKpis.autopay_ready_users), `${pct(renewalKpis.autopay_ready_pct)} of due renewals`),
    card("Cancel Scheduled", number(renewalKpis.cancel_scheduled_users), `${money(renewalKpis.cancel_scheduled_revenue)} upcoming due revenue at risk`),
    card("Renewal Success", "Not tracked yet", "Needs recurring charge success/failure events"),
  ].join("");
  document.getElementById("renewalActionCards").innerHTML = [
    actionCard("Expected 7D Renewal", money(renewalKpis.expected_renewal_revenue), `${number(renewalKpis.autopay_ready_users)} autopay-ready users`, Number(renewalKpis.expected_renewal_revenue || 0) > 0 ? "good" : "neutral"),
    actionCard("Highest Due Plan", highestRiskPlan.plan_code || "-", `${money(highestRiskPlan.renewal_revenue_at_risk)} | ${number(highestRiskPlan.due_users)} users`, "neutral"),
    actionCard("Missing Event", "Autopay result", "Add renewal_success and renewal_failed events when recurring billing starts", "risk"),
  ].join("");
  chart("renewalDueChart", "line", {
    labels: dueDaily.map((row) => shortDate(row.renewal_due_date)),
    datasets: [
      { label: "Due users", data: dueDaily.map((row) => row.due_users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Autopay-ready", data: dueDaily.map((row) => row.autopay_ready_users), borderColor: COLORS.green, tension: 0.25 },
      { label: "Cancel scheduled", data: dueDaily.map((row) => row.cancel_scheduled_users), borderColor: COLORS.rose, tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Next 7 Days Renewal Due" } },
  });
  chart("renewalPlanChart", "bar", {
    labels: dueByPlan.slice(0, 8).map((row) => row.plan_code),
    datasets: [
      { label: "Expected renewal revenue", data: dueByPlan.slice(0, 8).map((row) => row.expected_renewal_revenue), backgroundColor: COLORS.green },
      { label: "Cancel risk revenue", data: dueByPlan.slice(0, 8).map((row) => Number(row.renewal_revenue_at_risk || 0) - Number(row.expected_renewal_revenue || 0)), backgroundColor: COLORS.rose },
    ],
  }, {
    plugins: { title: { display: true, text: "Renewal Revenue by Plan" }, legend: { position: "bottom" } },
  });
  table("renewalDueTable", dueDaily, [
    { key: "renewal_due_date", label: "Due Date", text: true, format: shortDate },
    { key: "due_users", label: "Due Users", format: number },
    { key: "autopay_ready_users", label: "Autopay Ready", format: number },
    { key: "cancel_scheduled_users", label: "Cancel Scheduled", format: number },
    { key: "renewal_revenue_at_risk", label: "Revenue at Risk", format: money },
    { key: "expected_renewal_revenue", label: "Expected Revenue", format: money },
  ], 10);
  table("renewalPlanTable", dueByPlan, [
    { key: "plan_code", label: "Plan", text: true },
    { key: "due_users", label: "Due Users", format: number },
    { key: "autopay_ready_users", label: "Autopay Ready", format: number },
    { key: "autopay_ready_pct", label: "Ready %", format: pct },
    { key: "cancel_scheduled_users", label: "Cancel Scheduled", format: number },
    { key: "renewal_revenue_at_risk", label: "Revenue at Risk", format: money },
    { key: "expected_renewal_revenue", label: "Expected Revenue", format: money },
  ], 12);
  table("renewalStatusTable", renewal.status_breakdown || [], [
    { key: "status", label: "Status", text: true },
    { key: "subscription_case", label: "Case", text: true },
    { key: "users", label: "Users", format: number },
  ], 12);

  const paygDailyRows = (mTrend.daily || m.daily || []).filter((row) => row.family === "pay_as_you_go");
  chart("paygDailyChart", "line", {
    labels: paygDailyRows.map((r) => shortDate(r.day)),
    datasets: [
      { label: "PayG revenue", data: paygDailyRows.map((r) => r.revenue), borderColor: COLORS.pay_as_you_go, backgroundColor: "rgba(15,118,110,0.12)", yAxisID: "y", tension: 0.25 },
      { label: "PayG payers", data: paygDailyRows.map((r) => r.payers), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: Merged Pay as You Go` }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Revenue" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Payers" } },
    },
  });

  const paygAmountRows = topRows(paygAmounts, "revenue", 8);
  chart("paygAmountMixChart", "bar", {
    labels: paygAmountRows.map((row) => money(row.amount)),
    datasets: [
      { label: "Revenue", data: paygAmountRows.map((row) => row.revenue), backgroundColor: COLORS.pay_as_you_go },
      { label: "Payers", data: paygAmountRows.map((row) => row.payers), backgroundColor: COLORS.gold, yAxisID: "y1" },
    ],
  }, {
    plugins: { title: { display: true, text: "PayG Wallet Amount Mix" }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Revenue" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Payers" } },
    },
  });

  table("subscriptionPlanTable", subscriptionPlans, [
    { key: "selection", label: "Selection", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Sub Share", format: pct },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
    { key: "trial_revenue", label: "Trial Rev", format: money },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_revenue", label: "Main Rev", format: money },
    { key: "main_buyers", label: "Main Buyers", format: number },
    { key: "main_to_trial_buyer_pct", label: "Main / Trial", format: pct },
  ], 20);

  table("subscriptionStageTable", subscriptionStages, [
    { key: "selection", label: "Selection", text: true },
    { key: "stage", label: "Stage", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Sub Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], 20);

  table("paygMergedTable", paygMergedRows, [
    { key: "selection", label: "Selection", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "payer_share_pct", label: "Payer Share", format: pct },
    { key: "transactions", label: "Txns", format: number },
    { key: "transaction_share_pct", label: "Txn Share", format: pct },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
  ], 5);

  const packColumns = [
    { key: "selection", label: "Selection", text: true },
    { key: "pack", label: "Pack", text: true },
    { key: "family_label", label: "Family", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "amount", label: "Amount", format: optionalMoney },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
  ];
  renderFilteredTable({
    controlsId: "packControls",
    tableId: "packTable",
    rows: m.pack_merged || m.pack,
    columns: packColumns,
    stateKey: "pack",
    filters: [{ key: "family_label", label: "Family" }],
    sortKey: "revenue",
    limitOptions: [10, 20, 30],
  });

  const topPackSelections = (m.pack_merged || m.pack || []).slice(0, 6).map((row) => row.selection);
  const packDailyRows = (mTrend.daily_pack_merged || mTrend.daily_pack || m.daily_pack_merged || m.daily_pack || []).filter((row) => topPackSelections.includes(row.selection));
  const packDaily = groupedLine(packDailyRows, "day", "selection", "revenue");
  packDaily.labels = packDaily.labels.map(shortDate);
  chart("packDailyChart", "line", packDaily, {
    plugins: { title: { display: true, text: `${chartLabel}: Top Pack Revenue, PayG Merged` } },
  });

  chart("payerFrequencyChart", "bar", {
    labels: (m.payer_frequency || []).map((r) => r.bucket),
    datasets: [
      { label: "Payers", data: (m.payer_frequency || []).map((r) => r.payers), backgroundColor: COLORS.teal },
      { label: "Revenue share %", data: (m.payer_frequency || []).map((r) => r.revenue_share_pct), backgroundColor: COLORS.gold },
    ],
  }, {
    plugins: { title: { display: true, text: "Payer Frequency and Revenue Share" } },
  });

  table("amountBreakdownTable", m.amount_breakdown || [], [
    { key: "family_label", label: "Family", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], 25);

  table("paygAmountTable", paygAmounts, [
    { key: "family_label", label: "Family", text: true },
    { key: "amount", label: "Wallet Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], 20);

  table("revenueConcentrationTable", m.revenue_concentration || [], [
    { key: "group", label: "Group", text: true },
    { key: "payers", label: "Payers", format: number },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
  ], 10);

  renderFilteredTable({
    controlsId: "rawPackControls",
    tableId: "rawPackTable",
    rows: m.pack || [],
    columns: [
    { key: "selection", label: "Selection", text: true },
    { key: "pack", label: "Pack", text: true },
    { key: "family_label", label: "Family", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "revenue_growth_vs_prior_7_pct", label: "Rev Growth", format: pct },
    ],
    stateKey: "rawPack",
    filters: [{ key: "family_label", label: "Family" }],
    sortKey: "revenue",
    limitOptions: [10, 20, 30],
  });

  renderFilteredTable({
    controlsId: "dailyPackControls",
    tableId: "dailyPackTable",
    rows: m.daily_pack || [],
    columns: [
    { key: "day", label: "Date", text: true, format: shortDate },
    { key: "selection", label: "Selection", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    ],
    stateKey: "dailyPack",
    filters: [
      { key: "family_label", label: "Family" },
      { key: "day", label: "Date" },
    ],
    sortKey: "revenue",
    limitOptions: [10, 25, 50],
  });

  const configRows = m.config_funnel || [];
  const funnelTotals = configRows.reduce((acc, row) => {
    ["assigned_users", "followup_users", "paywall_shown_users", "trial_cta_users", "trial_buyers", "main_plan_buyers", "main_199_buyers", "main_499_buyers"].forEach((key) => {
      acc[key] = (acc[key] || 0) + Number(row[key] || 0);
    });
    return acc;
  }, {});
  const bestTrialConfig = [...configRows].sort((a, b) => Number(b.followup_to_trial_pct || 0) - Number(a.followup_to_trial_pct || 0))[0] || {};
  const bestMainConfig = [...configRows].sort((a, b) => Number(b.trial_to_main_pct || 0) - Number(a.trial_to_main_pct || 0))[0] || {};
  document.getElementById("monetizationFunnelSummary").innerHTML = [
    funnelStep("Assigned", number(funnelTotals.assigned_users), "Config 18 + 20 users"),
    funnelStep("Follow-up", number(funnelTotals.followup_users), `${pct(safePercent(funnelTotals.followup_users, funnelTotals.assigned_users))} of assigned`),
    funnelStep("Paywall", number(funnelTotals.paywall_shown_users), `${pct(safePercent(funnelTotals.paywall_shown_users, funnelTotals.followup_users))} of follow-up`),
    funnelStep("Trial Buyers", number(funnelTotals.trial_buyers), `${pct(safePercent(funnelTotals.trial_buyers, funnelTotals.followup_users))} of follow-up`),
    funnelStep("Main Buyers", number(funnelTotals.main_plan_buyers), `${pct(safePercent(funnelTotals.main_plan_buyers, funnelTotals.trial_buyers))} of trials`),
  ].join("");
  document.getElementById("monetizationFunnelCards").innerHTML = [
    actionCard("Best Trial Flow", bestTrialConfig.trial_type || "-", `${pct(bestTrialConfig.followup_to_trial_pct)} follow-up to trial`, "good"),
    actionCard("Best Main Conversion", bestMainConfig.trial_type || "-", `${pct(bestMainConfig.trial_to_main_pct)} trial to main`, "good"),
    actionCard("Main Pack Split", `${number(funnelTotals.main_499_buyers)} / ${number(funnelTotals.main_199_buyers)}`, "Rs 499 buyers / Rs 199 buyers", "neutral"),
  ].join("");

  chart("configFunnelRateChart", "bar", {
    labels: m.config_funnel.map((r) => r.trial_type),
    datasets: [
      { label: "Assigned to follow-up %", data: m.config_funnel.map((r) => r.assigned_to_followup_pct), backgroundColor: COLORS.blue },
      { label: "Follow-up to paywall %", data: m.config_funnel.map((r) => r.followup_to_paywall_pct), backgroundColor: COLORS.teal },
      { label: "Paywall to trial CTA %", data: m.config_funnel.map((r) => r.paywall_to_trial_cta_pct), backgroundColor: COLORS.gold },
      { label: "CTA to trial buy %", data: m.config_funnel.map((r) => r.trial_cta_to_trial_purchase_pct), backgroundColor: COLORS.rose },
      { label: "Trial to main %", data: m.config_funnel.map((r) => r.trial_to_main_pct), backgroundColor: COLORS.green },
    ],
  }, {
    plugins: { title: { display: true, text: "Config Funnel: Follow-up, Paywall, CTA, Purchase" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "#eef2f6" } } },
  });

  table("configFunnelTable", m.config_funnel, [
    { key: "config_id", label: "Config ID", text: true },
    { key: "trial_type", label: "Config", text: true },
    { key: "trial_amount", label: "Trial Amt", format: money },
    { key: "assigned_users", label: "Assigned", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "paywall_shown_users", label: "Paywall", format: number },
    { key: "trial_cta_users", label: "Trial CTA", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_plan_buyers", label: "Main Buyers", format: number },
    { key: "trial_cta_199_pack_users", label: "CTA Rs 199", format: number },
    { key: "trial_cta_499_pack_users", label: "CTA Rs 499", format: number },
    { key: "main_199_buyers", label: "Rs 199", format: number },
    { key: "main_499_buyers", label: "Rs 499", format: number },
    { key: "assigned_to_followup_pct", label: "Assigned to F", format: pct },
    { key: "followup_to_paywall_pct", label: "F to Paywall", format: pct },
    { key: "paywall_to_trial_cta_pct", label: "Paywall to CTA", format: pct },
    { key: "trial_cta_to_trial_purchase_pct", label: "CTA to Trial", format: pct },
    { key: "followup_to_trial_pct", label: "F to Trial", format: pct },
    { key: "trial_to_main_pct", label: "Trial to Main", format: pct },
    { key: "followup_to_main_pct", label: "F to Main", format: pct },
  ]);

  const entityRows = m.entity_distribution || [];
  chart("entityConversionChart", "bar", {
    labels: entityRows.slice(0, 10).map((r) => r.entity_label),
    datasets: [
      { label: "Conversion %", data: entityRows.slice(0, 10).map((r) => r.conversion_pct), backgroundColor: COLORS.teal },
      { label: "Revenue share %", data: entityRows.slice(0, 10).map((r) => r.revenue_share_pct), backgroundColor: COLORS.gold },
    ],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Bot / Entity Conversion and Revenue Share" } },
    scales: { x: { beginAtZero: true, grid: { color: "#eef2f6" } }, y: { grid: { display: false } } },
  });

  table("entityTable", m.entity_distribution, [
    { key: "entity_label", label: "Bot / Entity", text: true },
    { key: "entity_slug", label: "Entity Slug", text: true },
    { key: "followup_users", label: "Follow-up Users", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "conversion_pct", label: "Conv.", format: pct },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
    { key: "transactions", label: "Txns", format: number },
    { key: "revenue", label: "Revenue", format: money },
    { key: "subscription_revenue", label: "Sub Rev", format: money },
    { key: "subscription_payers", label: "Sub Payers", format: number },
    { key: "pay_as_you_go_revenue", label: "PayG Rev", format: money },
    { key: "pay_as_you_go_payers", label: "PayG Payers", format: number },
    { key: "day_pass_revenue", label: "Day Pass Rev", format: money },
    { key: "day_pass_payers", label: "Day Pass Payers", format: number },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
    { key: "revenue_per_followup_user", label: "Rev/FU", format: money },
  ], 20);
}

function renderAcquisition(data) {
  const a = data.acquisition;
  const aTrend = trendSection("acquisition");
  const chartLabel = trendWindowLabel();
  const paymentRows = a.payment_type_funnel || [];
  const paymentMetric = (familyId) => paymentRows.find((row) => row.family === familyId) || { payers: 0, revenue: 0, new_to_payment_pct: 0, followup_to_payment_pct: 0 };
  const subPayment = paymentMetric("subscription");
  const paygPayment = paymentMetric("pay_as_you_go");
  const dayPassPayment = paymentMetric("day_pass");
  document.getElementById("acquisitionNote").textContent = "New users are from SQL signups; Login Success is shown from Mixpanel for cross-check.";
  document.getElementById("acquisitionCards").innerHTML = [
    card("New Users", number(a.kpis.new_users), `${number(a.kpis.login_success_users)} Login Success users`),
    card("Follow-up Rate", pct(a.kpis.new_user_to_followup_pct), "New user to Follow up Query"),
    card("Payment Rate", pct(a.kpis.new_user_to_payment_pct), "New user to any payment"),
    card("Sub Payers", number(subPayment.payers), `${pct(subPayment.new_to_payment_pct)} of new users | ${money(subPayment.revenue)}`),
    card("PayG Payers", number(paygPayment.payers), `${pct(paygPayment.new_to_payment_pct)} of new users | ${money(paygPayment.revenue)}`),
    card("Day Pass Payers", number(dayPassPayment.payers), `${pct(dayPassPayment.new_to_payment_pct)} of new users | ${money(dayPassPayment.revenue)}`),
    card("Payment Users", number(a.funnel[2].users), `${pct(a.funnel[2].conversion_from_previous_pct)} from follow-up`),
  ].join("");

  const followupStage = a.funnel.find((row) => row.stage.toLowerCase().includes("follow")) || a.funnel[1] || {};
  const paymentStage = a.funnel.find((row) => row.stage.toLowerCase().includes("payment") || row.stage.toLowerCase().includes("payer")) || a.funnel[2] || {};
  document.getElementById("acquisitionFunnelStrip").innerHTML = [
    funnelStep("New Users", number(a.kpis.new_users), "SQL signups"),
    funnelStep("Follow-up", number(followupStage.users), `${pct(followupStage.conversion_from_start_pct)} of new users`),
    funnelStep("Paid", number(paymentStage.users), `${pct(paymentStage.conversion_from_start_pct)} of new users`),
    funnelStep("Revenue", money(paymentRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0)), "from new-user payments"),
  ].join("");

  const strongestPayment = topRows(paymentRows, "revenue", 1)[0] || {};
  const strongestSegment = topRows((a.segment_opportunities || []), "opportunity_score", 1)[0] || {};
  const followupToPayment = Number(paymentStage.conversion_from_previous_pct || 0);
  document.getElementById("acquisitionActionCards").innerHTML = [
    actionCard("Primary Bottleneck", `${pct(followupToPayment)}`, "Follow-up users converting to payment", followupToPayment < 10 ? "risk" : "neutral"),
    actionCard("Best Payment Stream", strongestPayment.family_label || "No payment", `${money(strongestPayment.revenue)} | ${number(strongestPayment.payers)} payers`, "good"),
    actionCard("Segment to Inspect", strongestSegment.selection || "No segment", `${number(Math.round(strongestSegment.opportunity_score || 0))} expected payers`, "neutral"),
  ].join("");

  chart("newUsersChart", "line", {
    labels: (aTrend.daily || a.daily).map((r) => shortDate(r.signup_date)),
    datasets: [
      { label: "New users", data: (aTrend.daily || a.daily).map((r) => r.new_users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Follow-up users", data: (aTrend.daily || a.daily).map((r) => r.followup_users), borderColor: COLORS.teal, tension: 0.25 },
      { label: "Payers", data: (aTrend.daily || a.daily).map((r) => r.payers), borderColor: COLORS.gold, tension: 0.25 },
    ],
  }, { plugins: { title: { display: true, text: `${chartLabel}: New User Daily Funnel` } } });

  chart("acquisitionRateChart", "line", {
    labels: (aTrend.daily || a.daily).map((r) => shortDate(r.signup_date)),
    datasets: [
      { label: "Follow-up rate %", data: (aTrend.daily || a.daily).map((r) => r.followup_rate_pct), borderColor: COLORS.teal, backgroundColor: "rgba(15,118,110,0.12)", tension: 0.25 },
      { label: "Payment rate %", data: (aTrend.daily || a.daily).map((r) => r.payer_rate_pct), borderColor: COLORS.gold, tension: 0.25 },
      { label: "Follow-up to payer %", data: (aTrend.daily || a.daily).map((r) => r.followup_to_payer_pct), borderColor: COLORS.rose, tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: Conversion Rate Trend` } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f6" } } },
  });

  chart("loginSignupChart", "line", {
    labels: (aTrend.login_vs_signup_daily || a.login_vs_signup_daily || []).map((r) => shortDate(r.signup_date)),
    datasets: [
      { label: "SQL new users", data: (aTrend.login_vs_signup_daily || a.login_vs_signup_daily || []).map((r) => r.new_users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Mixpanel login users", data: (aTrend.login_vs_signup_daily || a.login_vs_signup_daily || []).map((r) => r.login_success_users), borderColor: COLORS.slate, tension: 0.25 },
      { label: "Follow-up users", data: (aTrend.login_vs_signup_daily || a.login_vs_signup_daily || []).map((r) => r.followup_users), borderColor: COLORS.teal, tension: 0.25 },
      { label: "Payers", data: (aTrend.login_vs_signup_daily || a.login_vs_signup_daily || []).map((r) => r.payers), borderColor: COLORS.gold, tension: 0.25 },
    ],
  }, { plugins: { title: { display: true, text: `${chartLabel}: Signup, Login, Follow-up and Payment` } } });

  chart("acquisitionFunnelChart", "bar", {
    labels: a.funnel.map((r) => r.stage),
    datasets: [{ label: "Users", data: a.funnel.map((r) => r.users), backgroundColor: [COLORS.blue, COLORS.teal, COLORS.gold] }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "New Login to Follow-up to Payment" }, legend: { display: false } },
  });

  const acquisitionPaymentFamily = groupedLine(aTrend.daily_payment_family || a.daily_payment_family || [], "signup_date", "family", "revenue");
  acquisitionPaymentFamily.labels = acquisitionPaymentFamily.labels.map(shortDate);
  chart("acquisitionPaymentFamilyChart", "line", acquisitionPaymentFamily, {
    plugins: { title: { display: true, text: `${chartLabel}: New User Payment Revenue by Stream` } },
  });

  table("acquisitionDailyTable", a.daily, [
    { key: "signup_date", label: "Date", text: true, format: shortDate },
    { key: "new_users", label: "New Users", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "followup_rate_pct", label: "F Rate", format: pct },
    { key: "payer_rate_pct", label: "Pay Rate", format: pct },
    { key: "followup_to_payer_pct", label: "F to Pay", format: pct },
  ], 14);

  table("acquisitionFunnelTableDetail", a.funnel, [
    { key: "stage", label: "Stage", text: true },
    { key: "users", label: "Users", format: number },
    { key: "conversion_from_previous_pct", label: "Step Conv.", format: pct },
    { key: "conversion_from_start_pct", label: "Start Conv.", format: pct },
  ], 5);

  table("acquisitionPaymentFamilyTable", paymentRows, [
    { key: "selection", label: "Selection", text: true },
    { key: "family_label", label: "Payment Type", text: true },
    { key: "new_users", label: "New Users", format: number },
    { key: "followup_users", label: "Follow-up Users", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "followup_payers", label: "Follow-up Payers", format: number },
    { key: "new_to_payment_pct", label: "New to Pay", format: pct },
    { key: "followup_to_payment_pct", label: "Follow-up to Pay", format: pct },
    { key: "revenue", label: "Revenue", format: money },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
  ], 10);

  const acquisitionSegmentColumns = [
    { key: "selection", label: "Selection", text: true },
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "new_users", label: "New Users", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "followup_rate_pct", label: "Follow-up Rate", format: pct },
    { key: "payer_rate_pct", label: "Payer Rate", format: pct },
    { key: "followup_to_payer_pct", label: "F to Pay", format: pct },
  ];
  renderFilteredTable({
    controlsId: "acquisitionSegmentControls",
    tableId: "acquisitionSegmentTable",
    rows: a.segments,
    columns: acquisitionSegmentColumns,
    stateKey: "acquisitionSegment",
    filters: [{ key: "segment", label: "Segment" }],
    sortKey: "new_users",
  });

  const conversionSegments = topRows((a.segments || []).filter((row) => Number(row.new_users || 0) >= 50), "payer_rate_pct", 12);
  chart("acquisitionSegmentRateChart", "bar", {
    labels: conversionSegments.map((r) => r.selection),
    datasets: [
      { label: "Payer rate %", data: conversionSegments.map((r) => r.payer_rate_pct), backgroundColor: COLORS.gold },
      { label: "Follow-up rate %", data: conversionSegments.map((r) => r.followup_rate_pct), backgroundColor: COLORS.teal },
    ],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Best Segment Conversion Rates" } },
  });

  const volumeSegments = topRows(a.segments || [], "new_users", 12);
  chart("acquisitionSegmentVolumeChart", "bar", {
    labels: volumeSegments.map((r) => r.selection),
    datasets: [
      { label: "New users", data: volumeSegments.map((r) => r.new_users), backgroundColor: COLORS.blue },
      { label: "Follow-up", data: volumeSegments.map((r) => r.followup_users), backgroundColor: COLORS.teal },
      { label: "Payers", data: volumeSegments.map((r) => r.payers), backgroundColor: COLORS.gold },
    ],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Largest Acquisition Segments" } },
  });

  renderFilteredTable({
    controlsId: "segmentOpportunityControls",
    tableId: "segmentOpportunityTable",
    rows: a.segment_opportunities || [],
    columns: [
    { key: "selection", label: "Selection", text: true },
    { key: "new_users", label: "New Users", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "followup_rate_pct", label: "Follow-up Rate", format: pct },
    { key: "payer_rate_pct", label: "Payer Rate", format: pct },
    { key: "followup_to_payer_pct", label: "F to Pay", format: pct },
    { key: "opportunity_score", label: "Expected Payers", format: number },
    ],
    stateKey: "segmentOpportunity",
    filters: [{ key: "segment", label: "Segment" }],
    sortKey: "opportunity_score",
    limitOptions: [10, 20, 40],
  });

  const entityRows = a.followup_entity_events || [];
  const followupCohort = groupedLine(a.followup_daily_user_cohort || [], "date", "user_cohort", "followup_users");
  followupCohort.labels = followupCohort.labels.map(shortDate);
  chart("followupCohortChart", "line", followupCohort, {
    plugins: { title: { display: true, text: "Follow-up Query Users by New vs Old" } },
  });

  chart("followupEntityChart", "bar", {
    labels: entityRows.slice(0, 10).map((r) => r.entity_label || r.entity_slug),
    datasets: [{ label: "Follow-up Query events", data: entityRows.slice(0, 10).map((r) => r.followup_events), backgroundColor: COLORS.teal }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Follow-up Query by Bot / Entity" }, legend: { display: false } },
  });

  const demoRows = [];
  const demos = a.followup_demographics || {};
  for (const [segment, rows] of Object.entries(demos)) {
    rows.slice(0, segment === "city" || segment === "region" ? 8 : 6).forEach((row) => {
      demoRows.push({ segment, ...row });
    });
  }
  table("followupDemoTable", demoRows, [
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "users", label: "Users", format: number },
    { key: "pct", label: "%", format: pct },
  ], 30);

  renderFilteredTable({
    controlsId: "followupSegmentControls",
    tableId: "followupSegmentTable",
    rows: a.followup_segment_detail || [],
    columns: [
    { key: "selection", label: "Selection", text: true },
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "users", label: "Users", format: number },
    { key: "pct", label: "Share", format: pct },
    ],
    stateKey: "followupSegment",
    filters: [{ key: "segment", label: "Segment" }],
    sortKey: "users",
  });

  renderFilteredTable({
    controlsId: "followupEntityControls",
    tableId: "followupEntityTable",
    rows: entityRows,
    columns: [
    { key: "entity_label", label: "Bot / Entity", text: true },
    { key: "entity_slug", label: "Entity Slug", text: true },
    { key: "bot_id", label: "Bot ID", text: true },
    { key: "entity_match_type", label: "Match", text: true },
    { key: "followup_events", label: "Follow-up Events", format: number },
    ],
    stateKey: "followupEntity",
    filters: [{ key: "entity_match_type", label: "Match" }],
    sortKey: "followup_events",
    limitOptions: [10, 20, 25],
  });
}

function renderRetention(data) {
  const r = data.retention;
  document.getElementById("retentionNote").textContent = `Cohorts: ${r.cohort_window.start} to ${r.cohort_window.end}; retained means completed chat/call session on day N.`;

  chart("retentionCurveChart", "line", {
    labels: r.curve.map((x) => `D${x.day_n}`),
    datasets: [{
      label: "Retention %",
      data: r.curve.map((x) => x.retention_pct),
      borderColor: COLORS.teal,
      backgroundColor: "rgba(15,118,110,0.14)",
      fill: true,
      tension: 0.25,
    }],
  }, { plugins: { title: { display: true, text: "New User Retention Curve" } } });

  const platformRetention = groupedLine(r.platform || [], "day_n", "platform", "retention_pct");
  platformRetention.labels = platformRetention.labels.map((day) => `D${day}`);
  chart("retentionPlatformChart", "line", platformRetention, {
    plugins: { title: { display: true, text: "Retention Movement by Platform" } },
  });

  const d1Segments = topRows((r.segment_retention || []).filter((row) => Number(row.day_n) === 1), "cohort_users", 16);
  chart("retentionSegmentChart", "bar", {
    labels: d1Segments.map((row) => row.selection),
    datasets: [{ label: "D1 retention %", data: d1Segments.map((row) => row.retention_pct), backgroundColor: COLORS.teal }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "D1 Retention by Largest Segments" }, legend: { display: false } },
  });

  table("retentionCurveTable", r.curve, [
    { key: "day_n", label: "Day", text: true, format: (v) => `D${v}` },
    { key: "cohort_users", label: "Cohort", format: number },
    { key: "retained_users", label: "Retained", format: number },
    { key: "retention_pct", label: "Retention", format: pct },
  ], 10);

  table("retentionPlatformTable", r.platform, [
    { key: "platform", label: "Platform", text: true },
    { key: "day_n", label: "Day", text: true, format: (v) => `D${v}` },
    { key: "cohort_users", label: "Cohort", format: number },
    { key: "retained_users", label: "Retained", format: number },
    { key: "retention_pct", label: "Retention", format: pct },
  ], 30);

  renderRetentionSegmentTable(r.segment_retention || []);

  chart("botRepeatChart", "bar", {
    labels: r.bot.slice(0, 10).map((x) => x.bot_name),
    datasets: [{ label: "Repeat rate %", data: r.bot.slice(0, 10).map((x) => x.repeat_rate_pct), backgroundColor: COLORS.teal }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Top Bots by Repeat Usage" }, legend: { display: false } },
  });

  table("botTable", r.bot, [
    { key: "bot_name", label: "Bot", text: true },
    { key: "active_users", label: "Users", format: number },
    { key: "repeat_users_2plus_days", label: "Repeat Users", format: number },
    { key: "repeat_rate_pct", label: "Repeat Rate", format: pct },
    { key: "sessions", label: "Sessions", format: number },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 15);

  renderFilteredTable({
    controlsId: "botCohortControls",
    tableId: "botCohortTable",
    rows: r.bot_user_cohort || [],
    columns: [
    { key: "bot_name", label: "Bot", text: true },
    { key: "user_cohort", label: "User Type", text: true },
    { key: "active_users", label: "Users", format: number },
    { key: "repeat_users_2plus_days", label: "Repeat Users", format: number },
    { key: "repeat_rate_pct", label: "Repeat Rate", format: pct },
    { key: "sessions", label: "Sessions", format: number },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
    ],
    stateKey: "botCohort",
    filters: [{ key: "user_cohort", label: "User Type" }],
    sortKey: "active_users",
    limitOptions: [10, 20, 30],
  });

  renderBotSegmentTable(r.bot_segment || []);
}

function renderEngagement(data) {
  const e = data.engagement;
  const eTrend = trendSection("engagement");
  const chartLabel = trendWindowLabel();
  document.getElementById("engagementNote").textContent = "Average time uses Mixpanel $ae_session_length; BIM is campaign_name = Bot Initiated Messages.";
  document.getElementById("engagementCards").innerHTML = [
    card("Active Users", number(e.kpis.active_users), `${number(e.kpis.sessions)} app sessions`),
    card("Avg Time / User", `${e.kpis.avg_minutes_per_user}m`, `${e.kpis.avg_minutes_per_session}m per session`),
    card("Total Time", `${number(e.kpis.total_minutes)}m`, "Across app sessions"),
    card("BIM Opens", number(e.kpis.bim_notification_opens), `${number(e.kpis.bim_notification_users)} users`),
  ].join("");

  chart("engagementDailyChart", "line", {
    labels: (eTrend.session_daily || e.session_daily).map((r) => shortDate(r.date)),
    datasets: [
      { label: "Avg min/user", data: (eTrend.session_daily || e.session_daily).map((r) => r.avg_minutes_per_user), borderColor: COLORS.teal, tension: 0.25 },
      { label: "Sessions / user", data: (eTrend.session_daily || e.session_daily).map((r) => r.sessions_per_user), borderColor: COLORS.gold, tension: 0.25 },
    ],
  }, { plugins: { title: { display: true, text: `${chartLabel}: Engagement Depth` } } });

  const sessionCohort = groupedLine(eTrend.session_user_cohort_daily || e.session_user_cohort_daily || [], "date", "user_cohort", "sessions");
  sessionCohort.labels = sessionCohort.labels.map(shortDate);
  chart("sessionCohortChart", "line", sessionCohort, {
    plugins: { title: { display: true, text: `${chartLabel}: App Sessions by New vs Old Users` } },
  });

  chart("sessionIntensityChart", "doughnut", {
    labels: (e.session_intensity || []).map((r) => r.bucket),
    datasets: [{ data: (e.session_intensity || []).map((r) => r.users), backgroundColor: [COLORS.blue, COLORS.teal, COLORS.gold, COLORS.rose, COLORS.green] }],
  }, {
    plugins: { title: { display: true, text: "Session Intensity Distribution" }, legend: { position: "bottom" } },
  });

  table("sessionIntensityTable", e.session_intensity || [], [
    { key: "selection", label: "Selection", text: true },
    { key: "users", label: "Users", format: number },
    { key: "user_share_pct", label: "User Share", format: pct },
    { key: "sessions", label: "Sessions", format: number },
    { key: "total_minutes", label: "Total Min", format: number },
    { key: "avg_minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 10);

  table("sessionDailyTable", e.session_daily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "users", label: "Users", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "total_minutes", label: "Total Min", format: number },
    { key: "avg_minutes_per_user", label: "Avg Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 14);

  chart("bimDailyChart", "line", {
    labels: (eTrend.bim_daily || e.bim_daily).map((r) => shortDate(r.date)),
    datasets: [
      { label: "BIM opens", data: (eTrend.bim_daily || e.bim_daily).map((r) => r.opens), borderColor: COLORS.rose, tension: 0.25 },
      { label: "Users", data: (eTrend.bim_daily || e.bim_daily).map((r) => r.users), borderColor: COLORS.blue, tension: 0.25 },
    ],
  }, { plugins: { title: { display: true, text: `${chartLabel}: App Opened from Notification BIM` } } });

  chart("notificationTrendChart", "line", {
    labels: (eTrend.bim_daily || e.bim_daily).map((r) => shortDate(r.date)),
    datasets: [
      { label: "BIM opens", data: (eTrend.bim_daily || e.bim_daily).map((r) => r.opens), borderColor: COLORS.rose, backgroundColor: "rgba(190,52,85,0.12)", tension: 0.25 },
      { label: "BIM users", data: (eTrend.bim_daily || e.bim_daily).map((r) => r.users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Opens/user", data: (eTrend.bim_daily || e.bim_daily).map((r) => r.opens_per_user), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: BIM Notification Trend` } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Opens / users" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Opens per user" } },
    },
  });

  const bimCohort = groupedLine(eTrend.bim_user_cohort_daily || e.bim_user_cohort_daily || [], "date", "user_cohort", "opens");
  bimCohort.labels = bimCohort.labels.map(shortDate);
  chart("bimCohortChart", "line", bimCohort, {
    plugins: { title: { display: true, text: `${chartLabel}: BIM Opens by New vs Old Users` } },
  });

  table("sessionPlatformTable", e.session_by_platform, [
    { key: "platform", label: "Platform", text: true },
    { key: "users", label: "Users", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "avg_minutes_per_user", label: "Avg Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
  ]);

  renderFilteredTable({
    controlsId: "sessionSegmentControls",
    tableId: "sessionSegmentTable",
    rows: e.session_segments || [],
    columns: [
    { key: "selection", label: "Selection", text: true },
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "users", label: "Users", format: number },
    { key: "user_share_pct", label: "User Share", format: pct },
    { key: "sessions", label: "Sessions", format: number },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "avg_minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
    ],
    stateKey: "sessionSegment",
    filters: [{ key: "segment", label: "Segment" }],
    sortKey: "users",
  });

  table("campaignTable", e.notification_campaigns, [
    { key: "campaign", label: "Campaign", text: true },
    { key: "opens", label: "Opens", format: number },
    { key: "open_share_pct", label: "Open Share", format: pct },
    { key: "users", label: "Users", format: number },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ]);

  table("bimPlatformTable", e.bim_by_platform || [], [
    { key: "platform", label: "Platform", text: true },
    { key: "opens", label: "Opens", format: number },
    { key: "open_share_pct", label: "Open Share", format: pct },
    { key: "users", label: "Users", format: number },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 10);

  table("bimDailyTable", e.bim_daily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "opens", label: "Opens", format: number },
    { key: "users", label: "Users", format: number },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 14);

  table("bimCohortTable", e.bim_user_cohort_daily || [], [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "user_cohort", label: "User Type", text: true },
    { key: "opens", label: "Opens", format: number },
    { key: "users", label: "Users", format: number },
    { key: "share_pct", label: "Open Share", format: pct },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 30);
}

function renderMetricCoverage(data) {
  const coverage = data.metric_coverage || { rows: [], summary: [] };
  const rows = coverage.rows || [];
  const summary = coverage.summary || [];
  const getStatusCount = (status) => summary.find((row) => row.status === status)?.metrics || 0;
  const partialRows = rows.filter((row) => row.status !== "Available");
  const avgCoverage = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.coverage_pct || 0), 0) / rows.length
    : 0;

  document.getElementById("metricCoverageCards").innerHTML = [
    card("Available Metrics", number(getStatusCount("Available")), "Fully calculable from current sources"),
    card("Partial Metrics", number(getStatusCount("Partial")), "Usable but with source/data gaps"),
    card("Missing Metrics", number(getStatusCount("Missing source") + getStatusCount("Missing denominator")), "Need one more source or denominator"),
    card("Avg Coverage", pct(avgCoverage), "Across tracked metric families"),
  ].join("");

  chart("metricCoverageChart", "bar", {
    labels: summary.map((row) => row.status),
    datasets: [{ label: "Metric count", data: summary.map((row) => row.metrics), backgroundColor: summary.map((row) => {
      if (row.status === "Available") return COLORS.green;
      if (row.status === "Partial") return COLORS.gold;
      return COLORS.rose;
    }) }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Metric Coverage Status" }, legend: { display: false } },
    scales: { x: { beginAtZero: true, grid: { color: "#eef2f6" } }, y: { grid: { display: false } } },
  });

  table("metricCoverageTable", partialRows.length ? partialRows : rows, [
    { key: "area", label: "Area", text: true },
    { key: "metric", label: "Metric", text: true },
    { key: "status", label: "Status", text: true },
    { key: "coverage_pct", label: "Coverage", format: pct },
    { key: "missing_detail", label: "Missing Detail", text: true },
    { key: "next_data_needed", label: "Next Data Needed", text: true },
  ], 20);
}

async function main() {
  try {
    const response = await fetch(`data/dashboard_data.json?ts=${Date.now()}`, { cache: "no-store" });
    DASHBOARD_DATA = hideUnknownRows(await response.json());
    SELECTED_PERIOD = DASHBOARD_DATA.metadata.default_period || "weekly";
    setupPeriodControls();
    setupDayDownloadControls();
    setupTabs();
    setupSectionNav();
    renderDashboard();
    window.setTimeout(scrollToCurrentSection, 120);
  } catch (error) {
    document.getElementById("freshness").textContent = "Could not load dashboard data.";
    document.body.insertAdjacentHTML("afterbegin", `<div class="panel" style="margin:16px">Data load failed: ${error.message}</div>`);
  }
}

function selectedData() {
  return DASHBOARD_DATA.periods?.[SELECTED_PERIOD] || DASHBOARD_DATA;
}

function setupPeriodControls() {
  const controls = document.getElementById("periodControls");
  controls.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === SELECTED_PERIOD);
    button.addEventListener("click", () => {
      SELECTED_PERIOD = button.dataset.period;
      controls.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.period === SELECTED_PERIOD));
      renderDashboard();
    });
  });
}

function setupTabs() {
  document.querySelectorAll(".section-tabs").forEach((group) => {
    group.querySelectorAll("button[data-tab-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.tabTarget;
        group.querySelectorAll("button").forEach((tabButton) => {
          tabButton.classList.toggle("active", tabButton === button);
        });
        document.querySelectorAll(`#${targetId}, .tab-panel`).forEach((panel) => {
          if (!panel.id) return;
          const inSameSection = panel.closest(".band") === group.closest(".band");
          if (inSameSection) {
            panel.classList.toggle("active", panel.id === targetId);
          }
        });
        renderDashboard();
        const resizeVisibleCharts = () => {
          Object.values(CHARTS).forEach((chartInstance) => {
            chartInstance.resize();
            chartInstance.update("none");
          });
        };
        window.requestAnimationFrame(() => {
          resizeVisibleCharts();
          window.setTimeout(resizeVisibleCharts, 120);
        });
      });
    });
  });
}

function setupSectionNav() {
  const links = [...document.querySelectorAll(".section-nav a")];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const setActive = () => {
    const current = sections
      .filter((section) => section.getBoundingClientRect().top <= 120)
      .pop() || sections[0];
    links.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${current.id}`);
    });
  };

  links.forEach((link) => {
    link.addEventListener("click", () => {
      window.setTimeout(setActive, 80);
    });
  });
  window.addEventListener("scroll", setActive, { passive: true });
  window.addEventListener("hashchange", () => {
    window.setTimeout(scrollToCurrentSection, 40);
    window.setTimeout(setActive, 90);
  });
  setActive();
}

function scrollToCurrentSection() {
  if (!window.location.hash) return;
  const section = document.querySelector(window.location.hash);
  if (!section) return;
  section.scrollIntoView({ block: "start" });
  document.querySelectorAll(".section-nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === window.location.hash);
  });
}

function renderDataPolicy(meta) {
  const policy = meta.data_retention_policy || {};
  const policyRows = [
    ["Storage", policy.storage || "Latest aggregate JSON only"],
    ["Refresh", policy.refresh_behavior || "Each refresh replaces the previous dashboard data file"],
    ["Raw Data", policy.raw_data || "Raw SQL rows and Mixpanel events are not saved in the dashboard repo"],
  ];
  document.getElementById("dataPolicy").innerHTML = policyRows
    .map(([label, value]) => `
      <div class="policy-item">
        <div class="policy-label">${escapeHtml(label)}</div>
        <div class="policy-value">${escapeHtml(value)}</div>
      </div>
    `)
    .join("");
}

function renderDashboard() {
  const data = selectedData();
  const rootMeta = DASHBOARD_DATA.metadata;
  const meta = data.metadata || rootMeta;
  document.getElementById("freshness").textContent = `Generated ${new Date(rootMeta.generated_at_ist).toLocaleString("en-IN")} IST | ${SELECTED_PERIOD.toUpperCase()} ${meta.current_window.start} to ${meta.current_window.end}`;
  renderOverview(data);
  renderMonetization(data);
  renderAcquisition(data);
  renderRetention(data);
  renderEngagement(data);
  renderMetricCoverage(data);
  renderDataPolicy(rootMeta);
  document.getElementById("sourceNotes").innerHTML = rootMeta.source_notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

main();
