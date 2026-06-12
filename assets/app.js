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

function applyTheme(theme = THEME) {
  THEME = theme === "day" ? "day" : "night";
  document.body.dataset.theme = THEME;
  localStorage.setItem("hiastro-dashboard-theme", THEME);
  Chart.defaults.color = THEME === "day" ? "#475569" : "#cbd5e1";
  Chart.defaults.plugins.tooltip.backgroundColor = THEME === "day" ? "#0f172a" : "#020617";
  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.textContent = THEME === "day" ? "Day" : "Night";
    toggle.setAttribute("aria-label", `Switch to ${THEME === "day" ? "night" : "day"} mode`);
  }
  Object.values(CHARTS).forEach((chartInstance) => {
    chartInstance.update("none");
  });
}

function setupThemeToggle() {
  applyTheme(THEME);
  const toggle = document.getElementById("themeToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    applyTheme(THEME === "day" ? "night" : "day");
    if (DASHBOARD_DATA) {
      renderDashboard();
      resizeVisibleCharts();
    }
  });
}

const CHARTS = {};
const API_BASE_URL = String(window.HIASTRO_DASHBOARD_API_BASE_URL || "").replace(/\/$/, "");
const SECTION_IDS = ["monetization", "acquisition", "marketing", "retention", "engagement", "coverage"];
let DASHBOARD_DATA = null;
let SELECTED_PERIOD = "weekly";
let SELECTED_DAY = null;
let DATE_STATUS_MESSAGE = "";
let LIVE_API_STATUS = null;
let ACTIVE_SECTION = "monetization";
let THEME = localStorage.getItem("hiastro-dashboard-theme") || "night";
let MARKETING_UPLOAD_STATE = null;
const MARKETING_UPLOAD_STORAGE_KEY = "hiastro-marketing-upload-v1";
const MARKETING_TEMPLATE_COLUMNS = [
  "Date",
  "Platform",
  "Campaign Type",
  "Campaign ID",
  "Campaign Name",
  "Spend",
  "Marketing spends - subs",
  "Installs",
  "Impressions",
  "Clicks",
  "New Logins",
  "Trials",
  "Subscribers",
  "Revenue",
];
const MARKETING_COLUMN_CANDIDATES = {
  date: ["date", "day", "dt", "metric_date", "campaign_date"],
  platform: ["platform", "os", "acquisition_device", "source_platform", "channel"],
  campaign_type: ["campaign_type", "campaign_category", "type", "objective"],
  campaign_id: ["campaign_id", "campaignid", "ad_campaign_id", "id"],
  campaign: ["campaign", "campaign_name", "campaigns", "name"],
  spend: ["spend", "cost", "amount_spent", "marketing_spend", "marketing_spends", "total_spend"],
  subscription_spend: ["marketing_spends_subs", "marketing_spend_subs", "subscription_marketing_spend", "subscription_spend", "sub_spend"],
  installs: ["installs", "install", "app_installs", "ps_installs", "as_installs"],
  impressions: ["impressions", "impression", "views"],
  clicks: ["clicks", "click", "link_clicks", "taps"],
  monetization_config_sub_pct: ["monetization_config_id_sub", "pct_monetization_config_id_sub", "monetization_config_sub_pct"],
  subscription_new_logins: ["subscription_new_logins", "sub_new_logins"],
  new_logins: ["new_logins", "logins", "login", "new_users"],
  trials: ["trials", "trial_starts", "successful_trials", "trial_purchases"],
  trials_1: ["trials_re_1", "trials_1_re", "trials_rs_1", "trials_1_rs"],
  trials_49: ["trials_re_49", "trials_49_re", "trials_rs_49", "trials_49_rs"],
  subscribers: ["paid_subs", "subscribers", "new_paid_subscribers", "subscriptions", "paid_subscribers"],
  paid_subs_199: ["paid_subs_199", "paid_subscribers_199", "subs_199"],
  paid_subs_499: ["paid_subs_499", "paid_subscribers_499", "subs_499"],
  paid_upgrades_300: ["paid_upgrades_300", "upgrades_300"],
  revenue: ["revenue", "subscription_revenue", "sub_revenue", "gross_revenue", "total_revenue"],
  trial_revenue: ["trial_revenue"],
  sub_revenue: ["sub_revenue", "subscription_revenue"],
  dau: ["dau"],
  subscriber_dau: ["subscriber_dau"],
  all_d1_retention: ["all_d1_retention", "d1_retention", "all_d1"],
  all_d3_retention: ["all_d3_retention", "d3_retention", "all_d3"],
  all_d7_retention: ["all_d7_retention", "d7_retention", "all_d7"],
  sub_d1_retention: ["sub_d1_retention", "subscriber_d1_retention", "sub_d1"],
  sub_d3_retention: ["sub_d3_retention", "subscriber_d3_retention", "sub_d3"],
  sub_d7_retention: ["sub_d7_retention", "subscriber_d7_retention", "sub_d7"],
  arpu_subs: ["arpu_per_subs", "arpu_subs", "arpu"],
  arpu_subs_excl_trials: ["arpu_per_subs_excl_trials", "arpu_subs_excl_trials", "arpu_excl_trials"],
  mix_499: ["499_mix", "rs_499_mix", "paid_499_mix"],
  reported_trial_cac: ["trial_cac"],
  reported_subscriber_cac: ["subscriber_cac", "sub_cac"],
};
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

function safeRatioValue(num, den) {
  return den ? Number(num || 0) / Number(den || 0) : null;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).trim().replace(/[₹$,]/g, "").replace(/%$/, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function firstColumn(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || null;
}

function marketingHeaderScore(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const allCandidates = new Set(Object.values(MARKETING_COLUMN_CANDIDATES).flat());
  const matched = normalizedHeaders.filter((header) => allCandidates.has(header)).length;
  const hasDate = normalizedHeaders.some((header) => MARKETING_COLUMN_CANDIDATES.date.includes(header));
  const hasSpend = normalizedHeaders.some((header) => (
    MARKETING_COLUMN_CANDIDATES.spend.includes(header)
    || MARKETING_COLUMN_CANDIDATES.subscription_spend.includes(header)
  ));
  return matched + (hasDate ? 8 : 0) + (hasSpend ? 5 : 0);
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const counts = {
    "\t": (sample.match(/\t/g) || []).length,
    ",": (sample.match(/,/g) || []).length,
    ";": (sample.match(/;/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headerIndex = rows.reduce((bestIndex, candidateRow, index) => (
    marketingHeaderScore(candidateRow) > marketingHeaderScore(rows[bestIndex] || []) ? index : bestIndex
  ), 0);
  const headers = rows[headerIndex].map(normalizeHeader);
  return rows.slice(headerIndex + 1).map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      if (header) out[header] = values[index] ?? "";
    });
    return out;
  });
}

function loadMarketingUploadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(MARKETING_UPLOAD_STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.rows) || !saved.rows.length) return null;
    return {
      fileName: saved.fileName || "saved-marketing.csv",
      rows: saved.rows,
      loadedAt: saved.loadedAt || null,
    };
  } catch {
    return null;
  }
}

function saveMarketingUploadState(state) {
  try {
    localStorage.setItem(MARKETING_UPLOAD_STORAGE_KEY, JSON.stringify({
      fileName: state.fileName,
      rows: state.rows,
      loadedAt: state.loadedAt,
    }));
    return true;
  } catch {
    return false;
  }
}

function clearMarketingUploadState() {
  try {
    localStorage.removeItem(MARKETING_UPLOAD_STORAGE_KEY);
  } catch {
    // The in-memory upload can still be cleared even if browser storage fails.
  }
}

