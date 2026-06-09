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

function money(value) {
  return INR.format(Number(value || 0));
}

function number(value) {
  return NUM.format(Number(value || 0));
}

function pct(value) {
  if (value === null || value === undefined) return "n/a";
  return `${Number(value).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
      label: family.replaceAll("_", " "),
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
  const a = data.acquisition.kpis;
  const r = data.retention.curve.find((x) => x.day_n === 1);
  const e = data.engagement.kpis;
  const comparison = data.metadata?.comparison_window?.label || "previous period";
  document.getElementById("overviewCards").innerHTML = [
    card("Revenue", money(m.revenue), `vs ${comparison} ${trend(g7.revenue)}`),
    card("Payers", number(m.payers), `vs ${comparison} ${trend(g7.payers)}`),
    card("Avg Transaction", money(m.avg_transaction), `vs ${comparison} ${trend(g7.avg_transaction)}`),
    card("New Users", number(a.new_users), `${pct(a.new_user_to_followup_pct)} reached follow-up`),
    card("D1 Chat Retention", pct(r?.retention_pct || 0), `${number(r?.retained_users || 0)} retained users`),
    card("Avg Time / User", `${e.avg_minutes_per_user}m`, `${number(e.sessions)} app sessions`),
    card("BIM Opens", number(e.bim_notification_opens), `${number(e.bim_notification_users)} users`),
  ].join("");
}

function renderMonetization(data) {
  const meta = data.metadata;
  const m = data.monetization;
  const k = m.kpis.current;
  const g7 = m.kpis.growth_vs_prior_7;
  const g30 = m.kpis.growth_vs_prior_30_7day_baseline;
  const comparison = meta.comparison_window || meta.prior_7_window;
  document.getElementById("monetizationNote").textContent = `${meta.current_window.start} to ${meta.current_window.end}; growth vs ${comparison.start} to ${comparison.end}.`;
  document.getElementById("monetizationCards").innerHTML = [
    card("Revenue", money(k.revenue), `${comparison.label || "previous period"} ${trend(g7.revenue)} | 30-day baseline ${trend(g30.revenue)}`),
    card("Payers", number(k.payers), `${comparison.label || "previous period"} ${trend(g7.payers)} | 30-day baseline ${trend(g30.payers)}`),
    card("Transactions", number(k.transactions), `${comparison.label || "previous period"} ${trend(g7.transactions)} | 30-day baseline ${trend(g30.transactions)}`),
    card("Avg Transaction", money(k.avg_transaction), `${comparison.label || "previous period"} ${trend(g7.avg_transaction)} | 30-day avg ${trend(g30.avg_transaction)}`),
  ].join("");

  const daily = groupedDaily(m.daily);
  daily.labels = daily.labels.map(shortDate);
  chart("revenueDailyChart", "bar", daily, {
    plugins: { title: { display: true, text: "Daily Revenue by Family" }, legend: { position: "bottom" } },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
  });

  const dailySummary = m.daily_summary || [];
  chart("revenueRateChart", "line", {
    labels: dailySummary.map((r) => shortDate(r.day)),
    datasets: [
      { label: "Revenue", data: dailySummary.map((r) => r.revenue), borderColor: COLORS.blue, backgroundColor: "rgba(37,99,235,0.12)", yAxisID: "y", tension: 0.25 },
      { label: "Payers", data: dailySummary.map((r) => r.payers), borderColor: COLORS.teal, yAxisID: "y1", tension: 0.25 },
      { label: "Avg txn", data: dailySummary.map((r) => r.avg_transaction), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Revenue, Payers and Avg Transaction Trend" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Revenue" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Payers / Avg txn" } },
    },
  });

  chart("revenueFamilyChart", "doughnut", {
    labels: m.family.map((r) => r.family.replaceAll("_", " ")),
    datasets: [{ data: m.family.map((r) => r.revenue), backgroundColor: [COLORS.subscription, COLORS.pay_as_you_go, COLORS.day_pass] }],
  }, {
    plugins: { title: { display: true, text: "Revenue Mix" }, legend: { position: "bottom" } },
  });

  table("revenueDailyTable", m.daily, [
    { key: "day", label: "Date", text: true, format: shortDate },
    { key: "family", label: "Family", text: true, format: (v) => String(v).replaceAll("_", " ") },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Day Share", format: pct },
  ], 30);

  table("revenueFamilyTable", m.family, [
    { key: "family", label: "Family", text: true, format: (v) => String(v).replaceAll("_", " ") },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
  ], 10);

  table("packTable", m.pack, [
    { key: "pack", label: "Pack", text: true },
    { key: "family", label: "Family", text: true, format: (v) => String(v).replaceAll("_", " ") },
    { key: "plan_code", label: "Plan", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "revenue", label: "Revenue", format: money },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
    { key: "revenue_share_pct", label: "Revenue Share", format: pct },
  ], 30);

  chart("configFunnelRateChart", "bar", {
    labels: m.config_funnel.map((r) => r.trial_type),
    datasets: [
      { label: "Assigned to follow-up %", data: m.config_funnel.map((r) => r.assigned_to_followup_pct), backgroundColor: COLORS.blue },
      { label: "Follow-up to trial %", data: m.config_funnel.map((r) => r.followup_to_trial_pct), backgroundColor: COLORS.teal },
      { label: "Trial to main %", data: m.config_funnel.map((r) => r.trial_to_main_pct), backgroundColor: COLORS.gold },
      { label: "Follow-up to main %", data: m.config_funnel.map((r) => r.followup_to_main_pct), backgroundColor: COLORS.rose },
    ],
  }, {
    plugins: { title: { display: true, text: "Config Funnel Percentage Comparison" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "#eef2f6" } } },
  });

  table("configFunnelTable", m.config_funnel, [
    { key: "trial_type", label: "Config", text: true },
    { key: "assigned_users", label: "Assigned", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_plan_buyers", label: "Main Buyers", format: number },
    { key: "main_199_buyers", label: "Rs 199", format: number },
    { key: "main_499_buyers", label: "Rs 499", format: number },
    { key: "assigned_to_followup_pct", label: "Assigned to F", format: pct },
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
    { key: "avg_revenue_per_payer", label: "ARPP", format: money },
    { key: "revenue_per_followup_user", label: "Rev/FU", format: money },
  ], 20);
}

function renderAcquisition(data) {
  const a = data.acquisition;
  document.getElementById("acquisitionNote").textContent = "New users are from SQL signups; Login Success is shown from Mixpanel for cross-check.";
  document.getElementById("acquisitionCards").innerHTML = [
    card("New Users", number(a.kpis.new_users), `${number(a.kpis.login_success_users)} Login Success users`),
    card("Follow-up Rate", pct(a.kpis.new_user_to_followup_pct), "New user to Follow up Query"),
    card("Payment Rate", pct(a.kpis.new_user_to_payment_pct), "New user to any payment"),
    card("Payment Users", number(a.funnel[2].users), `${pct(a.funnel[2].conversion_from_previous_pct)} from follow-up`),
  ].join("");

  chart("newUsersChart", "bar", {
    labels: a.daily.map((r) => shortDate(r.signup_date)),
    datasets: [
      { label: "New users", data: a.daily.map((r) => r.new_users), backgroundColor: COLORS.blue },
      { label: "Follow-up users", data: a.daily.map((r) => r.followup_users), backgroundColor: COLORS.teal },
      { label: "Payers", data: a.daily.map((r) => r.payers), backgroundColor: COLORS.gold },
    ],
  }, { plugins: { title: { display: true, text: "New User Daily Funnel" } } });

  chart("acquisitionRateChart", "line", {
    labels: a.daily.map((r) => shortDate(r.signup_date)),
    datasets: [
      { label: "Follow-up rate %", data: a.daily.map((r) => r.followup_rate_pct), borderColor: COLORS.teal, backgroundColor: "rgba(15,118,110,0.12)", tension: 0.25 },
      { label: "Payment rate %", data: a.daily.map((r) => r.payer_rate_pct), borderColor: COLORS.gold, tension: 0.25 },
      { label: "Follow-up to payer %", data: a.daily.map((r) => r.followup_to_payer_pct), borderColor: COLORS.rose, tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Daily Conversion Rate Trend" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#eef2f6" } } },
  });

  chart("acquisitionFunnelChart", "bar", {
    labels: a.funnel.map((r) => r.stage),
    datasets: [{ label: "Users", data: a.funnel.map((r) => r.users), backgroundColor: [COLORS.blue, COLORS.teal, COLORS.gold] }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "New Login to Follow-up to Payment" }, legend: { display: false } },
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

  table("acquisitionSegmentTable", a.segments, [
    { key: "segment", label: "Segment", text: true },
    { key: "bucket", label: "Bucket", text: true },
    { key: "new_users", label: "New Users", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "payers", label: "Payers", format: number },
    { key: "followup_rate_pct", label: "Follow-up Rate", format: pct },
    { key: "payer_rate_pct", label: "Payer Rate", format: pct },
    { key: "followup_to_payer_pct", label: "F to Pay", format: pct },
  ], 30);

  const entityRows = a.followup_entity_events || [];
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

  table("followupEntityTable", entityRows, [
    { key: "entity_label", label: "Bot / Entity", text: true },
    { key: "entity_slug", label: "Entity Slug", text: true },
    { key: "bot_id", label: "Bot ID", text: true },
    { key: "entity_match_type", label: "Match", text: true },
    { key: "followup_events", label: "Follow-up Events", format: number },
  ], 25);
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

  const platforms = [...new Set(r.platform.map((x) => x.platform))];
  chart("retentionPlatformChart", "bar", {
    labels: platforms,
    datasets: [1, 3, 7].map((day, idx) => ({
      label: `D${day}`,
      data: platforms.map((platform) => r.platform.find((x) => x.platform === platform && x.day_n === day)?.retention_pct || 0),
      backgroundColor: [COLORS.blue, COLORS.teal, COLORS.gold][idx],
    })),
  }, { plugins: { title: { display: true, text: "Retention by Platform" } } });

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
}

function renderEngagement(data) {
  const e = data.engagement;
  document.getElementById("engagementNote").textContent = "Average time uses Mixpanel $ae_session_length; BIM is campaign_name = Bot Initiated Messages.";
  document.getElementById("engagementCards").innerHTML = [
    card("Active Users", number(e.kpis.active_users), `${number(e.kpis.sessions)} app sessions`),
    card("Avg Time / User", `${e.kpis.avg_minutes_per_user}m`, `${e.kpis.avg_minutes_per_session}m per session`),
    card("Total Time", `${number(e.kpis.total_minutes)}m`, "Across app sessions"),
    card("BIM Opens", number(e.kpis.bim_notification_opens), `${number(e.kpis.bim_notification_users)} users`),
  ].join("");

  chart("engagementDailyChart", "line", {
    labels: e.session_daily.map((r) => shortDate(r.date)),
    datasets: [
      { label: "Avg min/user", data: e.session_daily.map((r) => r.avg_minutes_per_user), borderColor: COLORS.teal, tension: 0.25 },
      { label: "Sessions / user", data: e.session_daily.map((r) => r.sessions_per_user), borderColor: COLORS.gold, tension: 0.25 },
    ],
  }, { plugins: { title: { display: true, text: "Daily Engagement Depth" } } });

  table("sessionDailyTable", e.session_daily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "users", label: "Users", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "total_minutes", label: "Total Min", format: number },
    { key: "avg_minutes_per_user", label: "Avg Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 14);

  chart("bimDailyChart", "bar", {
    labels: e.bim_daily.map((r) => shortDate(r.date)),
    datasets: [
      { label: "BIM opens", data: e.bim_daily.map((r) => r.opens), backgroundColor: COLORS.rose },
      { label: "Users", data: e.bim_daily.map((r) => r.users), backgroundColor: COLORS.blue },
    ],
  }, { plugins: { title: { display: true, text: "App Opened from Notification: BIM" } } });

  chart("notificationTrendChart", "line", {
    labels: e.bim_daily.map((r) => shortDate(r.date)),
    datasets: [
      { label: "BIM opens", data: e.bim_daily.map((r) => r.opens), borderColor: COLORS.rose, backgroundColor: "rgba(190,52,85,0.12)", tension: 0.25 },
      { label: "BIM users", data: e.bim_daily.map((r) => r.users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Opens/user", data: e.bim_daily.map((r) => r.opens_per_user), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "BIM Notification Trend" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#eef2f6" }, title: { display: true, text: "Opens / users" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Opens per user" } },
    },
  });

  table("sessionPlatformTable", e.session_by_platform, [
    { key: "platform", label: "Platform", text: true },
    { key: "users", label: "Users", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "avg_minutes_per_user", label: "Avg Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
  ]);

  table("campaignTable", e.notification_campaigns, [
    { key: "campaign", label: "Campaign", text: true },
    { key: "opens", label: "Opens", format: number },
    { key: "users", label: "Users", format: number },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ]);

  table("bimDailyTable", e.bim_daily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "opens", label: "Opens", format: number },
    { key: "users", label: "Users", format: number },
    { key: "opens_per_user", label: "Opens/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 14);
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
    const response = await fetch("data/dashboard_data.json");
    DASHBOARD_DATA = await response.json();
    SELECTED_PERIOD = DASHBOARD_DATA.metadata.default_period || "weekly";
    setupPeriodControls();
    setupTabs();
    renderDashboard();
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
        window.requestAnimationFrame(() => {
          Object.values(CHARTS).forEach((chartInstance) => chartInstance.resize());
        });
      });
    });
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
