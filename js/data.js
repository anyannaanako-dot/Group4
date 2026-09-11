/** Client-side data preparation for the LUMEN launch cockpit. */
export const DATA_FILES = Object.freeze({
  channelEconomics: 'data/channel_economics.csv',
  competitorPriceHistory: 'data/competitor_price_history.csv',
  competitorPrices: 'data/competitor_prices_by_channel.csv',
  costBreakdown: 'data/cost_breakdown.csv',
  customerQuotes: 'data/customer_quotes.csv',
  customerSurvey: 'data/customer_survey.csv',
  historicalSales: 'data/historical_sales_weekly.csv',
  marketContext: 'data/market_context.csv',
  marketingFunnel: 'data/marketing_funnel_monthly.csv',
  priceSensitivity: 'data/price_sensitivity_survey.csv',
  priceTests: 'data/price_test_results.csv',
  seasonality: 'data/seasonality_and_weather.csv',
});

const NUMBER_FIELDS = new Set([
  'illustrative_retail_price_eur', 'retailer_margin_pct', 'distributor_cut_pct',
  'payment_processing_pct', 'fulfillment_cost_eur', 'net_price_to_lumen_eur',
  'unit_contribution_eur', 'price_eur', 'marketing_spend_index_0_100',
  'list_price_eur', 'promo_discount_pct', 'shelf_price_eur', 'cost_per_unit_eur',
  'pct_of_total', 'age', 'purchase_frequency_per_month', 'monthly_beverage_spend_eur',
  'price_sensitivity_1_10', 'lumen_purchase_intent_1_10', 'units_sold', 'revenue_eur',
  'value', 'year', 'reach', 'engagements', 'conversions_customers_acquired', 'spend_eur',
  'cac_eur', 'ltv_estimate_eur', 'too_cheap_eur', 'cheap_eur', 'expensive_eur',
  'too_expensive_eur', 'estimated_acceptance_pct_of_survey', 'contribution_margin_pct',
  'month', 'seasonality_index_100_avg', 'avg_temp_germany_celsius',
]);
const BOOLEAN_FIELDS = new Set(['promo_active', 'aware_pulsup', 'aware_matelibre', 'aware_voltfit', 'aware_rootandrise']);
const PRIVATE_SURVEY_FIELDS = new Set(['respondent_id', 'first_name', 'last_name', 'email']);

/** Parses RFC-4180-style rows, including quoted commas and escaped quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

function coerceRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    if (NUMBER_FIELDS.has(key)) return [key, value === '' ? null : Number(value)];
    if (BOOLEAN_FIELDS.has(key)) return [key, value.toLowerCase() === 'true' || value === '1'];
    return [key, value];
  }));
}

export async function loadCsv(path, fetcher = fetch) {
  const response = await fetcher(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status} ${response.statusText}`);
  return parseCsv(await response.text()).map(coerceRecord);
}

export function sanitiseSurvey(records) {
  return records.map((record) => Object.fromEntries(
    Object.entries(record).filter(([key]) => !PRIVATE_SURVEY_FIELDS.has(key)),
  ));
}

export function deduplicateExactRecords(records) {
  const seen = new Set();
  const unique = records.filter((record) => {
    const signature = JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  return { records: unique, removed: records.length - unique.length };
}

function quantile(sorted, percentile) {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function findSalesOutliers(records) {
  const values = records.map(({ units_sold }) => units_sold).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length < 4) return [];
  const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75), iqr = q3 - q1;
  const low = q1 - 1.5 * iqr, high = q3 + 1.5 * iqr;
  return records.filter(({ units_sold }) => units_sold < low || units_sold > high);
}

function average(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function groupBy(records, key) {
  return records.reduce((groups, record) => {
    const group = record[key];
    (groups[group] ??= []).push(record);
    return groups;
  }, {});
}

export function createSummaries(data) {
  const surveyBySegment = Object.entries(groupBy(data.customerSurvey, 'segment')).map(([segment, records]) => ({
    segment,
    respondents: records.length,
    averageIntent: average(records, 'lumen_purchase_intent_1_10'),
    averagePriceSensitivity: average(records, 'price_sensitivity_1_10'),
    averageMonthlySpend: average(records, 'monthly_beverage_spend_eur'),
  }));
  const funnelByChannel = Object.entries(groupBy(data.marketingFunnel, 'channel')).map(([channel, records]) => ({
    channel, averageCac: average(records, 'cac_eur'), averageLtv: average(records, 'ltv_estimate_eur'),
  }));
  const comparableSalesByChannel = Object.entries(groupBy(data.historicalSales, 'channel')).map(([channel, records]) => ({
    channel, averageWeeklyUnits: average(records, 'units_sold'),
  }));
  const cityMetrics = Object.entries(groupBy(data.marketContext.filter((r) => r.dimension_type === 'region'), 'name')).map(([city, records]) => ({
    city,
    marketShare: records.find((r) => r.metric === 'population_share_of_market')?.value ?? null,
    cagr: records.find((r) => r.metric === 'regional_cagr')?.value ?? null,
  }));
  return { surveyBySegment, funnelByChannel, comparableSalesByChannel, cityMetrics };
}

export async function loadLumenData(fetcher = fetch) {
  const loaded = await Promise.all(Object.entries(DATA_FILES).map(async ([key, path]) => [key, await loadCsv(path, fetcher)]));
  const raw = Object.fromEntries(loaded);
  const historical = deduplicateExactRecords(raw.historicalSales);
  const data = {
    ...raw,
    customerSurvey: sanitiseSurvey(raw.customerSurvey),
    historicalSales: historical.records,
  };
  const outliers = findSalesOutliers(data.historicalSales);
  return {
    data,
    summaries: createSummaries(data),
    quality: {
      sourceRows: Object.fromEntries(Object.entries(raw).map(([key, records]) => [key, records.length])),
      surveyIdentifiersRemoved: [...PRIVATE_SURVEY_FIELDS],
      duplicateHistoricalSalesRemoved: historical.removed,
      historicalSalesOutlierCount: outliers.length,
      warnings: [
        'Forecast using comparable markets; no German sales data.',
        historical.removed ? `${historical.removed} exact duplicate historical-sales rows removed.` : null,
        outliers.length ? `${outliers.length} unusual weekly sales record(s) flagged, not deleted.` : null,
      ].filter(Boolean),
    },
  };
}