function datesBetween(start, end) {
  if (!start || !end) return [];
  const dates = [];
  const current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function marketingDateValue(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function marketingUploadCoverage(state) {
  const rows = state?.rows || [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const dateColumn = firstColumn(columns, MARKETING_COLUMN_CANDIDATES.date);
  if (!dateColumn) return { dateColumn: null, minDate: null, maxDate: null, rowCount: rows.length };
  const dates = rows
    .map((row) => marketingDateValue(row[dateColumn]))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return {
    dateColumn,
    minDate: dates[0] || null,
    maxDate: dates[dates.length - 1] || null,
    rowCount: rows.length,
  };
}

function marketingUploadFreshness(data, state = MARKETING_UPLOAD_STATE) {
  if (!state) return { status: "missing" };
  const coverage = marketingUploadCoverage(state);
  const selectedDays = selectedDateRange(data).filter(Boolean).sort();
  const selectedMax = selectedDays[selectedDays.length - 1] || null;
  const selectedMin = selectedDays[0] || null;
  const stale = Boolean(coverage.maxDate && selectedMax && selectedMax > coverage.maxDate);
  const beforeCoverage = Boolean(coverage.minDate && selectedMin && selectedMin < coverage.minDate);
  return {
    ...coverage,
    selectedMin,
    selectedMax,
    stale,
    beforeCoverage,
    status: stale ? "stale" : (beforeCoverage ? "partial" : "current"),
  };
}

function selectedDateRange(data) {
  const meta = data.metadata || {};
  const window = meta.current_window || DASHBOARD_DATA?.metadata?.current_window || {};
  if (SELECTED_PERIOD === "daily" && SELECTED_DAY) return [SELECTED_DAY];
  if (window.start && window.end) return datesBetween(window.start, window.end);
  return dashboardDateOptions();
}

function dashboardDailyMarketingTotals(data) {
  const days = selectedDateRange(data);
  const out = Object.fromEntries(days.map((day) => [day, {
    date: day,
    revenue: 0,
    trials: 0,
    subscribers: 0,
    new_logins: 0,
  }]));
  (data.monetization?.daily || []).forEach((row) => {
    if (!out[row.day]) return;
    out[row.day].revenue += Number(row.revenue || 0);
  });
  (data.monetization?.daily_pack_merged || data.monetization?.daily_pack || []).forEach((row) => {
    if (!out[row.day] || row.family !== "subscription") return;
    const pack = String(row.pack || "").toLowerCase();
    if (pack.includes("trial")) out[row.day].trials += Number(row.payers || row.transactions || 0);
    if (pack.includes("main")) out[row.day].subscribers += Number(row.payers || row.transactions || 0);
  });
  (data.acquisition?.daily || []).forEach((row) => {
    const day = row.signup_date || row.date || row.day;
    if (!out[day]) return;
    out[day].new_logins += Number(row.new_users || row.logins || 0);
  });
  return out;
}

function marketingSpendBase(row) {
  return Number(row.subscription_spend || 0) > 0 ? Number(row.subscription_spend || 0) : Number(row.spend || 0);
}

function addMarketingRates(rows) {
  return (rows || []).map((row) => {
    const out = { ...row };
    const spendBase = marketingSpendBase(out);
    out.ctr_pct = safePercent(out.clicks, out.impressions);
    out.cpc = safeRatioValue(out.spend, out.clicks);
    out.cpm = safeRatioValue(out.spend * 1000, out.impressions);
    out.cpi = safeRatioValue(out.spend, out.installs);
    out.cost_per_trial = safeRatioValue(spendBase, out.trials);
    out.subscriber_cac = safeRatioValue(spendBase, out.subscribers);
    out.login_to_trial_pct = safePercent(out.trials, out.new_logins);
    out.install_to_trial_pct = safePercent(out.trials, out.installs);
    out.roas_pct = safePercent(out.revenue, out.spend);
    return out;
  });
}

function sumRows(rows, groupKeys, valueKeys) {
  const grouped = {};
  (rows || []).forEach((row) => {
    const key = groupKeys.map((groupKey) => row[groupKey] || "Unattributed").join("||");
    if (!grouped[key]) {
      grouped[key] = Object.fromEntries(groupKeys.map((groupKey) => [groupKey, row[groupKey] || "Unattributed"]));
      valueKeys.forEach((valueKey) => { grouped[key][valueKey] = 0; });
    }
    valueKeys.forEach((valueKey) => {
      grouped[key][valueKey] += Number(row[valueKey] || 0);
    });
  });
  return Object.values(grouped);
}

function buildMarketingFromRows(rows, data) {
  const normalizedRows = rows || [];
  const columns = [...new Set(normalizedRows.flatMap((row) => Object.keys(row)))];
  const mapping = Object.fromEntries(
    Object.entries(MARKETING_COLUMN_CANDIDATES).map(([key, candidates]) => [key, firstColumn(columns, candidates)]),
  );
  if (!mapping.date) {
    return {
      source_status: "error",
      source_message: "Uploaded CSV could not be used because no Date column was found.",
      kpis: { spend: 0, trial_cac: null, subscriber_cac: null, roas_pct: null, payback_days: null },
      daily: [],
      campaigns: [],
      platforms: [],
      detected_columns: columns,
      mapping,
    };
  }
  const dateSet = new Set(selectedDateRange(data));
  const dashboardTotals = dashboardDailyMarketingTotals(data);
  const parsedRows = normalizedRows
    .map((row) => {
      const date = marketingDateValue(row[mapping.date]);
      return {
        date,
        platform: mapping.platform ? String(row[mapping.platform] || "Unattributed").trim().toLowerCase() : "Unattributed",
        campaign_type: mapping.campaign_type ? String(row[mapping.campaign_type] || "Unattributed").trim() : "Unattributed",
        campaign_id: mapping.campaign_id ? String(row[mapping.campaign_id] || "").trim() : "",
        campaign: mapping.campaign ? String(row[mapping.campaign] || "Unattributed").trim() : "Unattributed",
        spend: mapping.spend ? numericValue(row[mapping.spend]) : 0,
        subscription_spend: mapping.subscription_spend ? numericValue(row[mapping.subscription_spend]) : 0,
        installs: mapping.installs ? numericValue(row[mapping.installs]) : 0,
        impressions: mapping.impressions ? numericValue(row[mapping.impressions]) : 0,
        clicks: mapping.clicks ? numericValue(row[mapping.clicks]) : 0,
        monetization_config_sub_pct: mapping.monetization_config_sub_pct ? numericValue(row[mapping.monetization_config_sub_pct]) : 0,
        subscription_new_logins: mapping.subscription_new_logins ? numericValue(row[mapping.subscription_new_logins]) : 0,
        new_logins: mapping.new_logins ? numericValue(row[mapping.new_logins]) : 0,
        trials: mapping.trials ? numericValue(row[mapping.trials]) : 0,
        trials_1: mapping.trials_1 ? numericValue(row[mapping.trials_1]) : 0,
        trials_49: mapping.trials_49 ? numericValue(row[mapping.trials_49]) : 0,
        subscribers: mapping.subscribers ? numericValue(row[mapping.subscribers]) : 0,
        paid_subs_199: mapping.paid_subs_199 ? numericValue(row[mapping.paid_subs_199]) : 0,
        paid_subs_499: mapping.paid_subs_499 ? numericValue(row[mapping.paid_subs_499]) : 0,
        paid_upgrades_300: mapping.paid_upgrades_300 ? numericValue(row[mapping.paid_upgrades_300]) : 0,
        revenue: mapping.revenue ? numericValue(row[mapping.revenue]) : 0,
        trial_revenue: mapping.trial_revenue ? numericValue(row[mapping.trial_revenue]) : 0,
        sub_revenue: mapping.sub_revenue ? numericValue(row[mapping.sub_revenue]) : 0,
        dau: mapping.dau ? numericValue(row[mapping.dau]) : 0,
        subscriber_dau: mapping.subscriber_dau ? numericValue(row[mapping.subscriber_dau]) : 0,
        all_d1_retention: mapping.all_d1_retention ? numericValue(row[mapping.all_d1_retention]) : 0,
        all_d3_retention: mapping.all_d3_retention ? numericValue(row[mapping.all_d3_retention]) : 0,
        all_d7_retention: mapping.all_d7_retention ? numericValue(row[mapping.all_d7_retention]) : 0,
        sub_d1_retention: mapping.sub_d1_retention ? numericValue(row[mapping.sub_d1_retention]) : 0,
        sub_d3_retention: mapping.sub_d3_retention ? numericValue(row[mapping.sub_d3_retention]) : 0,
        sub_d7_retention: mapping.sub_d7_retention ? numericValue(row[mapping.sub_d7_retention]) : 0,
        arpu_subs: mapping.arpu_subs ? numericValue(row[mapping.arpu_subs]) : 0,
        arpu_subs_excl_trials: mapping.arpu_subs_excl_trials ? numericValue(row[mapping.arpu_subs_excl_trials]) : 0,
        mix_499: mapping.mix_499 ? numericValue(row[mapping.mix_499]) : 0,
        reported_trial_cac: mapping.reported_trial_cac ? numericValue(row[mapping.reported_trial_cac]) : 0,
        reported_subscriber_cac: mapping.reported_subscriber_cac ? numericValue(row[mapping.reported_subscriber_cac]) : 0,
      };
    })
    .filter((row) => dateSet.has(row.date));

  if (!parsedRows.length) {
    return {
      source_status: "empty",
      source_message: "Uploaded CSV has no rows in the selected dashboard window.",
      kpis: { spend: 0, trial_cac: null, subscriber_cac: null, roas_pct: null, payback_days: null },
      daily: [],
      campaigns: [],
      platforms: [],
      detected_columns: columns,
      mapping,
    };
  }

  const overviewValueKeys = ["spend", "subscription_spend", "installs", "impressions", "clicks", "monetization_config_sub_pct", "subscription_new_logins", "new_logins", "trials", "trials_1", "trials_49", "subscribers", "paid_subs_199", "paid_subs_499", "paid_upgrades_300", "revenue", "trial_revenue", "sub_revenue", "dau", "subscriber_dau", "all_d1_retention", "all_d3_retention", "all_d7_retention", "sub_d1_retention", "sub_d3_retention", "sub_d7_retention", "arpu_subs", "arpu_subs_excl_trials", "mix_499", "reported_trial_cac", "reported_subscriber_cac"];
  const daily = addMarketingRates(sumRows(parsedRows, ["date"], overviewValueKeys)
    .map((row) => {
      const dashboardRow = dashboardTotals[row.date] || {};
      return {
        ...row,
        new_logins: mapping.new_logins ? row.new_logins : Number(dashboardRow.new_logins || 0),
        trials: mapping.trials ? row.trials : Number(dashboardRow.trials || 0),
        subscribers: mapping.subscribers ? row.subscribers : Number(dashboardRow.subscribers || 0),
        revenue: mapping.revenue ? row.revenue : Number(dashboardRow.revenue || 0),
      };
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const hasCampaignDimension = Boolean(mapping.campaign || mapping.campaign_type || mapping.campaign_id);
  const hasPlatformDimension = Boolean(mapping.platform);
  const isOverviewFormat = !hasCampaignDimension && !hasPlatformDimension && Boolean(mapping.subscription_spend || mapping.trials_1 || mapping.paid_subs_499 || mapping.arpu_subs);
  const campaignRows = hasCampaignDimension
    ? addMarketingRates(sumRows(parsedRows, ["campaign", "campaign_type", "campaign_id"], overviewValueKeys))
      .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    : [];
  const platformRows = hasPlatformDimension
    ? addMarketingRates(sumRows(parsedRows, ["platform"], overviewValueKeys))
      .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    : [];
  const total = daily.reduce((acc, row) => {
    overviewValueKeys.forEach((key) => {
      acc[key] = Number(acc[key] || 0) + Number(row[key] || 0);
    });
    return acc;
  }, {});
  const spendBase = Number(total.subscription_spend || 0) > 0 ? Number(total.subscription_spend || 0) : Number(total.spend || 0);
  const latestDaily = daily[daily.length - 1] || {};
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const requiredOverviewCount = ["date", "spend", "subscription_spend", "new_logins", "trials", "subscribers", "revenue"].filter((key) => mapping[key]).length;
  return {
    source_status: "uploaded",
    marketing_format: isOverviewFormat ? "subscription_overview" : "campaign",
    source_message: mapping.revenue
      ? (isOverviewFormat ? "Uploaded Subscription Overview CSV is powering marketing spend, subscription funnel, retention, ARPU, CAC, and revenue metrics for this browser session." : "Uploaded CSV is powering marketing spend and attributed revenue metrics for this browser session.")
      : "Uploaded CSV is powering spend/click/install metrics. CAC and ROAS use total dashboard conversions and revenue for the same selected dates because campaign-level conversion columns were not present.",
    kpis: {
      spend: total.spend || 0,
      subscription_spend: total.subscription_spend || 0,
      installs: total.installs || 0,
      impressions: total.impressions || 0,
      clicks: total.clicks || 0,
      ctr_pct: safePercent(total.clicks, total.impressions),
      cpc: safeRatioValue(total.spend, total.clicks),
      cpi: safeRatioValue(total.spend, total.installs),
      trial_cac: safeRatioValue(spendBase, total.trials),
      subscriber_cac: safeRatioValue(spendBase, total.subscribers),
      trials: total.trials || 0,
      trials_1: total.trials_1 || 0,
      trials_49: total.trials_49 || 0,
      subscribers: total.subscribers || 0,
      paid_subs_199: total.paid_subs_199 || 0,
      paid_subs_499: total.paid_subs_499 || 0,
      paid_upgrades_300: total.paid_upgrades_300 || 0,
      trial_revenue: total.trial_revenue || 0,
      sub_revenue: total.sub_revenue || 0,
      mix_499_pct: safePercent(total.paid_subs_499, total.subscribers),
      latest_499_mix_pct: latestDaily.mix_499 || safePercent(latestDaily.paid_subs_499, latestDaily.subscribers),
      avg_arpu_subs: safeRatioValue(total.revenue, total.subscribers),
      avg_arpu_subs_excl_trials: safeRatioValue(total.sub_revenue, total.subscribers),
      latest_arpu_subs: latestDaily.arpu_subs || null,
      latest_arpu_subs_excl_trials: latestDaily.arpu_subs_excl_trials || null,
      latest_all_d1_retention: latestDaily.all_d1_retention || null,
      latest_sub_d1_retention: latestDaily.sub_d1_retention || null,
      mapped_fields: mappedCount,
      overview_required_fields: requiredOverviewCount,
      roas_pct: safePercent(total.revenue, total.spend),
      payback_days: total.revenue ? Number(((total.spend / total.revenue) * daily.length).toFixed(1)) : null,
    },
    daily,
    campaigns: campaignRows.slice(0, 50),
    platforms: platformRows,
    detected_columns: columns,
    mapping,
    row_count: parsedRows.length,
    has_campaign_attribution: Boolean(mapping.revenue || mapping.trials || mapping.subscribers),
  };
}

function effectiveMarketingData(data) {
  return MARKETING_UPLOAD_STATE ? buildMarketingFromRows(MARKETING_UPLOAD_STATE.rows, data) : (data.marketing || {});
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

function drilldownAttrs(label) {
  return `data-drilldown-label="${escapeHtml(label)}" role="button" tabindex="0"`;
}

function card(label, value, sub = "") {
  return `
    <article class="kpi-card" ${drilldownAttrs(label)}>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </article>
  `;
}

function insightCard(label, value, sub = "", tone = "neutral") {
  return `
    <article class="insight-card ${tone}" ${drilldownAttrs(label)}>
      <div class="insight-label">${escapeHtml(label)}</div>
      <div class="insight-value">${value}</div>
      <div class="insight-sub">${sub}</div>
    </article>
  `;
}

function actionCard(label, value, sub = "", tone = "neutral") {
  return `
    <article class="action-card ${tone}" ${drilldownAttrs(label)}>
      <div class="action-label">${escapeHtml(label)}</div>
      <div class="action-value">${value}</div>
      <div class="action-sub">${sub}</div>
    </article>
  `;
}

function funnelStep(label, value, sub = "") {
  return `
    <article class="funnel-step" ${drilldownAttrs(label)}>
      <div class="funnel-label">${escapeHtml(label)}</div>
      <div class="funnel-value">${value}</div>
      <div class="funnel-sub">${sub}</div>
    </article>
  `;
}

function miniMetric(label, value, sub = "") {
  return `
    <article class="mini-metric" ${drilldownAttrs(label)}>
      <div class="mini-metric-label">${escapeHtml(label)}</div>
      <div class="mini-metric-value">${value}</div>
      <div class="mini-metric-sub">${sub}</div>
    </article>
  `;
}

function streamCard(row, accent = COLORS.blue) {
  const title = row.family_label || familyLabel(row.family);
  return `
    <article class="stream-card" style="--accent: ${accent}" ${drilldownAttrs(title)}>
      <div>
        <div class="stream-title">${escapeHtml(title)}</div>
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
    <details class="detail-table">
      <summary>View detail table <span>${number(sliced.length)} rows</span></summary>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${columns.map((c) => `<th class="${c.text ? "text" : ""}">${c.label}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${sliced
              .map(
                (row) => `
                  <tr class="${row.matured === false || row.d1_matured === false || row.conversion_matured === false ? "immature" : ""}">
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
    </details>
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

function dailyPeriodDashboards() {
  const periods = DASHBOARD_DATA.metadata?.daily_periods || [];
  return periods
    .map((period) => ({
      date: period.date,
      data: DASHBOARD_DATA.periods?.[period.id],
    }))
    .filter((period) => period.date && period.data);
}

function dailyConfigFunnelRows() {
  return dailyPeriodDashboards().flatMap(({ date, data }) => (
    data.monetization?.config_funnel || []
  ).map((row) => ({
    date,
    trial_type: row.trial_type,
    assigned_users: row.assigned_users,
    followup_users: row.followup_users,
    paywall_shown_users: row.paywall_shown_users,
    trial_cta_users: row.trial_cta_users,
    trial_buyers: row.trial_buyers,
    main_plan_buyers: row.main_plan_buyers,
    main_199_buyers: row.main_199_buyers,
    main_499_buyers: row.main_499_buyers,
    followup_to_trial_pct: row.followup_to_trial_pct,
    trial_to_main_pct: row.trial_to_main_pct,
    followup_to_main_pct: row.followup_to_main_pct,
  })));
}

function currentFunnelStageRows(configRows) {
  const totals = (configRows || []).reduce((acc, row) => {
    [
      "assigned_users",
      "followup_users",
      "paywall_shown_users",
      "trial_cta_users",
      "trial_buyers",
      "main_plan_buyers",
    ].forEach((key) => {
      acc[key] = (acc[key] || 0) + Number(row[key] || 0);
    });
    return acc;
  }, {});
  return [
    { stage: "Assigned", users: totals.assigned_users, conversion_pct: 100 },
    { stage: "Follow-up", users: totals.followup_users, conversion_pct: safePercent(totals.followup_users, totals.assigned_users) },
    { stage: "Paywall", users: totals.paywall_shown_users, conversion_pct: safePercent(totals.paywall_shown_users, totals.followup_users) },
    { stage: "Trial CTA", users: totals.trial_cta_users, conversion_pct: safePercent(totals.trial_cta_users, totals.paywall_shown_users) },
    { stage: "Trial Buyers", users: totals.trial_buyers, conversion_pct: safePercent(totals.trial_buyers, totals.trial_cta_users) },
    { stage: "Main Buyers", users: totals.main_plan_buyers, conversion_pct: safePercent(totals.main_plan_buyers, totals.trial_buyers) },
  ];
}

function dashboardDateOptions() {
  const dailyPeriods = DASHBOARD_DATA.metadata?.daily_periods || [];
  if (dailyPeriods.length) return dailyPeriods.map((period) => period.date);
  const weekly = DASHBOARD_DATA.periods?.weekly;
  const days = new Set();
  (weekly?.monetization?.daily_summary || []).forEach((row) => days.add(row.day));
  (weekly?.acquisition?.daily || []).forEach((row) => days.add(row.signup_date));
  (weekly?.engagement?.session_daily || []).forEach((row) => days.add(row.date));
  return [...days].filter(Boolean).sort();
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function fetchLiveStatus() {
  try {
    const response = await fetch(apiUrl("/api/status"), { cache: "no-store" });
    if (!response.ok) return null;
    LIVE_API_STATUS = await response.json();
    return LIVE_API_STATUS;
  } catch (_error) {
    LIVE_API_STATUS = null;
    return null;
  }
}

function latestSelectableDate() {
  if (LIVE_API_STATUS?.latest_complete_day) return LIVE_API_STATUS.latest_complete_day;
  const days = dashboardDateOptions();
  if (days.length) return days[days.length - 1];
  return DASHBOARD_DATA.metadata?.current_window?.end || new Date().toISOString().slice(0, 10);
}

function setDateStatus(message) {
  DATE_STATUS_MESSAGE = message || "";
  const status = document.getElementById("dateFetchStatus");
  if (status) status.textContent = DATE_STATUS_MESSAGE;
}

function hasDailyPeriod(day) {
  return Boolean(DASHBOARD_DATA.periods?.[`daily_${day}`]);
}

function upsertDailyPeriod(day, period) {
  if (!DASHBOARD_DATA.periods) DASHBOARD_DATA.periods = {};
  const periodId = `daily_${day}`;
  DASHBOARD_DATA.periods[periodId] = period;
  const metadata = DASHBOARD_DATA.metadata || {};
  const existing = metadata.daily_periods || [];
  const nextPeriod = {
    id: periodId,
    date: day,
    label: shortDate(day),
    ...(period.metadata || {}),
  };
  metadata.daily_periods = [
    ...existing.filter((row) => row.date !== day),
    nextPeriod,
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  DASHBOARD_DATA.metadata = metadata;
}

async function ensureDailyPeriod(day) {
  if (hasDailyPeriod(day)) return true;
  if (!LIVE_API_STATUS?.live_daily_api) {
    setDateStatus("Selected date is outside the published reporting range");
    return false;
  }
  setDateStatus(`Loading ${shortDate(day)}...`);
  try {
    const response = await fetch(apiUrl(`/api/dashboard?date=${encodeURIComponent(day)}`), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Live data fetch failed.");
    }
    const cleaned = hideUnknownRows(payload);
    upsertDailyPeriod(cleaned.date || day, cleaned.period);
    if (cleaned.metadata?.generated_at_ist) {
      DASHBOARD_DATA.metadata.generated_at_ist = cleaned.metadata.generated_at_ist;
    }
    if (cleaned.metadata?.source_notes) {
      DASHBOARD_DATA.metadata.source_notes = cleaned.metadata.source_notes;
    }
    if (cleaned.metadata?.data_retention_policy) {
      DASHBOARD_DATA.metadata.data_retention_policy = cleaned.metadata.data_retention_policy;
    }
    setDateStatus(`Showing ${shortDate(day)}`);
    return true;
  } catch (error) {
    setDateStatus(`Could not load selected date: ${error.message}`);
    return false;
  }
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const hasExportArea = keys.includes("area") || keys.includes("table");
  const columns = hasExportArea
    ? ["area", "table", ...keys.filter((key) => !["area", "table"].includes(key))]
    : keys;
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

function formatNullableMoney(value) {
  return value === null || value === undefined ? "Pending" : money(value);
}

function formatNullableNumber(value) {
  return value === null || value === undefined ? "Pending" : number(value);
}

function setupMarketingUploadControls(data) {
  const input = document.getElementById("marketingCsvInput");
  const status = document.getElementById("marketingUploadStatus");
  const clear = document.getElementById("marketingUploadClear");
  const template = document.getElementById("marketingTemplateDownload");
  if (!input || !status || !clear || !template) return;

  if (MARKETING_UPLOAD_STATE) {
    const loadedAt = MARKETING_UPLOAD_STATE.loadedAt
      ? new Date(MARKETING_UPLOAD_STATE.loadedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "saved";
    const freshness = marketingUploadFreshness(data);
    const coverageText = freshness.maxDate
      ? `CSV data through ${shortDate(freshness.maxDate)}`
      : "CSV date coverage not detected";
    const freshnessText = freshness.stale
      ? `Upload new CSV for ${shortDate(freshness.selectedMax)}. ${coverageText}.`
      : `${coverageText}. Upload a newer CSV to replace it.`;
    status.innerHTML = `
      <strong>${number(MARKETING_UPLOAD_STATE.rows.length)} uploaded rows ready.</strong>
      <span>${escapeHtml(MARKETING_UPLOAD_STATE.fileName)} is saved in this browser from ${loadedAt}. ${escapeHtml(freshnessText)}</span>
    `;
  } else {
    status.innerHTML = `
      <strong>No CSV uploaded.</strong>
      <span>Use Campaign Data columns or the Subscription Overview format where row 3 starts with Date, Installs, Marketing spends, Marketing spends - subs.</span>
    `;
  }

  input.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const previousUpload = MARKETING_UPLOAD_STATE;
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("No rows found in CSV.");
      MARKETING_UPLOAD_STATE = {
        fileName: file.name,
        rows,
        loadedAt: new Date().toISOString(),
      };
      saveMarketingUploadState(MARKETING_UPLOAD_STATE);
      renderDashboard();
      resizeVisibleCharts();
    } catch (error) {
      MARKETING_UPLOAD_STATE = previousUpload;
      status.innerHTML = `<strong>Upload failed.</strong><span>${escapeHtml(error.message)}</span>`;
    } finally {
      input.value = "";
    }
  };

  clear.onclick = () => {
    MARKETING_UPLOAD_STATE = null;
    clearMarketingUploadState();
    renderDashboard();
    resizeVisibleCharts();
  };

  template.onclick = () => {
    downloadCsv("hiastro-marketing-campaign-template.csv", [
      Object.fromEntries(MARKETING_TEMPLATE_COLUMNS.map((column) => [column, ""])),
    ]);
  };
}

function dayRows(rows, key, day) {
  return (rows || []).filter((row) => row[key] === day);
}

function buildDayExportRows(day) {
  const dailyPeriod = DASHBOARD_DATA.periods?.[`daily_${day}`];
  if (dailyPeriod) {
    const sections = [
      ["Monetization", "Daily revenue by stream", dailyPeriod.monetization?.daily || []],
      ["Monetization", "Daily pack detail", dailyPeriod.monetization?.daily_pack_merged || dailyPeriod.monetization?.daily_pack || []],
      ["Monetization", "Daily new vs old revenue", dailyPeriod.monetization?.daily_user_cohort || []],
      ["Acquisition", "Daily new user funnel", dailyPeriod.acquisition?.daily || []],
      ["Acquisition", "Daily payment family", dailyPeriod.acquisition?.daily_payment_family || []],
      ["Engagement", "Daily sessions", dailyPeriod.engagement?.session_daily || []],
      ["Engagement", "Daily BIM opens", dailyPeriod.engagement?.bim_daily || []],
      ["Engagement", "Session new vs old", dailyPeriod.engagement?.session_user_cohort_daily || []],
      ["Engagement", "BIM new vs old", dailyPeriod.engagement?.bim_user_cohort_daily || []],
    ];
    return sections.flatMap(([area, tableName, rows]) => rows.map((row) => ({ area, table: tableName, ...row })));
  }
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
  const maxDay = latestSelectableDate();
  if (!days.length && !maxDay) {
    controls.innerHTML = "";
    return;
  }
  const defaultDay = days[days.length - 1] || maxDay;
  if (!SELECTED_DAY) SELECTED_DAY = defaultDay;
  const selectDays = days.includes(SELECTED_DAY)
    ? days
    : [...days, SELECTED_DAY].filter(Boolean).sort();
  const applySelectedDay = async (day) => {
    if (!day) return;
    if (maxDay && day > maxDay) {
      setDateStatus(`Latest complete date is ${shortDate(maxDay)}`);
      return;
    }
    SELECTED_DAY = day;
    SELECTED_PERIOD = "daily";
    setupPeriodControls();
    setupDayDownloadControls();
    const ready = await ensureDailyPeriod(day);
    if (ready) {
      SELECTED_DAY = day;
      SELECTED_PERIOD = "daily";
    }
    setupDayDownloadControls();
    if (ready) renderDashboard();
  };
  controls.innerHTML = `
    <select id="downloadDaySelect" aria-label="Day to download">
      ${selectDays.map((day) => `<option value="${escapeHtml(day)}"${day === SELECTED_DAY ? " selected" : ""}>${escapeHtml(shortDate(day))}</option>`).join("")}
    </select>
    <input id="customDayInput" type="date" max="${escapeHtml(maxDay)}" value="${escapeHtml(SELECTED_DAY)}" aria-label="Custom daily date" />
    <button type="button" id="downloadDayCsv">Download CSV</button>
    <span class="date-status" id="dateFetchStatus">${escapeHtml(DATE_STATUS_MESSAGE)}</span>
  `;
  document.getElementById("downloadDaySelect").addEventListener("change", (event) => {
    applySelectedDay(event.target.value);
  });
  document.getElementById("customDayInput").addEventListener("change", (event) => {
    applySelectedDay(event.target.value);
  });
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
  const chartText = THEME === "day" ? "#334155" : "#cbd5e1";
  const titleText = THEME === "day" ? "#0f172a" : "#f7f9ff";
  const gridColor = THEME === "day" ? "#e2e8f0" : "rgba(255,255,255,0.10)";
  CHARTS[id] = new Chart(el, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: chartText, boxWidth: 10, boxHeight: 10 } },
        title: { color: titleText, font: { weight: "700" } },
      },
      scales: type === "doughnut" ? {} : {
        x: { grid: { display: false }, ticks: { color: chartText } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: chartText } },
      },
      ...options,
    },
  });
  return CHARTS[id];
}

function compactWindowLabel(windowMeta) {
  if (!windowMeta?.start || !windowMeta?.end) return "Current window";
  if (windowMeta.start === windowMeta.end) return shortDate(windowMeta.start);
  return `${shortDate(windowMeta.start)} - ${shortDate(windowMeta.end)}`;
}

function formalWindowLabel(windowMeta) {
  if (!windowMeta?.start || !windowMeta?.end) return "Current reporting period";
  const start = new Date(`${windowMeta.start}T00:00:00`);
  const end = new Date(`${windowMeta.end}T00:00:00`);
  const fmt = { day: "2-digit", month: "short", year: "numeric" };
  if (windowMeta.start === windowMeta.end) {
    return start.toLocaleDateString("en-IN", fmt);
  }
  return `${start.toLocaleDateString("en-IN", fmt)} to ${end.toLocaleDateString("en-IN", fmt)}`;
}

function guideCard(label, value, sub = "", tone = "neutral") {
  return `
    <article class="guide-card ${tone}" ${drilldownAttrs(label)}>
      <div class="guide-label">${escapeHtml(label)}</div>
      <div class="guide-value">${value}</div>
      <div class="guide-sub">${sub}</div>
    </article>
  `;
}

function flowCard(anchor, label, value, sub = "", tone = "neutral") {
  return `
    <a class="flow-card ${tone}" href="${anchor}" data-drilldown-label="${escapeHtml(label)}">
      <span class="flow-label">${escapeHtml(label)}</span>
      <strong>${value}</strong>
      <span>${sub}</span>
    </a>
  `;
}

function renderDashboardGuide(data) {
  const rootMeta = DASHBOARD_DATA.metadata || {};
  const meta = data.metadata || rootMeta;
  const m = data.monetization?.kpis?.current || {};
  const g7 = data.monetization?.kpis?.growth_vs_prior_7 || {};
  const a = data.acquisition?.kpis || {};
  const r = (data.retention?.curve || []).find((row) => row.day_n === 1) || {};
  const r7 = (data.retention?.curve || []).find((row) => row.day_n === 7) || {};
  const e = data.engagement?.kpis || {};
  const coverageRows = data.metric_coverage?.rows || [];
  const availableMetrics = coverageRows.filter((row) => row.status === "Available").length;
  const selectedWindow = meta.current_window || rootMeta.current_window;
  const sub = familyMetric(data.monetization, "subscription");
  const payg = familyMetric(data.monetization, "pay_as_you_go");
  const marketing = effectiveMarketingData(data);
  const marketingKpis = marketing.kpis || {};
  const marketingFreshness = MARKETING_UPLOAD_STATE ? marketingUploadFreshness(data) : null;
  const marketingReady = marketing.source_status === "available" || marketing.source_status === "uploaded";
  const marketingSubtext = marketingFreshness?.stale
    ? `Upload new CSV for ${shortDate(marketingFreshness.selectedMax)}`
    : (marketingReady ? `CAC ${formatNullableMoney(marketingKpis.subscriber_cac)}` : "Spend source pending");
  const viewLabel = SELECTED_PERIOD === "daily" ? "Daily view" : "7-day view";
  const executivePeriod = document.getElementById("executivePeriod");
  if (executivePeriod) {
    executivePeriod.textContent = `${viewLabel} | ${formalWindowLabel(selectedWindow)}`;
  }

  document.getElementById("dashboardGuide").innerHTML = [
    guideCard("Operating Revenue", money(m.revenue), `${trend(g7.revenue)} vs prior period | ${number(m.payers)} payers`, Number(g7.revenue || 0) >= 0 ? "good" : "risk"),
    guideCard("Subscription Mix", pct(sub.revenue_share_pct), `${money(sub.revenue)} revenue | ${number(sub.payers)} payers`, "good"),
    guideCard("New User Payment", pct(a.new_user_to_payment_pct), `${number(a.new_users)} new users | ${pct(a.new_user_to_followup_pct)} reached follow-up`, Number(a.new_user_to_payment_pct || 0) >= 8 ? "good" : "risk"),
    guideCard("D1 Retention", pct(r.retention_pct || 0), `D7 ${pct(r7.retention_pct || 0)} | ${number(e.sessions)} sessions`, Number(r.retention_pct || 0) >= 8 ? "good" : "risk"),
  ].join("");

  document.getElementById("businessFlow").innerHTML = [
    flowCard("#monetization", "Monetization", money(m.revenue), `Subscription ${pct(sub.revenue_share_pct)} | PayG ${pct(payg.revenue_share_pct)}`, "good"),
    flowCard("#acquisition", "Acquisition", number(a.new_users), `${pct(a.new_user_to_payment_pct)} new-user payment`),
    flowCard("#marketing", "Marketing", money(marketingKpis.spend || 0), marketingSubtext, marketingFreshness?.stale ? "risk" : (marketingReady ? "good" : "neutral")),
    flowCard("#retention", "Retention", pct(r.retention_pct || 0), "Day-1 returning users", Number(r.retention_pct || 0) >= 8 ? "good" : "risk"),
    flowCard("#engagement", "Engagement", `${e.avg_minutes_per_user || 0}m`, `${number(e.sessions)} sessions`),
    flowCard("#coverage", "Data Quality", `${number(availableMetrics)}/${number(coverageRows.length)}`, "metric families ready"),
  ].join("");
}

function renderOverview(data) {
  const m = data.monetization.kpis.current;
  const g7 = data.monetization.kpis.growth_vs_prior_7;
  const sub = familyMetric(data.monetization, "subscription");
  const payg = familyMetric(data.monetization, "pay_as_you_go");
  const a = data.acquisition.kpis;

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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
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
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Revenue" } },
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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "rgba(255,255,255,0.10)" } } },
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
  const subscriptionStageByUserCohort = m.subscription_stage_by_user_cohort || [];
  const subscriptionPacks = m.subscription_pack || [];
  const renewal = m.subscription_renewal || { kpis: {}, due_daily: [], due_by_plan: [], status_breakdown: [], notes: [] };
  const dailyConfigFunnel = m.daily_config_platform_funnel || [];
  const trialCohorts = m.trial_to_paid_cohort_by_price || [];
  const activeSubDaily = m.active_subscription_daily || [];
  const subscriberEngagementSummary = m.subscriber_engagement_summary || [];
  const planUsage = m.plan_usage || [];
  const atRiskBuckets = m.at_risk_subscriber_buckets || [];
  const atRiskSubscribers = m.at_risk_subscribers || [];
  const paymentKpis = m.payment_kpis || {};
  const paymentDaily = m.payment_daily || [];
  const paymentMethod = m.payment_method || [];
  const paymentRetry = m.payment_retry || [];
  const paymentStatus = m.payment_failure_status || [];
  const trialLifecycle = m.trial_lifecycle || [];
  const trialCancelByPlan = m.trial_cancel_by_plan || [];
  const cancelDistribution = m.cancel_distribution || [];
  const renewalRealized = m.renewal_realized || {};
  const renewalCohorts = m.renewal_cohorts || [];
  const paygMergedRows = m.payg_merged || [];
  const paygMerged = paygMergedRows[0] || familyMetric(m, "pay_as_you_go");
  const paygAmounts = m.payg_amount_breakdown || [];
  const configCohortRows = m.config_funnel_by_user_cohort || [];
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
  const bestFollowupTrialPlan = [...subscriptionPlans]
    .filter((row) => Number(row.followup_users || 0) > 0)
    .sort((a, b) => Number(b.followup_to_trial_pct || 0) - Number(a.followup_to_trial_pct || 0))[0] || {};
  const bestFollowupMainPlan = [...subscriptionPlans]
    .filter((row) => Number(row.followup_users || 0) > 0)
    .sort((a, b) => Number(b.followup_to_main_pct || 0) - Number(a.followup_to_main_pct || 0))[0] || {};
  const bestRevenuePlan = topRows(subscriptionPlans, "revenue", 1)[0] || {};
  const mainPackDailyRows = (mTrend.daily_pack || m.daily_pack || [])
    .filter((row) => row.family === "subscription" && String(row.pack || "").startsWith("Main Rs ") && [199, 499].includes(Number(row.amount)))
    .map((row) => ({ ...row, pack_amount: `Rs ${Number(row.amount)}` }));
  const mainPackDaily = groupedLine(mainPackDailyRows, "day", "pack_amount", "payers");
  mainPackDaily.labels = mainPackDaily.labels.map(shortDate);
  const dailyFunnelAgg = Object.values(dailyConfigFunnel.reduce((acc, row) => {
    const day = row.signup_date;
    if (!acc[day]) {
      acc[day] = {
        signup_date: day,
        new_logins: 0,
        trial_purchased_d0: 0,
        subscription_199_charged_d1: 0,
        subscription_499_charged_d1: 0,
        total_subscription_charged_d1: 0,
      };
    }
    acc[day].new_logins += Number(row.new_logins || 0);
    acc[day].trial_purchased_d0 += Number(row.trial_purchased_d0 || 0);
    acc[day].subscription_199_charged_d1 += Number(row.subscription_199_charged_d1 || 0);
    acc[day].subscription_499_charged_d1 += Number(row.subscription_499_charged_d1 || 0);
    acc[day].total_subscription_charged_d1 += Number(row.total_subscription_charged_d1 || 0);
    return acc;
  }, {})).sort((a, b) => String(a.signup_date).localeCompare(String(b.signup_date)));
  const maturedDailyFunnel = dailyConfigFunnel.filter((row) => row.d1_matured);
  const sheetFunnelTotals = dailyConfigFunnel.reduce((acc, row) => {
    acc.new_logins += Number(row.new_logins || 0);
    acc.trial_purchased_d0 += Number(row.trial_purchased_d0 || 0);
    return acc;
  }, { new_logins: 0, trial_purchased_d0: 0 });
  const maturedFunnelTotals = maturedDailyFunnel.reduce((acc, row) => {
    acc.trial_purchased_d0 += Number(row.trial_purchased_d0 || 0);
    acc.subscription_199_charged_d1 += Number(row.subscription_199_charged_d1 || 0);
    acc.subscription_499_charged_d1 += Number(row.subscription_499_charged_d1 || 0);
    acc.total_subscription_charged_d1 += Number(row.total_subscription_charged_d1 || 0);
    return acc;
  }, { trial_purchased_d0: 0, subscription_199_charged_d1: 0, subscription_499_charged_d1: 0, total_subscription_charged_d1: 0 });
  const latestActiveSub = activeSubDaily[activeSubDaily.length - 1] || {};
  const subscriberEngagement = subscriberEngagementSummary.find((row) => row.user_type === "subscriber") || {};
  const nonSubscriberEngagement = subscriberEngagementSummary.find((row) => row.user_type === "non_subscriber") || {};

  document.getElementById("subscriptionFocusCards").innerHTML = [
    card("Subscription Revenue", money(sub.revenue), `${pct(sub.revenue_share_pct)} of total | ${trend(sub.revenue_growth_vs_prior_7_pct)} vs prev`),
    card("Sub Payers", number(sub.payers), `${number(sub.transactions)} transactions | ARPP ${money(sub.avg_revenue_per_payer)}`),
    card("Rs 499 Main Users", number(main499.payers), `${money(main499.revenue)} revenue`),
    card("Rs 199 Main Users", number(main199.payers), `${money(main199.revenue)} revenue`),
    card("Trial Buyers", number(trialBuyers), `${money(trialRevenue)} from Rs 1 and Rs 49 trials`),
    card("Main Buyers", number(mainBuyers), `${pct(trialToMainPct)} of trial buyers | ${money(mainRevenue)}`),
  ].join("");
  document.getElementById("subscriptionConversionCards").innerHTML = [
    actionCard("Same-Period Main / Trial", pct(trialToMainPct), `${number(mainBuyers)} main buyers and ${number(trialBuyers)} trial buyers in this window`, "neutral"),
    actionCard("Rs 499 Main Share", pct(main499BuyerShare), `${number(main499.payers)} users | ${pct(main499RevenueShare)} of main revenue`, main499BuyerShare >= main199BuyerShare ? "good" : "neutral"),
    actionCard("Best Follow-up to Trial", bestFollowupTrialPlan.plan_code || "-", `${pct(bestFollowupTrialPlan.followup_to_trial_pct)} follow-up to trial | ${number(bestFollowupTrialPlan.trial_buyers)} trial buyers`, "good"),
    actionCard("Best Follow-up to Main", bestFollowupMainPlan.plan_code || "-", `${pct(bestFollowupMainPlan.followup_to_main_pct)} follow-up to main | ${number(bestFollowupMainPlan.main_buyers)} main buyers`, "good"),
  ].join("");

  document.getElementById("packPerformanceCards").innerHTML = [
    card("Rs 499 Main Users", number(main499.payers), `${money(main499.revenue)} | ${number(main499.transactions)} txns`),
    card("Rs 199 Main Users", number(main199.payers), `${money(main199.revenue)} | ${number(main199.transactions)} txns`),
    card("Rs 499 vs 199", `${number(main499.payers)} / ${number(main199.payers)}`, `${pct(main499BuyerShare)} / ${pct(main199BuyerShare)} of main buyers`),
    card("Top Revenue Plan", topPlan.plan_code || "No plan", `${money(topPlan.revenue)} | ${pct(topPlan.followup_to_main_pct)} follow-up to main`),
    card("Sub Main Buyers", number(mainBuyers), `${pct(trialToMainPct)} same-period main/trial`),
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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Users" } } },
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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
  });

  document.getElementById("subscriptionSheetCards").innerHTML = [
    card("D0 Trial Rate", pct(safePercent(sheetFunnelTotals.trial_purchased_d0, sheetFunnelTotals.new_logins)), `${number(sheetFunnelTotals.trial_purchased_d0)} trials from ${number(sheetFunnelTotals.new_logins)} new logins`),
    card("D1 Main Conversion", pct(safePercent(maturedFunnelTotals.total_subscription_charged_d1, maturedFunnelTotals.trial_purchased_d0)), `${number(maturedFunnelTotals.total_subscription_charged_d1)} D1 main buyers from matured trial users`),
    card("Rs 499 D1 Buyers", number(maturedFunnelTotals.subscription_499_charged_d1), `${pct(safePercent(maturedFunnelTotals.subscription_499_charged_d1, maturedFunnelTotals.total_subscription_charged_d1))} of D1 main buyers`),
    card("Rs 199 D1 Buyers", number(maturedFunnelTotals.subscription_199_charged_d1), `${pct(safePercent(maturedFunnelTotals.subscription_199_charged_d1, maturedFunnelTotals.total_subscription_charged_d1))} of D1 main buyers`),
    card("Active Paid EOD", number(latestActiveSub.active_paid_subscribers), `${money(latestActiveSub.mrr)} MRR stock`),
    card("Subscriber Minutes/User", number(subscriberEngagement.minutes_per_user), `${number(subscriberEngagement.active_users)} active subscribers in DB sessions`),
  ].join("");

  chart("subscriptionDailyFunnelChart", "line", {
    labels: dailyFunnelAgg.map((row) => shortDate(row.signup_date)),
    datasets: [
      { label: "New logins", data: dailyFunnelAgg.map((row) => row.new_logins), borderColor: COLORS.blue, tension: 0.25 },
      { label: "D0 trial buyers", data: dailyFunnelAgg.map((row) => row.trial_purchased_d0), borderColor: COLORS.teal, tension: 0.25 },
      { label: "D1 Rs 499 main", data: dailyFunnelAgg.map((row) => row.subscription_499_charged_d1), borderColor: COLORS.green, tension: 0.25 },
      { label: "D1 Rs 199 main", data: dailyFunnelAgg.map((row) => row.subscription_199_charged_d1), borderColor: COLORS.gold, tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: New Login to Trial to Main` }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Users" } } },
  });

  const trialCohortChart = groupedLine(trialCohorts, "trial_start_date", "subscription_price", "conversion_pct");
  trialCohortChart.labels = trialCohortChart.labels.map(shortDate);
  chart("trialToPaidPriceChart", "line", trialCohortChart, {
    plugins: { title: { display: true, text: `${chartLabel}: Trial Cohort Conversion by Main Price` }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Conversion %" } } },
  });

  chart("activeSubscriptionStockChart", "line", {
    labels: activeSubDaily.map((row) => shortDate(row.date)),
    datasets: [
      { label: "Active paid subscribers", data: activeSubDaily.map((row) => row.active_paid_subscribers), borderColor: COLORS.green, tension: 0.25, yAxisID: "y" },
      { label: "Trial active subscribers", data: activeSubDaily.map((row) => row.trial_active_subscribers), borderColor: COLORS.teal, tension: 0.25, yAxisID: "y" },
      { label: "MRR stock", data: activeSubDaily.map((row) => row.mrr), borderColor: COLORS.gold, tension: 0.25, yAxisID: "y1" },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: Active Subscription Stock` }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Subscribers" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "MRR" } },
    },
  });

  chart("subscriberEngagementChart", "bar", {
    labels: ["Subscriber", "Non-subscriber"],
    datasets: [
      { label: "Active users", data: [subscriberEngagement.active_users || 0, nonSubscriberEngagement.active_users || 0], backgroundColor: COLORS.blue, yAxisID: "y" },
      { label: "Minutes/user", data: [subscriberEngagement.minutes_per_user || 0, nonSubscriberEngagement.minutes_per_user || 0], backgroundColor: COLORS.teal, yAxisID: "y1" },
    ],
  }, {
    plugins: { title: { display: true, text: `${chartLabel}: Subscriber vs Non-subscriber Engagement` }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Active Users" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Minutes/User" } },
    },
  });

  const topPlanUsage = topRows(planUsage, "active_paid_users", 8);
  chart("planUsageChart", "bar", {
    labels: topPlanUsage.map((row) => row.plan_code),
    datasets: [
      { label: "Chat min/user", data: topPlanUsage.map((row) => row.chat_minutes_per_user), backgroundColor: COLORS.blue },
      { label: "Call min/user", data: topPlanUsage.map((row) => row.call_minutes_per_user), backgroundColor: COLORS.teal },
      { label: "Call share %", data: topPlanUsage.map((row) => row.call_minutes_share_pct), backgroundColor: COLORS.gold, yAxisID: "y1" },
    ],
  }, {
    plugins: { title: { display: true, text: "Per-Plan Chat vs Call Consumption" }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Minutes per subscriber" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Call share %" } },
    },
  });

  chart("planRiskChart", "bar", {
    labels: atRiskBuckets.slice(0, 10).map((row) => `${row.plan_code} | ${row.risk_reason}`),
    datasets: [{ label: "Subscribers", data: atRiskBuckets.slice(0, 10).map((row) => row.subscribers), backgroundColor: COLORS.rose }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "At-Risk Subscriber Reasons" }, legend: { display: false } },
  });

  table("planUsageTable", planUsage, [
    { key: "plan_code", label: "Plan", text: true },
    { key: "active_paid_users", label: "Active Paid", format: number },
    { key: "revenue_stock", label: "MRR Stock", format: money },
    { key: "l7_active_user_pct", label: "L7 Active", format: pct },
    { key: "chat_minutes_per_user", label: "Chat Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "call_minutes_per_user", label: "Call Min/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "call_minutes_share_pct", label: "Call Share", format: pct },
    { key: "chat_entitlement_used_pct", label: "Chat Limit Used", format: pct },
    { key: "call_entitlement_used_pct", label: "Call Limit Used", format: pct },
    { key: "cancel_scheduled_users", label: "Cancel Scheduled", format: number },
  ], 12);

  table("atRiskBucketTable", atRiskBuckets, [
    { key: "plan_code", label: "Plan", text: true },
    { key: "risk_reason", label: "Risk Reason", text: true },
    { key: "subscribers", label: "Subscribers", format: number },
  ], 12);

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

  chart("renewalRealizedChart", "bar", {
    labels: ["Matured main buyers", "Renewed users"],
    datasets: [{ label: "Users", data: [renewalRealized.matured_main_buyers || 0, renewalRealized.renewed_users || 0], backgroundColor: [COLORS.blue, COLORS.green] }],
  }, {
    plugins: { title: { display: true, text: `Realized M1 Renewal: ${renewalRealized.matured ? pct(renewalRealized.m1_renewal_rate_pct) : "Not matured"}` }, legend: { display: false } },
  });
  chart("cancelDistributionChart", "bar", {
    labels: cancelDistribution.slice(0, 12).map((row) => `${row.bucket} | ${row.plan_code}`),
    datasets: [{ label: "Subscriptions", data: cancelDistribution.slice(0, 12).map((row) => row.subscriptions), backgroundColor: COLORS.rose }],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Time to Cancel Distribution" }, legend: { display: false } },
  });
  table("renewalCohortTable", renewalCohorts, [
    { key: "first_charge_week", label: "First Charge Cohort", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "matured", label: "Maturity", text: true, format: (v) => v ? "Matured" : "Not matured" },
    { key: "main_buyers", label: "Main Buyers", format: number },
    { key: "renewed_users", label: "Renewed", format: number },
    { key: "renewal_rate_pct", label: "M1 Renewal", format: pct },
  ], 16);
  table("cancelDistributionTable", cancelDistribution, [
    { key: "bucket", label: "Cancel Age", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "subscriptions", label: "Subscriptions", format: number },
  ], 16);
  table("trialLifecycleTable", trialLifecycle, [
    { key: "trial_start_date", label: "Trial Date", text: true, format: shortDate },
    { key: "trials", label: "Trials", format: number },
    { key: "cancel_before_charge", label: "Cancel Before Charge", format: number },
    { key: "cancel_before_charge_pct", label: "Cancel Before Charge %", format: pct },
    { key: "d0_cancel", label: "D0 Cancel", format: number },
    { key: "d0_cancel_pct", label: "D0 Cancel %", format: pct },
  ], 14);
  table("trialCancelPlanTable", trialCancelByPlan, [
    { key: "plan_code", label: "Plan", text: true },
    { key: "trials", label: "Trials", format: number },
    { key: "cancel_before_charge", label: "Cancel Before Charge", format: number },
    { key: "cancel_before_charge_pct", label: "Cancel Before Charge %", format: pct },
    { key: "d0_cancel", label: "D0 Cancel", format: number },
    { key: "d0_cancel_pct", label: "D0 Cancel %", format: pct },
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
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Revenue" } },
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
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Revenue" } },
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
    { key: "trial_amount", label: "Trial Amt", format: money },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_revenue", label: "Main Rev", format: money },
    { key: "main_amount", label: "Main Amt", format: money },
    { key: "main_buyers", label: "Main Buyers", format: number },
    { key: "followup_users", label: "Follow-up Users", format: number },
    { key: "followup_to_trial_pct", label: "Follow-up to Trial", format: pct },
    { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
    { key: "main_to_trial_buyer_pct", label: "Same-Period Main / Trial", format: pct },
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

  const cohortStageRows = subscriptionStageByUserCohort.map((row) => ({
    ...row,
    stage_amount: `${row.stage} Rs ${Number(row.amount || 0)}`,
  }));
  const cohortStageLabels = uniqueSorted(cohortStageRows, "stage_amount");
  const cohortStageGroups = uniqueSorted(cohortStageRows, "user_cohort");
  const cohortStagePalette = [COLORS.blue, COLORS.teal, COLORS.gold];
  chart("subscriptionCohortStageChart", "bar", {
    labels: cohortStageLabels,
    datasets: cohortStageGroups.map((group, index) => ({
      label: group,
      data: cohortStageLabels.map((label) => {
        const row = cohortStageRows.find((item) => item.stage_amount === label && item.user_cohort === group);
        return row ? Number(row.payers || 0) : 0;
      }),
      backgroundColor: cohortStagePalette[index % cohortStagePalette.length],
    })),
  }, {
    plugins: { title: { display: true, text: "New vs Old Subscription Buyers by Pack" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
  });
  table("subscriptionCohortStageTable", subscriptionStageByUserCohort, [
    { key: "selection", label: "Selection", text: true },
    { key: "user_cohort", label: "User Type", text: true },
    { key: "stage", label: "Stage", text: true },
    { key: "amount", label: "Amount", format: money },
    { key: "payers", label: "Buyers", format: number },
    { key: "revenue", label: "Revenue", format: money },
    { key: "transactions", label: "Txns", format: number },
    { key: "revenue_share_pct", label: "Total Sub Share", format: pct },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], 20);

  table("subscriptionDailyFunnelTable", dailyConfigFunnel, [
    { key: "signup_date", label: "Date", text: true, format: shortDate },
    { key: "config_id", label: "Config", text: true },
    { key: "platform", label: "Platform", text: true },
    { key: "new_logins", label: "New Logins", format: number },
    { key: "trial_purchased_d0", label: "D0 Trials", format: number },
    { key: "new_login_to_trial_d0_pct", label: "D0 Trial %", format: pct },
    { key: "subscription_199_charged_d1", label: "D1 Rs 199", format: number },
    { key: "subscription_499_charged_d1", label: "D1 Rs 499", format: number },
    { key: "trial_d0_to_subscription_d1_pct", label: "Trial to D1 Main", format: pct },
  ], 20);

  table("trialToPaidPriceTable", trialCohorts, [
    { key: "trial_start_date", label: "Trial Date", text: true, format: shortDate },
    { key: "maturity_status", label: "Maturity", text: true },
    { key: "subscription_price", label: "Main Price", format: money },
    { key: "trial_starts", label: "Trial Starts", format: number },
    { key: "converted_trials", label: "Converted", format: number },
    { key: "conversion_pct", label: "Conversion", format: pct },
    { key: "avg_days_to_convert", label: "Avg Days", format: (v) => Number(v || 0).toFixed(2) },
  ], 20);

  table("activeSubscriptionDailyTable", activeSubDaily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "active_paid_subscribers", label: "Active Paid", format: number },
    { key: "trial_active_subscribers", label: "Active Trials", format: number },
    { key: "mrr", label: "MRR Stock", format: money },
    { key: "net_mrr_movement", label: "Net MRR Move", format: money },
  ], 10);

  table("subscriberEngagementTable", subscriberEngagementSummary, [
    { key: "user_type", label: "Segment", text: true, format: (v) => String(v || "").replace("_", " ") },
    { key: "active_users", label: "Active Users", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "chat_minutes", label: "Chat Min", format: number },
    { key: "call_minutes", label: "Call Min", format: number },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 10);

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

  document.getElementById("paymentCards").innerHTML = [
    card("Initiated Orders", number(paymentKpis.initiated_orders), `${number(paymentKpis.successful_orders)} successful`),
    card("Payment Success", pct(paymentKpis.success_rate_pct), `${number(paymentKpis.failed_orders)} failed | ${number(paymentKpis.created_orders)} created`),
    card("Retries", number(paymentKpis.retry_users), "Users with more than one attempt"),
    card("Refunds", number(paymentKpis.refund_orders), `${money(paymentKpis.refund_amount)} refunded`),
  ].join("");
  const paymentDailyGrouped = groupedLine(paymentDaily, "day", "payment_type", "success_rate_pct");
  paymentDailyGrouped.labels = paymentDailyGrouped.labels.map(shortDate);
  chart("paymentDailyChart", "line", paymentDailyGrouped, {
    plugins: { title: { display: true, text: "Payment Success Rate by Source" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "rgba(255,255,255,0.10)" } } },
  });
  chart("paymentMethodChart", "bar", {
    labels: paymentMethod.slice(0, 10).map((row) => `${row.payment_type} | ${row.payment_method}`),
    datasets: [
      { label: "Initiated", data: paymentMethod.slice(0, 10).map((row) => row.initiated_orders), backgroundColor: COLORS.blue },
      { label: "Success rate %", data: paymentMethod.slice(0, 10).map((row) => row.success_rate_pct), backgroundColor: COLORS.green, yAxisID: "y1" },
    ],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "Payment Method Success" }, legend: { position: "bottom" } },
    scales: {
      x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } },
      y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false } },
    },
  });
  table("paymentMethodTable", paymentMethod, [
    { key: "payment_type", label: "Source", text: true },
    { key: "payment_method", label: "Method", text: true },
    { key: "initiated_orders", label: "Initiated", format: number },
    { key: "successful_orders", label: "Success", format: number },
    { key: "failed_orders", label: "Failed", format: number },
    { key: "success_rate_pct", label: "Success Rate", format: pct },
    { key: "paid_amount", label: "Paid Amount", format: money },
    { key: "refund_amount", label: "Refund", format: money },
  ], 20);
  table("paymentRetryTable", paymentRetry, [
    { key: "payment_type", label: "Source", text: true },
    { key: "retry_users", label: "Retry Users", format: number },
    { key: "retry_success_users", label: "Retry Success", format: number },
    { key: "retry_success_pct", label: "Retry Success %", format: pct },
    { key: "avg_attempts", label: "Avg Attempts", format: (v) => Number(v || 0).toFixed(2) },
  ], 10);
  table("paymentStatusTable", paymentStatus, [
    { key: "payment_type", label: "Source", text: true },
    { key: "status", label: "Status", text: true },
    { key: "initiated_orders", label: "Orders", format: number },
    { key: "users", label: "Users", format: number },
    { key: "paid_amount", label: "Paid Amount", format: money },
    { key: "success_rate_pct", label: "Success Rate", format: pct },
  ], 20);

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
  const mainPackFollowupRows = configRows.map((row) => ({
    trial_type: row.trial_type,
    followup_users: row.followup_users,
    main_199_buyers: row.main_199_buyers,
    main_499_buyers: row.main_499_buyers,
    followup_to_199_main_pct: safePercent(row.main_199_buyers, row.followup_users),
    followup_to_499_main_pct: safePercent(row.main_499_buyers, row.followup_users),
    main_199_share_pct: safePercent(row.main_199_buyers, Number(row.main_199_buyers || 0) + Number(row.main_499_buyers || 0)),
    main_499_share_pct: safePercent(row.main_499_buyers, Number(row.main_199_buyers || 0) + Number(row.main_499_buyers || 0)),
  }));
  const rs1Flow = configRows.find((row) => Number(row.trial_amount) === 1) || {};
  const rs49Flow = configRows.find((row) => Number(row.trial_amount) === 49) || {};
  const renderTrialFlow = (row) => [
    miniMetric("Follow-up", number(row.followup_users), `${pct(row.assigned_to_followup_pct)} of assigned users`),
    miniMetric("Paywall", number(row.paywall_shown_users), `${pct(row.followup_to_paywall_pct)} of follow-up`),
    miniMetric("Trial CTA", number(row.trial_cta_users), `${pct(row.paywall_to_trial_cta_pct)} of paywall users`),
    miniMetric("Trial Buyers", number(row.trial_buyers), `${pct(row.trial_cta_to_trial_purchase_pct)} of CTA users`),
    miniMetric("Main Buyers", number(row.main_plan_buyers), `${pct(row.trial_to_main_pct)} of trial buyers`),
    miniMetric("Main Split", `${number(row.main_499_buyers)} / ${number(row.main_199_buyers)}`, "Rs 499 / Rs 199 buyers"),
  ].join("");
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
  document.getElementById("mainPackFollowupCards").innerHTML = [
    actionCard("Rs 499 Follow-up to Main", pct(safePercent(funnelTotals.main_499_buyers, funnelTotals.followup_users)), `${number(funnelTotals.main_499_buyers)} buyers from ${number(funnelTotals.followup_users)} follow-up users`, "good"),
    actionCard("Rs 199 Follow-up to Main", pct(safePercent(funnelTotals.main_199_buyers, funnelTotals.followup_users)), `${number(funnelTotals.main_199_buyers)} buyers from ${number(funnelTotals.followup_users)} follow-up users`, "neutral"),
    actionCard("499 vs 199 Main Buyers", `${number(funnelTotals.main_499_buyers)} / ${number(funnelTotals.main_199_buyers)}`, `${pct(safePercent(funnelTotals.main_499_buyers, Number(funnelTotals.main_199_buyers || 0) + Number(funnelTotals.main_499_buyers || 0)))} of main buyers are Rs 499`, "neutral"),
  ].join("");
  document.getElementById("rs1TrialFlowCards").innerHTML = renderTrialFlow(rs1Flow);
  document.getElementById("rs49TrialFlowCards").innerHTML = renderTrialFlow(rs49Flow);

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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "rgba(255,255,255,0.10)" } } },
  });

  chart("trialPackMainSplitChart", "bar", {
    labels: configRows.map((row) => row.trial_type),
    datasets: [
      { label: "Rs 499 main buyers", data: configRows.map((row) => row.main_499_buyers), backgroundColor: COLORS.blue },
      { label: "Rs 199 main buyers", data: configRows.map((row) => row.main_199_buyers), backgroundColor: COLORS.gold },
    ],
  }, {
    plugins: { title: { display: true, text: "Main Plan Buyers by Trial Pack" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
  });

  chart("trialPackConversionChart", "bar", {
    labels: configRows.map((row) => row.trial_type),
    datasets: [
      { label: "Follow-up to trial %", data: configRows.map((row) => row.followup_to_trial_pct), backgroundColor: COLORS.teal },
      { label: "Trial to main %", data: configRows.map((row) => row.trial_to_main_pct), backgroundColor: COLORS.green },
      { label: "Follow-up to main %", data: configRows.map((row) => row.followup_to_main_pct), backgroundColor: COLORS.rose },
    ],
  }, {
    plugins: { title: { display: true, text: "Rs 1 vs Rs 49 Conversion Comparison" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: "rgba(255,255,255,0.10)" } } },
  });

  chart("mainPackFollowupChart", "bar", {
    labels: mainPackFollowupRows.map((row) => row.trial_type),
    datasets: [
      { label: "Rs 499 follow-up to main %", data: mainPackFollowupRows.map((row) => row.followup_to_499_main_pct), backgroundColor: COLORS.blue },
      { label: "Rs 199 follow-up to main %", data: mainPackFollowupRows.map((row) => row.followup_to_199_main_pct), backgroundColor: COLORS.gold },
    ],
  }, {
    plugins: { title: { display: true, text: "Rs 199 vs Rs 499 Follow-up to Main Conversion" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Follow-up to main %" } } },
  });

  table("mainPackFollowupTable", mainPackFollowupRows, [
    { key: "trial_type", label: "Trial Pack", text: true },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "main_499_buyers", label: "Rs 499 Buyers", format: number },
    { key: "followup_to_499_main_pct", label: "Follow-up to Rs 499", format: pct },
    { key: "main_499_share_pct", label: "Rs 499 Main Share", format: pct },
    { key: "main_199_buyers", label: "Rs 199 Buyers", format: number },
    { key: "followup_to_199_main_pct", label: "Follow-up to Rs 199", format: pct },
    { key: "main_199_share_pct", label: "Rs 199 Main Share", format: pct },
  ], 10);

  table("configFunnelTable", m.config_funnel, [
    { key: "config_id", label: "Config ID", text: true },
    { key: "trial_type", label: "Trial Pack", text: true },
    { key: "trial_amount", label: "Trial Amt", format: money },
    { key: "assigned_users", label: "Assigned", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "paywall_shown_users", label: "Paywall", format: number },
    { key: "trial_cta_users", label: "Trial CTA", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_plan_buyers", label: "Main Buyers", format: number },
    { key: "trial_cta_199_pack_users", label: "CTA Rs 199", format: number },
    { key: "trial_cta_499_pack_users", label: "CTA Rs 499", format: number },
    { key: "main_199_buyers", label: "Main Rs 199", format: number },
    { key: "main_499_buyers", label: "Main Rs 499", format: number },
    { key: "assigned_to_followup_pct", label: "Assigned to Follow-up", format: pct },
    { key: "followup_to_paywall_pct", label: "Follow-up to Paywall", format: pct },
    { key: "paywall_to_trial_cta_pct", label: "Paywall to CTA", format: pct },
    { key: "trial_cta_to_trial_purchase_pct", label: "CTA to Trial", format: pct },
    { key: "followup_to_trial_pct", label: "Follow-up to Trial", format: pct },
    { key: "trial_to_main_pct", label: "Trial to Main", format: pct },
    { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
  ]);

  chart("newOldSubscriberFunnelChart", "bar", {
    labels: configCohortRows.map((row) => `${row.trial_type} | ${row.user_cohort}`),
    datasets: [
      { label: "Follow-up", data: configCohortRows.map((row) => row.followup_users), backgroundColor: COLORS.teal },
      { label: "Trial buyers", data: configCohortRows.map((row) => row.trial_buyers), backgroundColor: COLORS.rose },
      { label: "Main buyers", data: configCohortRows.map((row) => row.main_plan_buyers), backgroundColor: COLORS.green },
      { label: "Follow-up to main %", data: configCohortRows.map((row) => row.followup_to_main_pct), backgroundColor: COLORS.gold, yAxisID: "y1" },
    ],
  }, {
    indexAxis: "y",
    plugins: { title: { display: true, text: "New vs Old Subscriber Funnel by Trial Pack" }, legend: { position: "bottom" } },
    scales: {
      x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Users" } },
      y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Conversion %" } },
    },
  });
  table("newOldSubscriberFunnelTable", configCohortRows, [
    { key: "selection", label: "Selection", text: true },
    { key: "user_cohort", label: "User Type", text: true },
    { key: "trial_type", label: "Trial Pack", text: true },
    { key: "assigned_users", label: "Assigned", format: number },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "paywall_shown_users", label: "Paywall", format: number },
    { key: "trial_cta_users", label: "Trial CTA", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_plan_buyers", label: "Main Buyers", format: number },
    { key: "main_499_buyers", label: "Main Rs 499", format: number },
    { key: "main_199_buyers", label: "Main Rs 199", format: number },
    { key: "followup_to_trial_pct", label: "Follow-up to Trial", format: pct },
    { key: "trial_to_main_pct", label: "Trial to Main", format: pct },
    { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
    { key: "main_499_share_pct", label: "Rs 499 Main Share", format: pct },
  ], 12);

  const dailyFunnelRows = dailyConfigFunnelRows();
  const dailyFunnelTotals = dashboardDateOptions().map((date) => {
    const rows = dailyFunnelRows.filter((row) => row.date === date);
    return rows.reduce((acc, row) => ({
      date,
      assigned_users: acc.assigned_users + Number(row.assigned_users || 0),
      followup_users: acc.followup_users + Number(row.followup_users || 0),
      paywall_shown_users: acc.paywall_shown_users + Number(row.paywall_shown_users || 0),
      trial_cta_users: acc.trial_cta_users + Number(row.trial_cta_users || 0),
      trial_buyers: acc.trial_buyers + Number(row.trial_buyers || 0),
      main_plan_buyers: acc.main_plan_buyers + Number(row.main_plan_buyers || 0),
      main_199_buyers: acc.main_199_buyers + Number(row.main_199_buyers || 0),
      main_499_buyers: acc.main_499_buyers + Number(row.main_499_buyers || 0),
    }), {
      date,
      assigned_users: 0,
      followup_users: 0,
      paywall_shown_users: 0,
      trial_cta_users: 0,
      trial_buyers: 0,
      main_plan_buyers: 0,
      main_199_buyers: 0,
      main_499_buyers: 0,
    });
  });
  const dailyFunnelDetail = dailyFunnelTotals.map((row) => ({
    ...row,
    assigned_to_followup_pct: safePercent(row.followup_users, row.assigned_users),
    followup_to_paywall_pct: safePercent(row.paywall_shown_users, row.followup_users),
    paywall_to_trial_cta_pct: safePercent(row.trial_cta_users, row.paywall_shown_users),
    cta_to_trial_pct: safePercent(row.trial_buyers, row.trial_cta_users),
    followup_to_trial_pct: safePercent(row.trial_buyers, row.followup_users),
    trial_to_main_pct: safePercent(row.main_plan_buyers, row.trial_buyers),
    followup_to_main_pct: safePercent(row.main_plan_buyers, row.followup_users),
  }));
  chart("funnelDailyStageTrendChart", "line", {
    labels: dailyFunnelTotals.map((row) => shortDate(row.date)),
    datasets: [
      { label: "Follow-up", data: dailyFunnelTotals.map((row) => row.followup_users), borderColor: COLORS.teal, tension: 0.25 },
      { label: "Paywall", data: dailyFunnelTotals.map((row) => row.paywall_shown_users), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Trial CTA", data: dailyFunnelTotals.map((row) => row.trial_cta_users), borderColor: COLORS.gold, tension: 0.25 },
      { label: "Trial buyers", data: dailyFunnelTotals.map((row) => row.trial_buyers), borderColor: COLORS.rose, tension: 0.25 },
      { label: "Main buyers", data: dailyFunnelTotals.map((row) => row.main_plan_buyers), borderColor: COLORS.green, tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Daily Funnel Volume Movement" }, legend: { position: "bottom" } },
  });

  const conversionTrend = groupedLine(dailyFunnelRows, "date", "trial_type", "followup_to_trial_pct");
  conversionTrend.labels = conversionTrend.labels.map(shortDate);
  conversionTrend.datasets = [
    ...conversionTrend.datasets.map((dataset) => ({ ...dataset, label: `${dataset.label} follow-up to trial`, borderColor: dataset.label.includes("49") ? COLORS.gold : COLORS.teal })),
    ...groupedLine(dailyFunnelRows, "date", "trial_type", "followup_to_main_pct").datasets.map((dataset) => ({
      ...dataset,
      label: `${dataset.label} follow-up to main`,
      borderColor: dataset.label.includes("49") ? COLORS.rose : COLORS.green,
      borderDash: [6, 4],
    })),
  ];
  chart("funnelDailyConversionTrendChart", "line", conversionTrend, {
    plugins: { title: { display: true, text: "Daily Rs 1 vs Rs 49 Conversion Rates" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Conversion %" } } },
  });

  const funnelStageRows = currentFunnelStageRows(configRows);
  chart("funnelDropoffChart", "bar", {
    labels: funnelStageRows.map((row) => row.stage),
    datasets: [
      { label: "Users", data: funnelStageRows.map((row) => row.users), backgroundColor: COLORS.blue },
      { label: "Step conversion %", data: funnelStageRows.map((row) => row.conversion_pct), backgroundColor: COLORS.gold, yAxisID: "y1" },
    ],
  }, {
    plugins: { title: { display: true, text: "Reporting Period Funnel Drop-off" }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Users" } },
      y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Step conversion %" } },
    },
  });

  const planFunnelRows = (m.subscription_plan_performance || []).filter((row) => Number(row.followup_users || 0) > 0);
  chart("planFollowupConversionBar", "bar", {
    labels: planFunnelRows.map((row) => row.plan_code),
    datasets: [
      { label: "Follow-up to trial %", data: planFunnelRows.map((row) => row.followup_to_trial_pct), backgroundColor: COLORS.teal },
      { label: "Follow-up to main %", data: planFunnelRows.map((row) => row.followup_to_main_pct), backgroundColor: COLORS.green },
      { label: "Same-period main / trial %", data: planFunnelRows.map((row) => row.main_to_trial_buyer_pct), backgroundColor: COLORS.gold },
    ],
  }, {
    plugins: { title: { display: true, text: "Plan-Level Follow-up Conversion" }, legend: { position: "bottom" } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Conversion %" } } },
  });

  table("planFunnelTable", planFunnelRows, [
    { key: "selection", label: "Selection", text: true },
    { key: "plan_code", label: "Plan", text: true },
    { key: "trial_type", label: "Trial Cohort", text: true },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_buyers", label: "Main Buyers", format: number },
    { key: "followup_to_trial_pct", label: "Follow-up to Trial", format: pct },
    { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
    { key: "main_to_trial_buyer_pct", label: "Same-Period Main / Trial", format: pct },
  ], 20);

  table("dailyFunnelTrendTable", dailyFunnelDetail, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "followup_users", label: "Follow-up", format: number },
    { key: "paywall_shown_users", label: "Paywall", format: number },
    { key: "trial_cta_users", label: "Trial CTA", format: number },
    { key: "trial_buyers", label: "Trial Buyers", format: number },
    { key: "main_plan_buyers", label: "Main Buyers", format: number },
    { key: "followup_to_trial_pct", label: "Follow-up to Trial", format: pct },
    { key: "trial_to_main_pct", label: "Trial to Main", format: pct },
    { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
  ], 10);

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
    scales: { x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } }, y: { grid: { display: false } } },
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
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
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

function marketingPlanRows(k) {
  return [
    { metric: "Trials @ Re 1", users: k.trials_1 || 0, share_pct: safePercent(k.trials_1, k.trials), note: "Share of trial starts" },
    { metric: "Trials @ Rs 49", users: k.trials_49 || 0, share_pct: safePercent(k.trials_49, k.trials), note: "Share of trial starts" },
    { metric: "Paid Subs @ 199", users: k.paid_subs_199 || 0, share_pct: safePercent(k.paid_subs_199, k.subscribers), note: "Share of paid subs" },
    { metric: "Paid Subs @ 499", users: k.paid_subs_499 || 0, share_pct: safePercent(k.paid_subs_499, k.subscribers), note: "Share of paid subs" },
    { metric: "Paid upgrades @ 300", users: k.paid_upgrades_300 || 0, share_pct: safePercent(k.paid_upgrades_300, k.subscribers), note: "Upgrade count" },
  ];
}

function marketingCoverageRows(mk) {
  const groups = [
    ["Core", ["date", "installs", "spend", "subscription_spend", "new_logins", "subscription_new_logins"]],
    ["Subscription Funnel", ["trials", "trials_1", "trials_49", "subscribers", "paid_subs_199", "paid_subs_499", "paid_upgrades_300"]],
    ["Revenue", ["revenue", "trial_revenue", "sub_revenue", "arpu_subs", "arpu_subs_excl_trials", "mix_499"]],
    ["Engagement / Retention", ["dau", "subscriber_dau", "all_d1_retention", "all_d3_retention", "all_d7_retention", "sub_d1_retention", "sub_d3_retention", "sub_d7_retention"]],
  ];
  return groups.flatMap(([group, keys]) => keys.map((key) => ({
    metric: `${group}: ${key.replaceAll("_", " ")}`,
    csv_column: mk.mapping?.[key] || "Not present",
    status: mk.mapping?.[key] ? "Mapped" : "Missing",
  })));
}

function renderMarketing(data) {
  const mk = effectiveMarketingData(data);
  const k = mk.kpis || {};
  const sourceOk = mk.source_status === "available" || mk.source_status === "uploaded";
  const isOverview = mk.marketing_format === "subscription_overview";
  const uploadFreshness = MARKETING_UPLOAD_STATE ? marketingUploadFreshness(data) : null;
  setupMarketingUploadControls(data);
  document.getElementById("marketingNote").textContent = uploadFreshness?.stale
    ? `Saved marketing CSV is current through ${shortDate(uploadFreshness.maxDate)}. Upload new CSV for ${shortDate(uploadFreshness.selectedMax)} before using this date.`
    : (sourceOk
      ? (isOverview ? "Subscription Overview CSV is powering spend, subscription funnel, CAC, ARPU, and retention metrics." : (mk.source_status === "uploaded" ? "Campaign spend is loaded from your uploaded CSV for this browser session." : "Campaign spend is loaded from the configured daily Campaign Data feed."))
      : (mk.source_message || "Marketing spend feed is not connected yet."));
  document.getElementById("marketingCards").innerHTML = isOverview
    ? [
      card("Spend", money(k.spend), "Total marketing spends"),
      card("Sub Spend", formatNullableMoney(k.subscription_spend), "CAC base for subscription funnel"),
      card("Trial Starts", number(k.trials), `${number(k.trials_1)} Rs 1 | ${number(k.trials_49)} Rs 49`),
      card("Paid Subs", number(k.subscribers), `${number(k.paid_subs_199)} Rs 199 | ${number(k.paid_subs_499)} Rs 499`),
      card("Trial CAC", formatNullableMoney(k.trial_cac), "Sub spend / trial starts"),
      card("Subscriber CAC", formatNullableMoney(k.subscriber_cac), "Sub spend / paid subs"),
      card("499 Mix", pct(k.mix_499_pct), "Paid subscriber mix"),
      card("Sub Revenue", money(k.sub_revenue), `${money(k.trial_revenue)} trial revenue`),
      card("Metric Coverage", `${number(k.mapped_fields || 0)}`, `${number(k.overview_required_fields || 0)}/7 core fields mapped`),
    ].join("")
    : [
      card("Spend", money(k.spend), sourceOk ? (mk.source_status === "uploaded" ? "Uploaded CSV" : "Campaign Data feed") : "Source pending"),
      card("Sub Spend", formatNullableMoney(k.subscription_spend), "Used for subscription CAC when present"),
      card("Installs", number(k.installs), "From marketing CSV"),
      card("Clicks", number(k.clicks), `${pct(k.ctr_pct)} CTR`),
      card("CPI", formatNullableMoney(k.cpi), "Spend / installs"),
      card("Trial CAC", formatNullableMoney(k.trial_cac), "Spend / trials"),
      card("Subscriber CAC", formatNullableMoney(k.subscriber_cac), "Spend / subscribers"),
      card("ROAS", k.roas_pct === null || k.roas_pct === undefined ? "Pending" : pct(k.roas_pct), "Revenue / spend"),
      card("Payback", k.payback_days === null || k.payback_days === undefined ? "Pending" : `${k.payback_days} days`, "Spend recovery pace"),
    ].join("");

  const daily = mk.daily || [];
  chart("marketingSpendRevenueChart", "line", {
    labels: daily.map((row) => shortDate(row.date)),
    datasets: [
      { label: "Spend", data: daily.map((row) => row.spend), borderColor: COLORS.rose, backgroundColor: "rgba(190,52,85,0.12)", tension: 0.25 },
      { label: "Revenue", data: daily.map((row) => row.revenue), borderColor: COLORS.green, tension: 0.25 },
      { label: "Trials", data: daily.map((row) => row.trials), borderColor: COLORS.teal, yAxisID: "y1", tension: 0.25 },
      { label: "Subscribers", data: daily.map((row) => row.subscribers), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Daily Spend, Revenue and Conversion Volume" }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Spend / revenue" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Trials / subscribers" } },
    },
  });

  const campaigns = mk.campaigns || [];
  const planRows = marketingPlanRows(k);
  if (isOverview) {
    chart("marketingCampaignChart", "bar", {
      labels: planRows.map((row) => row.metric),
      datasets: [{ label: "Users", data: planRows.map((row) => row.users), backgroundColor: [COLORS.teal, COLORS.gold, COLORS.blue, COLORS.green, COLORS.rose] }],
    }, {
      plugins: { title: { display: true, text: "Trial and Paid Subscription Mix" }, legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
    });
    chart("marketingClickInstallChart", "line", {
      labels: daily.map((row) => shortDate(row.date)),
      datasets: [
        { label: "All D1 retention", data: daily.map((row) => row.all_d1_retention), borderColor: COLORS.blue, tension: 0.25 },
        { label: "Sub D1 retention", data: daily.map((row) => row.sub_d1_retention), borderColor: COLORS.teal, tension: 0.25 },
        { label: "ARPU excl trials", data: daily.map((row) => row.arpu_subs_excl_trials), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
      ],
    }, {
      plugins: { title: { display: true, text: "Retention and ARPU Movement" }, legend: { position: "bottom" } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Retention %" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "ARPU" } },
      },
    });
  } else {
    chart("marketingCampaignChart", "bar", {
      labels: campaigns.slice(0, 10).map((row) => row.campaign),
      datasets: [
        { label: "Spend", data: campaigns.slice(0, 10).map((row) => row.spend), backgroundColor: COLORS.blue },
        { label: "CPI", data: campaigns.slice(0, 10).map((row) => row.cpi), backgroundColor: COLORS.gold, yAxisID: "y1" },
      ],
    }, {
      indexAxis: "y",
      plugins: { title: { display: true, text: "Campaign Spend and Install Efficiency" }, legend: { position: "bottom" } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } },
      },
    });
    chart("marketingClickInstallChart", "line", {
      labels: daily.map((row) => shortDate(row.date)),
      datasets: [
        { label: "Installs", data: daily.map((row) => row.installs), borderColor: COLORS.blue, tension: 0.25 },
        { label: "Clicks", data: daily.map((row) => row.clicks), borderColor: COLORS.teal, tension: 0.25 },
        { label: "CTR %", data: daily.map((row) => row.ctr_pct), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
      ],
    }, {
      plugins: { title: { display: true, text: "Daily Click, Install and CTR Movement" }, legend: { position: "bottom" } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Clicks / installs" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "CTR %" } },
      },
    });
  }

  document.getElementById("marketingMappingTitle").textContent = isOverview ? "Metric Coverage" : "CSV Field Mapping";
  document.getElementById("marketingDailyTitle").textContent = isOverview ? "Daily Subscription Overview" : "Daily Spend and Return";
  document.getElementById("marketingCampaignTitle").textContent = isOverview ? "Trial and Paid Plan Mix" : "Campaign CAC and ROAS";
  document.getElementById("marketingPlatformTitle").textContent = isOverview ? "Retention and ARPU Detail" : "Platform Efficiency";
  const mappingRows = isOverview ? marketingCoverageRows(mk) : Object.entries(MARKETING_COLUMN_CANDIDATES).map(([metric]) => ({
    metric: metric.replaceAll("_", " "),
    csv_column: mk.mapping?.[metric] || "Not present",
    status: mk.mapping?.[metric] ? "Mapped" : (["date", "spend"].includes(metric) ? "Needed" : "Optional"),
  }));
  table("marketingMappingTable", mappingRows, [
    { key: "metric", label: "Metric", text: true },
    { key: "csv_column", label: "CSV Column", text: true },
    { key: "status", label: "Status", text: true },
  ], 20);

  table("marketingDailyTable", daily, [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "spend", label: "Spend", format: money },
    { key: "subscription_spend", label: "Sub Spend", format: formatNullableMoney },
    { key: "installs", label: "Installs", format: number },
    { key: "impressions", label: "Impressions", format: number },
    { key: "clicks", label: "Clicks", format: number },
    { key: "ctr_pct", label: "CTR", format: pct },
    { key: "cpc", label: "CPC", format: formatNullableMoney },
    { key: "cpi", label: "CPI", format: formatNullableMoney },
    { key: "new_logins", label: "Logins", format: number },
    { key: "subscription_new_logins", label: "Sub Logins", format: number },
    { key: "trials", label: "Trials", format: number },
    { key: "trials_1", label: "Trials Rs 1", format: number },
    { key: "trials_49", label: "Trials Rs 49", format: number },
    { key: "subscribers", label: "Subscribers", format: number },
    { key: "paid_subs_199", label: "Subs Rs 199", format: number },
    { key: "paid_subs_499", label: "Subs Rs 499", format: number },
    { key: "mix_499", label: "499 Mix", format: pct },
    { key: "revenue", label: "Revenue", format: money },
    { key: "trial_revenue", label: "Trial Rev", format: money },
    { key: "sub_revenue", label: "Sub Rev", format: money },
    { key: "cost_per_trial", label: "Trial CAC", format: formatNullableMoney },
    { key: "subscriber_cac", label: "Sub CAC", format: formatNullableMoney },
    { key: "arpu_subs_excl_trials", label: "ARPU excl Trial", format: formatNullableMoney },
    { key: "roas_pct", label: "ROAS", format: pct },
  ], 14);
  table("marketingCampaignTable", isOverview ? planRows : campaigns, isOverview ? [
    { key: "metric", label: "Metric", text: true },
    { key: "users", label: "Users", format: number },
    { key: "share_pct", label: "Share", format: pct },
    { key: "note", label: "Note", text: true },
  ] : [
    { key: "campaign", label: "Campaign", text: true },
    { key: "campaign_type", label: "Type", text: true },
    { key: "campaign_id", label: "Campaign ID", text: true },
    { key: "spend", label: "Spend", format: money },
    { key: "subscription_spend", label: "Sub Spend", format: formatNullableMoney },
    { key: "installs", label: "Installs", format: number },
    { key: "impressions", label: "Impressions", format: number },
    { key: "clicks", label: "Clicks", format: number },
    { key: "ctr_pct", label: "CTR", format: pct },
    { key: "cpc", label: "CPC", format: formatNullableMoney },
    { key: "cpi", label: "CPI", format: formatNullableMoney },
    { key: "new_logins", label: "Logins", format: number },
    { key: "trials", label: "Trials", format: number },
    { key: "trials_1", label: "Trials Rs 1", format: number },
    { key: "trials_49", label: "Trials Rs 49", format: number },
    { key: "subscribers", label: "Subscribers", format: number },
    { key: "paid_subs_199", label: "Subs Rs 199", format: number },
    { key: "paid_subs_499", label: "Subs Rs 499", format: number },
    { key: "cost_per_trial", label: "Cost / Trial", format: formatNullableMoney },
    { key: "subscriber_cac", label: "Sub CAC", format: formatNullableMoney },
    { key: "roas_pct", label: "ROAS", format: pct },
  ], 20);
  table("marketingPlatformTable", isOverview ? daily : (mk.platforms || []), isOverview ? [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "dau", label: "DAU", format: number },
    { key: "subscriber_dau", label: "Sub DAU", format: number },
    { key: "all_d1_retention", label: "All D1", format: pct },
    { key: "all_d3_retention", label: "All D3", format: pct },
    { key: "all_d7_retention", label: "All D7", format: pct },
    { key: "sub_d1_retention", label: "Sub D1", format: pct },
    { key: "sub_d3_retention", label: "Sub D3", format: pct },
    { key: "sub_d7_retention", label: "Sub D7", format: pct },
    { key: "arpu_subs", label: "ARPU", format: formatNullableMoney },
    { key: "arpu_subs_excl_trials", label: "ARPU excl Trial", format: formatNullableMoney },
  ] : [
    { key: "platform", label: "Platform", text: true },
    { key: "spend", label: "Spend", format: money },
    { key: "subscription_spend", label: "Sub Spend", format: formatNullableMoney },
    { key: "installs", label: "Installs", format: number },
    { key: "impressions", label: "Impressions", format: number },
    { key: "clicks", label: "Clicks", format: number },
    { key: "ctr_pct", label: "CTR", format: pct },
    { key: "cpc", label: "CPC", format: formatNullableMoney },
    { key: "cpi", label: "CPI", format: formatNullableMoney },
    { key: "trials", label: "Trials", format: number },
    { key: "subscribers", label: "Subscribers", format: number },
    { key: "cost_per_trial", label: "Cost / Trial", format: formatNullableMoney },
    { key: "subscriber_cac", label: "Sub CAC", format: formatNullableMoney },
    { key: "login_to_trial_pct", label: "Login to Trial", format: pct },
    { key: "roas_pct", label: "ROAS", format: pct },
  ], 12);
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
  const stickiness = e.stickiness_kpis || {};
  document.getElementById("engagementNote").textContent = "Average time uses Mixpanel $ae_session_length; BIM is campaign_name = Bot Initiated Messages.";
  document.getElementById("engagementCards").innerHTML = [
    card("Active Users", number(e.kpis.active_users), `${number(e.kpis.sessions)} app sessions`),
    card("Avg Time / User", `${e.kpis.avg_minutes_per_user}m`, `${e.kpis.avg_minutes_per_session}m per session`),
    card("Total Time", `${number(e.kpis.total_minutes)}m`, "Across app sessions"),
    card("DAU / MAU", pct(stickiness.dau_mau_pct), `${number(stickiness.dau)} DAU | ${number(stickiness.mau)} MAU`),
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

  document.getElementById("stickinessCards").innerHTML = [
    card("DAU", number(stickiness.dau), `Avg L7 DAU ${number(stickiness.avg_dau_l7)}`),
    card("WAU", number(stickiness.wau), `${pct(stickiness.wau_mau_pct)} of MAU`),
    card("MAU", number(stickiness.mau), "Completed-session active users"),
    card("DAU / MAU", pct(stickiness.dau_mau_pct), "Habit ratio"),
  ].join("");
  chart("stickinessDailyChart", "line", {
    labels: (e.stickiness_daily || []).map((row) => shortDate(row.date)),
    datasets: [
      { label: "DAU", data: (e.stickiness_daily || []).map((row) => row.dau), borderColor: COLORS.blue, tension: 0.25 },
      { label: "Sessions/user", data: (e.stickiness_daily || []).map((row) => row.sessions_per_user), borderColor: COLORS.gold, yAxisID: "y1", tension: 0.25 },
      { label: "Minutes/user", data: (e.stickiness_daily || []).map((row) => row.minutes_per_user), borderColor: COLORS.teal, yAxisID: "y1", tension: 0.25 },
    ],
  }, {
    plugins: { title: { display: true, text: "Daily Stickiness and Depth" }, legend: { position: "bottom" } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "DAU" } },
      y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Per user" } },
    },
  });
  chart("frequencyChart", "bar", {
    labels: [...(e.frequency_l7 || []), ...(e.frequency_l28 || [])].map((row) => `${row.window} ${row.bucket}`),
    datasets: [{ label: "Users", data: [...(e.frequency_l7 || []), ...(e.frequency_l28 || [])].map((row) => row.users), backgroundColor: COLORS.teal }],
  }, {
    plugins: { title: { display: true, text: "L7 and L28 Frequency Buckets" }, legend: { display: false } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } } },
  });
  table("frequencyL7Table", e.frequency_l7 || [], [
    { key: "bucket", label: "Active Days", text: true },
    { key: "users", label: "Users", format: number },
    { key: "user_share_pct", label: "Share", format: pct },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 8);
  table("frequencyL28Table", e.frequency_l28 || [], [
    { key: "bucket", label: "Active Days", text: true },
    { key: "users", label: "Users", format: number },
    { key: "user_share_pct", label: "Share", format: pct },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 8);
  table("stickinessDailyTable", e.stickiness_daily || [], [
    { key: "date", label: "Date", text: true, format: shortDate },
    { key: "dau", label: "DAU", format: number },
    { key: "sessions", label: "Sessions", format: number },
    { key: "minutes", label: "Minutes", format: number },
    { key: "sessions_per_user", label: "Sessions/User", format: (v) => Number(v || 0).toFixed(2) },
    { key: "minutes_per_user", label: "Min/User", format: (v) => Number(v || 0).toFixed(2) },
  ], 28);

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
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" }, title: { display: true, text: "Opens / users" } },
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
    plugins: { title: { display: true, text: "Data Quality Status" }, legend: { display: false } },
    scales: { x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.10)" } }, y: { grid: { display: false } } },
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
    await fetchLiveStatus();
    SELECTED_PERIOD = DASHBOARD_DATA.metadata.default_period || "weekly";
    MARKETING_UPLOAD_STATE = loadMarketingUploadState();
    ACTIVE_SECTION = sectionFromHash();
    setupThemeToggle();
    setupPeriodControls();
    setupDayDownloadControls();
    setupTabs();
    setupDrilldowns();
    setupSectionNav();
    renderDashboard();
  } catch (error) {
    document.getElementById("freshness").textContent = "Could not load dashboard data.";
    document.body.insertAdjacentHTML("afterbegin", `<div class="panel" style="margin:16px">Data load failed: ${error.message}</div>`);
  }
}

function selectedData() {
  if (SELECTED_PERIOD === "daily" && SELECTED_DAY) {
    return DASHBOARD_DATA.periods?.[`daily_${SELECTED_DAY}`] || DASHBOARD_DATA.periods?.daily || DASHBOARD_DATA;
  }
  return DASHBOARD_DATA.periods?.[SELECTED_PERIOD] || DASHBOARD_DATA;
}

function setupPeriodControls() {
  const controls = document.getElementById("periodControls");
  controls.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === SELECTED_PERIOD);
    button.onclick = () => {
      SELECTED_PERIOD = button.dataset.period;
      if (SELECTED_PERIOD === "daily" && !SELECTED_DAY) {
        const days = dashboardDateOptions();
        SELECTED_DAY = days[days.length - 1] || null;
      }
      controls.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.period === SELECTED_PERIOD));
      setupDayDownloadControls();
      renderDashboard();
    };
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
  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = link.getAttribute("href").replace("#", "");
      showSectionPage(targetId, { updateHash: true, rerender: true });
    });
  });
  window.addEventListener("hashchange", () => {
    showSectionPage(sectionFromHash(), { updateHash: false, rerender: true });
  });
  showSectionPage(ACTIVE_SECTION, { updateHash: false, rerender: false });
}

function sectionFromHash() {
  const id = window.location.hash.replace("#", "");
  return SECTION_IDS.includes(id) ? id : "monetization";
}

function resizeVisibleCharts() {
  window.requestAnimationFrame(() => {
    Object.values(CHARTS).forEach((chartInstance) => {
      chartInstance.resize();
      chartInstance.update("none");
    });
  });
}

function showSectionPage(sectionId, options = {}) {
  const id = SECTION_IDS.includes(sectionId) ? sectionId : "monetization";
  ACTIVE_SECTION = id;
  document.querySelectorAll(".band").forEach((section) => {
    section.classList.toggle("is-hidden", section.id !== id);
  });
  document.querySelectorAll(".source-note").forEach((section) => {
    section.classList.toggle("is-hidden", id !== "coverage");
  });
  document.querySelectorAll(".dashboard-guide, .insight-strip").forEach((section) => {
    section.classList.toggle("is-hidden", id !== "monetization");
  });
  document.querySelectorAll(".section-nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
  });
  if (options.updateHash && window.location.hash !== `#${id}`) {
    history.pushState(null, "", `#${id}`);
  }
  if (options.rerender) {
    renderDashboard();
    resizeVisibleCharts();
  }
  if (options.updateHash) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function renderDataPolicy(meta) {
  const policyRows = [
    ["Published Dataset", "Dashboard stores only the latest aggregated reporting dataset"],
    ["Refresh Cadence", "Each refresh replaces the previous published dashboard view"],
    ["Source Privacy", "Raw SQL rows, Mixpanel exports, user-level event rows, and credentials are not stored in the dashboard repository"],
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

function businessSourceNotes(notes = []) {
  const replacements = [
    "Date selection updates every metric, funnel, chart, and export for the selected reporting period.",
  ];
  const filtered = notes.filter((note) => !/preloaded|GitHub Pages|local dashboard server|api\/dashboard/i.test(note));
  return [...filtered, ...replacements];
}

function detailMetric(label, value, sub = "") {
  return `
    <article class="detail-metric">
      <div class="detail-metric-label">${escapeHtml(label)}</div>
      <div class="detail-metric-value">${value}</div>
      <div class="detail-metric-sub">${sub}</div>
    </article>
  `;
}

function detailMetrics(metrics) {
  return `<div class="detail-metric-grid">${metrics.join("")}</div>`;
}

function detailTable(title, rows, columns, limit = 8) {
  const sourceRows = (rows || []).slice(0, limit);
  if (!sourceRows.length) return "";
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="table-wrap detail-table-wrap">
        <table>
          <thead>
            <tr>${columns.map((c) => `<th class="${c.text ? "text" : ""}">${escapeHtml(c.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${sourceRows
              .map((row) => `
                <tr>
                  ${columns
                    .map((c) => {
                      const value = c.format ? c.format(row[c.key], row) : row[c.key];
                      return `<td class="${c.text ? "text" : ""}">${escapeHtml(value)}</td>`;
                    })
                    .join("")}
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function detailNote(title, text) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function newOldRevenueSplitRows(m, family = null) {
  const rows = family
    ? (m.daily_family_user_cohort || []).filter((row) => row.family === family)
    : (m.daily_family_user_cohort || []);
  const grouped = rows.reduce((acc, row) => {
    const key = `${family ? row.family : row.family_label || familyLabel(row.family)}|${row.user_cohort}`;
    if (!acc[key]) {
      acc[key] = {
        family_label: row.family_label || familyLabel(row.family),
        user_cohort: row.user_cohort,
        revenue: 0,
        transactions: 0,
        payers: 0,
      };
    }
    acc[key].revenue += Number(row.revenue || 0);
    acc[key].transactions += Number(row.transactions || 0);
    acc[key].payers += Number(row.payers || 0);
    return acc;
  }, {});
  const out = Object.values(grouped);
  const totalRevenue = out.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  out.forEach((row) => {
    row.avg_transaction = row.transactions ? Number(row.revenue || 0) / Number(row.transactions || 0) : 0;
    row.revenue_share_pct = safePercent(row.revenue, totalRevenue);
  });
  return out.sort((a, b) => String(a.family_label).localeCompare(String(b.family_label)) || Number(b.revenue || 0) - Number(a.revenue || 0));
}

function newOldRevenueSplitTable(m, family = null, title = "New vs Old Revenue Split") {
  return detailTable(title, newOldRevenueSplitRows(m, family), [
    ...(family ? [] : [{ key: "family_label", label: "Revenue Stream", text: true }]),
    { key: "user_cohort", label: "User Type", text: true },
    { key: "revenue", label: "Revenue", format: money },
    { key: "revenue_share_pct", label: "Share", format: pct },
    { key: "payers", label: "Payers", format: number },
    { key: "transactions", label: "Txns", format: number },
    { key: "avg_transaction", label: "Avg Txn", format: money },
  ], family ? 6 : 12);
}

function subscriptionNewOldTables(m) {
  return `
    ${detailTable("New vs Old Subscription Pack Buyers", m.subscription_stage_by_user_cohort, [
      { key: "user_cohort", label: "User Type", text: true },
      { key: "stage", label: "Stage", text: true },
      { key: "amount", label: "Amount", format: money },
      { key: "payers", label: "Buyers", format: number },
      { key: "revenue", label: "Revenue", format: money },
      { key: "transactions", label: "Txns", format: number },
      { key: "revenue_share_pct", label: "Sub Share", format: pct },
    ], 12)}
    ${detailTable("New vs Old Subscriber Funnel", m.config_funnel_by_user_cohort, [
      { key: "user_cohort", label: "User Type", text: true },
      { key: "trial_type", label: "Trial Pack", text: true },
      { key: "followup_users", label: "Follow-up", format: number },
      { key: "paywall_shown_users", label: "Paywall", format: number },
      { key: "trial_cta_users", label: "Trial CTA", format: number },
      { key: "trial_buyers", label: "Trial Buyers", format: number },
      { key: "main_plan_buyers", label: "Main Buyers", format: number },
      { key: "main_499_buyers", label: "Rs 499", format: number },
      { key: "main_199_buyers", label: "Rs 199", format: number },
      { key: "followup_to_trial_pct", label: "F to Trial", format: pct },
      { key: "trial_to_main_pct", label: "Trial to Main", format: pct },
      { key: "followup_to_main_pct", label: "F to Main", format: pct },
    ], 8)}
  `;
}

function monetizationDetail(data) {
  const m = data.monetization || {};
  const k = m.kpis?.current || {};
  const g7 = m.kpis?.growth_vs_prior_7 || {};
  return `
    ${detailMetrics([
      detailMetric("Revenue", money(k.revenue), `${trend(g7.revenue)} vs prior period`),
      detailMetric("Payers", number(k.payers), `${trend(g7.payers)} vs prior period`),
      detailMetric("Transactions", number(k.transactions), `${trend(g7.transactions)} vs prior period`),
      detailMetric("Avg Transaction", money(k.avg_transaction), `${trend(g7.avg_transaction)} vs prior period`),
    ])}
    ${newOldRevenueSplitTable(m)}
    ${detailTable("Revenue Stream Mix", m.family, [
      { key: "family_label", label: "Stream", text: true },
      { key: "revenue", label: "Revenue", format: money },
      { key: "revenue_share_pct", label: "Share", format: pct },
      { key: "payers", label: "Payers", format: number },
      { key: "avg_transaction", label: "Avg Txn", format: money },
    ], 5)}
    ${detailTable("Top Packs", topRows(m.pack_merged || m.pack, "revenue", 8), [
      { key: "selection", label: "Pack", text: true },
      { key: "family_label", label: "Stream", text: true },
      { key: "revenue", label: "Revenue", format: money },
      { key: "payers", label: "Payers", format: number },
      { key: "revenue_share_pct", label: "Share", format: pct },
    ])}
  `;
}

function subscriptionDetail(data) {
  const m = data.monetization || {};
  const sub = familyMetric(m, "subscription");
  const renewal = m.subscription_renewal || { kpis: {} };
  const activeSubDaily = m.active_subscription_daily || [];
  const latestActiveSub = activeSubDaily[activeSubDaily.length - 1] || {};
  const trialCohorts = m.trial_to_paid_cohort_by_price || [];
  return `
    ${detailMetrics([
      detailMetric("Subscription Revenue", money(sub.revenue), `${pct(sub.revenue_share_pct)} of total revenue`),
      detailMetric("Subscription Payers", number(sub.payers), `${trend(sub.revenue_growth_vs_prior_7_pct)} revenue growth`),
      detailMetric("Main Buyers", number((m.subscription_stage_performance || []).filter((row) => String(row.stage).toLowerCase().includes("main")).reduce((sum, row) => sum + Number(row.payers || 0), 0)), "Users buying main subscription packs"),
      detailMetric("Renewal Due", money(renewal.kpis?.renewal_revenue_at_risk || 0), `${number(renewal.kpis?.renewal_due_next_7_days || 0)} subscriptions due`),
      detailMetric("Active Paid EOD", number(latestActiveSub.active_paid_subscribers), `${money(latestActiveSub.mrr)} MRR stock`),
      detailMetric("Trial Active EOD", number(latestActiveSub.trial_active_subscribers), "Current trial stock from customer subscriptions"),
    ])}
    ${subscriptionNewOldTables(m)}
    ${detailTable("Plan Performance", topRows(m.subscription_plan_performance, "revenue", 8), [
      { key: "selection", label: "Plan", text: true },
      { key: "revenue", label: "Revenue", format: money },
      { key: "payers", label: "Payers", format: number },
      { key: "trial_buyers", label: "Trial Buyers", format: number },
      { key: "main_buyers", label: "Main Buyers", format: number },
      { key: "followup_to_main_pct", label: "Follow-up to Main", format: pct },
    ])}
    ${detailTable("Trial and Main Pack Split", m.subscription_stage_performance, [
      { key: "selection", label: "Pack", text: true },
      { key: "stage", label: "Stage", text: true },
      { key: "amount", label: "Amount", format: money },
      { key: "revenue", label: "Revenue", format: money },
      { key: "payers", label: "Payers", format: number },
    ], 10)}
    ${detailTable("Rs 1 vs Rs 49 Funnel", m.config_funnel, [
      { key: "trial_type", label: "Trial", text: true },
      { key: "assigned_users", label: "Assigned", format: number },
      { key: "followup_users", label: "Follow-up", format: number },
      { key: "trial_buyers", label: "Trial Buyers", format: number },
      { key: "main_plan_buyers", label: "Main Buyers", format: number },
    ], 5)}
    ${detailTable("Trial Cohort Conversion by Main Price", trialCohorts, [
      { key: "trial_start_date", label: "Date", text: true, format: shortDate },
      { key: "subscription_price", label: "Main Price", format: money },
      { key: "trial_starts", label: "Trials", format: number },
      { key: "converted_trials", label: "Converted", format: number },
      { key: "conversion_pct", label: "Conversion", format: pct },
      { key: "avg_days_to_convert", label: "Avg Days", format: (v) => Number(v || 0).toFixed(2) },
    ], 10)}
    ${detailTable("Active Subscription Stock", activeSubDaily, [
      { key: "date", label: "Date", text: true, format: shortDate },
      { key: "active_paid_subscribers", label: "Active Paid", format: number },
      { key: "trial_active_subscribers", label: "Active Trials", format: number },
      { key: "mrr", label: "MRR Stock", format: money },
      { key: "net_mrr_movement", label: "Net MRR Move", format: money },
    ], 10)}
  `;
}

function paygDetail(data) {
  const m = data.monetization || {};
  const payg = familyMetric(m, "pay_as_you_go");
  return `
    ${detailMetrics([
      detailMetric("PayG Revenue", money(payg.revenue), `${pct(payg.revenue_share_pct)} of total revenue`),
      detailMetric("PayG Payers", number(payg.payers), `${trend(payg.revenue_growth_vs_prior_7_pct)} revenue growth`),
      detailMetric("Transactions", number(payg.transactions), `${money(payg.avg_transaction)} avg transaction`),
      detailMetric("ARPP", money(payg.avg_revenue_per_payer), "Average revenue per PayG payer"),
    ])}
    ${newOldRevenueSplitTable(m, "pay_as_you_go", "New vs Old PayG Split")}
    ${detailTable("Amount Distribution", topRows(m.payg_amount_breakdown, "revenue", 8), [
      { key: "amount", label: "Amount", format: money },
      { key: "revenue", label: "Revenue", format: money },
      { key: "transactions", label: "Txns", format: number },
      { key: "payers", label: "Payers", format: number },
      { key: "revenue_share_pct", label: "Share", format: pct },
    ])}
    ${detailTable("Revenue Concentration", m.revenue_concentration, [
      { key: "group", label: "Group", text: true },
      { key: "payers", label: "Payers", format: number },
      { key: "revenue", label: "Revenue", format: money },
      { key: "revenue_share_pct", label: "Share", format: pct },
    ], 5)}
  `;
}

function dayPassDetail(data) {
  const m = data.monetization || {};
  const dayPass = familyMetric(m, "day_pass");
  return `
    ${detailMetrics([
      detailMetric("Day Pass Revenue", money(dayPass.revenue), `${pct(dayPass.revenue_share_pct)} of total revenue`),
      detailMetric("Day Pass Payers", number(dayPass.payers), `${trend(dayPass.revenue_growth_vs_prior_7_pct)} revenue growth`),
      detailMetric("Transactions", number(dayPass.transactions), `${money(dayPass.avg_transaction)} avg transaction`),
      detailMetric("ARPP", money(dayPass.avg_revenue_per_payer), "Average revenue per day-pass payer"),
    ])}
    ${newOldRevenueSplitTable(m, "day_pass", "New vs Old Day Pass Split")}
    ${detailTable("Day Pass Packs", topRows((m.pack_merged || []).filter((row) => row.family === "day_pass"), "revenue", 8), [
      { key: "selection", label: "Pack", text: true },
      { key: "revenue", label: "Revenue", format: money },
      { key: "payers", label: "Payers", format: number },
      { key: "transactions", label: "Txns", format: number },
    ])}
  `;
}

function acquisitionDetail(data) {
  const a = data.acquisition || {};
  const k = a.kpis || {};
  return `
    ${detailMetrics([
      detailMetric("New Users", number(k.new_users), `${number(k.login_success_users)} login-success users`),
      detailMetric("Reached Follow-up", pct(k.new_user_to_followup_pct), "New users who asked follow-up"),
      detailMetric("Paid", pct(k.new_user_to_payment_pct), "New users who made payment"),
      detailMetric("Gap", `${(Number(k.new_user_to_followup_pct || 0) - Number(k.new_user_to_payment_pct || 0)).toFixed(1)} pts`, "Follow-up to payment opportunity"),
    ])}
    ${detailTable("Funnel", a.funnel, [
      { key: "stage", label: "Stage", text: true },
      { key: "users", label: "Users", format: number },
      { key: "conversion_from_previous_pct", label: "Step Conv.", format: pct },
      { key: "conversion_from_start_pct", label: "Start Conv.", format: pct },
    ], 5)}
    ${detailTable("Payment Type", a.payment_type_funnel, [
      { key: "family_label", label: "Payment", text: true },
      { key: "payers", label: "Payers", format: number },
      { key: "revenue", label: "Revenue", format: money },
      { key: "new_to_payment_pct", label: "New to Payment", format: pct },
    ], 5)}
  `;
}

function retentionDetail(data) {
  const r = data.retention || {};
  const d1 = (r.curve || []).find((row) => row.day_n === 1) || {};
  const d7 = (r.curve || []).find((row) => row.day_n === 7) || {};
  return `
    ${detailMetrics([
      detailMetric("D1 Retention", pct(d1.retention_pct || 0), `${number(d1.retained_users || 0)} retained users`),
      detailMetric("D7 Retention", pct(d7.retention_pct || 0), `${number(d7.retained_users || 0)} retained users`),
      detailMetric("Cohort Users", number(d1.cohort_users || 0), "Users in retention cohort"),
      detailMetric("Best Bot Repeat", pct((topRows(r.bot, "repeat_rate_pct", 1)[0] || {}).repeat_rate_pct || 0), (topRows(r.bot, "repeat_rate_pct", 1)[0] || {}).bot_name || "Bot repeat"),
    ])}
    ${detailTable("Retention Curve", r.curve, [
      { key: "day_n", label: "Day", format: (v) => `D${v}` },
      { key: "cohort_users", label: "Cohort", format: number },
      { key: "retained_users", label: "Retained", format: number },
      { key: "retention_pct", label: "Retention", format: pct },
    ], 8)}
    ${detailTable("Top Bot Repeat Usage", topRows(r.bot, "repeat_users_2plus_days", 8), [
      { key: "bot_name", label: "Bot", text: true },
      { key: "active_users", label: "Active", format: number },
      { key: "repeat_users_2plus_days", label: "Repeat", format: number },
      { key: "repeat_rate_pct", label: "Repeat Rate", format: pct },
    ])}
  `;
}

function engagementDetail(data) {
  const e = data.engagement || {};
  const k = e.kpis || {};
  const s = e.stickiness_kpis || {};
  return `
    ${detailMetrics([
      detailMetric("Active Users", number(k.active_users), `${number(k.sessions)} sessions`),
      detailMetric("Avg Time/User", `${k.avg_minutes_per_user || 0}m`, `${k.avg_minutes_per_session || 0}m per session`),
      detailMetric("DAU / MAU", pct(s.dau_mau_pct), `${number(s.dau)} DAU | ${number(s.mau)} MAU`),
      detailMetric("BIM Opens", number(k.bim_notification_opens), `${number(k.bim_notification_users)} users`),
      detailMetric("Total Minutes", number(k.total_minutes), "Engagement minutes"),
    ])}
    ${detailTable("Session Intensity", e.session_intensity, [
      { key: "bucket", label: "Bucket", text: true },
      { key: "users", label: "Users", format: number },
      { key: "sessions", label: "Sessions", format: number },
      { key: "avg_minutes_per_user", label: "Min/User", format: number },
    ], 8)}
    ${detailTable("Notification Campaigns", e.notification_campaigns, [
      { key: "campaign", label: "Campaign", text: true },
      { key: "opens", label: "Opens", format: number },
      { key: "users", label: "Users", format: number },
      { key: "opens_per_user", label: "Opens/User", format: number },
    ], 5)}
  `;
}

function marketingDetail(data) {
  const mk = effectiveMarketingData(data);
  const k = mk.kpis || {};
  const isOverview = mk.marketing_format === "subscription_overview";
  const mappingRows = isOverview ? marketingCoverageRows(mk) : Object.entries(MARKETING_COLUMN_CANDIDATES).map(([metric]) => ({
    metric: metric.replaceAll("_", " "),
    csv_column: mk.mapping?.[metric] || "Not present",
    status: mk.mapping?.[metric] ? "Mapped" : (["date", "spend"].includes(metric) ? "Needed" : "Optional"),
  }));
  const planRows = marketingPlanRows(k);
  return `
    ${detailMetrics([
      detailMetric("Spend", money(k.spend), mk.source_status === "uploaded" ? "Uploaded CSV" : (mk.source_status === "available" ? "Campaign Data feed" : "Source pending")),
      detailMetric("Sub Spend", formatNullableMoney(k.subscription_spend), "CAC base when present"),
      detailMetric(isOverview ? "Trial Starts" : "Installs", isOverview ? number(k.trials) : number(k.installs), isOverview ? `${number(k.trials_1)} Rs 1 | ${number(k.trials_49)} Rs 49` : `${formatNullableMoney(k.cpi)} CPI`),
      detailMetric(isOverview ? "Paid Subs" : "Clicks", isOverview ? number(k.subscribers) : number(k.clicks), isOverview ? `${number(k.paid_subs_199)} Rs 199 | ${number(k.paid_subs_499)} Rs 499` : `${pct(k.ctr_pct)} CTR`),
      detailMetric("Trial CAC", formatNullableMoney(k.trial_cac), "Spend / trial"),
      detailMetric("Subscriber CAC", formatNullableMoney(k.subscriber_cac), "Spend / subscriber"),
      detailMetric(isOverview ? "499 Mix" : "ROAS", isOverview ? pct(k.mix_499_pct) : (k.roas_pct === null || k.roas_pct === undefined ? "Pending" : pct(k.roas_pct)), isOverview ? "Paid subscriber mix" : "Revenue / spend"),
    ])}
    ${detailNote("Source Status", mk.source_message || "Marketing feed status is not available.")}
    ${detailTable(isOverview ? "Metric Coverage" : "CSV Field Mapping", mappingRows, [
      { key: "metric", label: "Metric", text: true },
      { key: "csv_column", label: "CSV Column", text: true },
      { key: "status", label: "Status", text: true },
    ], 20)}
    ${detailTable(isOverview ? "Trial and Paid Plan Mix" : "Top Campaigns", isOverview ? planRows : mk.campaigns, isOverview ? [
      { key: "metric", label: "Metric", text: true },
      { key: "users", label: "Users", format: number },
      { key: "share_pct", label: "Share", format: pct },
      { key: "note", label: "Note", text: true },
    ] : [
      { key: "campaign", label: "Campaign", text: true },
      { key: "campaign_type", label: "Type", text: true },
      { key: "spend", label: "Spend", format: money },
      { key: "subscription_spend", label: "Sub Spend", format: formatNullableMoney },
      { key: "installs", label: "Installs", format: number },
      { key: "clicks", label: "Clicks", format: number },
      { key: "ctr_pct", label: "CTR", format: pct },
      { key: "cpi", label: "CPI", format: formatNullableMoney },
      { key: "trials", label: "Trials", format: number },
      { key: "trials_1", label: "Trials Rs 1", format: number },
      { key: "trials_49", label: "Trials Rs 49", format: number },
      { key: "subscribers", label: "Subscribers", format: number },
      { key: "paid_subs_199", label: "Subs Rs 199", format: number },
      { key: "paid_subs_499", label: "Subs Rs 499", format: number },
      { key: "subscriber_cac", label: "Sub CAC", format: formatNullableMoney },
      { key: "roas_pct", label: "ROAS", format: pct },
    ], 8)}
    ${isOverview ? detailTable("Daily Retention and ARPU", mk.daily || [], [
      { key: "date", label: "Date", text: true, format: shortDate },
      { key: "all_d1_retention", label: "All D1", format: pct },
      { key: "sub_d1_retention", label: "Sub D1", format: pct },
      { key: "arpu_subs_excl_trials", label: "ARPU excl Trial", format: formatNullableMoney },
      { key: "mix_499", label: "499 Mix", format: pct },
    ], 8) : ""}
  `;
}

function dataQualityDetail(data) {
  const rows = data.metric_coverage?.rows || [];
  const ready = rows.filter((row) => row.status === "Available").length;
  return `
    ${detailMetrics([
      detailMetric("Ready Families", `${number(ready)}/${number(rows.length)}`, "Metric families available today"),
      detailMetric("Partial or Missing", number(rows.length - ready), "Needs deeper source coverage"),
      detailMetric("Avg Coverage", pct(rows.length ? rows.reduce((sum, row) => sum + Number(row.coverage_pct || 0), 0) / rows.length : 0), "Across tracked metrics"),
    ])}
    ${detailTable("Open Measurement Gaps", rows.filter((row) => row.status !== "Available"), [
      { key: "area", label: "Area", text: true },
      { key: "metric", label: "Metric", text: true },
      { key: "status", label: "Status", text: true },
      { key: "coverage_pct", label: "Coverage", format: pct },
      { key: "missing_detail", label: "Gap", text: true },
    ], 8)}
  `;
}

function drilldownHtmlFor(label) {
  const data = selectedData();
  const key = String(label || "").toLowerCase();
  if (key.includes("subscription") || key.includes("rs 1") || key.includes("rs 49") || key.includes("trial") || key.includes("main")) return subscriptionDetail(data);
  if (key.includes("payg") || key.includes("pay as")) return paygDetail(data);
  if (key.includes("day pass")) return dayPassDetail(data);
  if (key.includes("acquisition") || key.includes("new user") || key.includes("follow") || key.includes("conversion")) return acquisitionDetail(data);
  if (key.includes("retention") || key.includes("repeat")) return retentionDetail(data);
  if (key.includes("engagement") || key.includes("session") || key.includes("bim") || key.includes("time")) return engagementDetail(data);
  if (key.includes("marketing") || key.includes("cac") || key.includes("roas") || key.includes("spend")) return marketingDetail(data);
  if (key.includes("quality") || key.includes("coverage")) return dataQualityDetail(data);
  if (key.includes("revenue") || key.includes("monetization") || key.includes("payer") || key.includes("transaction") || key.includes("stream") || key.includes("watch area") || key.includes("growing")) return monetizationDetail(data);
  return `
    ${detailNote("How to read this metric", "This card is part of the selected reporting period. Use the section tabs below the executive summary for the full chart view and supporting detail.")}
    ${monetizationDetail(data)}
  `;
}

function openDrilldown(label) {
  const panel = document.getElementById("drilldownPanel");
  const backdrop = document.getElementById("drilldownBackdrop");
  document.getElementById("drilldownTitle").textContent = label || "Metric Detail";
  document.getElementById("drilldownBody").innerHTML = drilldownHtmlFor(label);
  backdrop.hidden = false;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("drilldown-open");
}

function closeDrilldown() {
  const panel = document.getElementById("drilldownPanel");
  const backdrop = document.getElementById("drilldownBackdrop");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  backdrop.hidden = true;
  document.body.classList.remove("drilldown-open");
}

function setupDrilldowns() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-drilldown-label]");
    if (!target || target.closest(".section-nav") || target.closest("#businessFlow")) return;
    event.preventDefault();
    openDrilldown(target.dataset.drilldownLabel);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrilldown();
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-drilldown-label]")) {
      event.preventDefault();
      openDrilldown(event.target.dataset.drilldownLabel);
    }
  });
  document.getElementById("drilldownClose").addEventListener("click", closeDrilldown);
  document.getElementById("drilldownBackdrop").addEventListener("click", closeDrilldown);
}

function renderDashboard() {
  const data = selectedData();
  const rootMeta = DASHBOARD_DATA.metadata;
  const generatedAt = rootMeta.generated_at_ist
    ? new Date(rootMeta.generated_at_ist).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  document.getElementById("freshness").textContent = generatedAt ? `Updated ${generatedAt} IST` : "Updated today";
  renderDashboardGuide(data);
  renderOverview(data);
  renderMonetization(data);
  renderAcquisition(data);
  renderMarketing(data);
  renderRetention(data);
  renderEngagement(data);
  renderMetricCoverage(data);
  renderDataPolicy(rootMeta);
  document.getElementById("sourceNotes").innerHTML = businessSourceNotes(rootMeta.source_notes).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

main();
