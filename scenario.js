/** Pure business logic for the LUMEN decision cockpit. This module never reads or writes the DOM. */
export const FORECAST_CAVEAT = 'Forecast using comparable markets; no German sales data.';
export const CHANNELS = Object.freeze(['DTC Online', 'Retail/Grocery', 'Gym & Office']);
export const CANDIDATE_PRICES = Object.freeze([1.79, 2.19, 2.59]);

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  unitsPerAcquiredCustomer: 2.5,
  comparableMarketWeight: 0.15,
  maximumBudgetEur: 1_000_000,
  maximumTargetUnits: 10_000_000,
  note: 'Marketing budget estimates acquired customers from historic CAC. Each acquired customer is assumed to buy 2.5 units in the launch period; comparable-market demand contributes only a 15% directional reference.',
});

export const DEFAULT_SCENARIO = Object.freeze({
  priceEur: 2.19,
  channelAllocation: { 'DTC Online': 40, 'Retail/Grocery': 35, 'Gym & Office': 25 },
  city: 'Berlin',
  launchMonth: 5,
  marketingBudgetEur: 50_000,
  premiumWeight: 50,
  targetUnits: 10_000,
});

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value, decimals = 2) => Number(value.toFixed(decimals));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function validateScenario(input, data, assumptions = DEFAULT_ASSUMPTIONS) {
  const errors = [], warnings = [];
  const allocation = input.channelAllocation ?? {};
  const amounts = CHANNELS.map((channel) => Number(allocation[channel] ?? 0));
  const allocationTotal = amounts.reduce((sum, value) => sum + value, 0);

  if (!CANDIDATE_PRICES.includes(Number(input.priceEur))) errors.push('Select one of the tested launch prices: €1.79, €2.19, or €2.59.');
  if (amounts.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) errors.push('Each channel allocation must be a number from 0% to 100%.');
  if (!amounts.some((value) => value > 0)) errors.push('Select at least one launch channel.');
  if (Math.abs(allocationTotal - 100) > 0.01) errors.push(`Channel allocations must total 100%; they currently total ${round(allocationTotal)}%.`);
  if (!Number.isInteger(Number(input.launchMonth)) || input.launchMonth < 1 || input.launchMonth > 12) errors.push('Launch month must be an integer from 1 to 12.');
  if (!data.cityMetrics?.some(({ city }) => city === input.city)) errors.push('Select a city represented in the market-context data.');
  if (!Number.isFinite(Number(input.marketingBudgetEur)) || input.marketingBudgetEur < 0) errors.push('Marketing budget must be a non-negative number.');
  if (input.marketingBudgetEur === 0) warnings.push('A €0 marketing budget retains unit economics but disables acquisition and payback estimates.');
  if (input.marketingBudgetEur > assumptions.maximumBudgetEur) warnings.push(`Marketing budget exceeds the €${assumptions.maximumBudgetEur.toLocaleString()} modelling guardrail; treat results as directional.`);
  if (!Number.isFinite(Number(input.targetUnits)) || input.targetUnits <= 0) errors.push('Target units must be greater than zero.');
  if (input.targetUnits > assumptions.maximumTargetUnits) warnings.push(`Target units exceed the ${assumptions.maximumTargetUnits.toLocaleString()} modelling guardrail.`);
  if (!Number.isFinite(Number(input.premiumWeight)) || input.premiumWeight < 0 || input.premiumWeight > 100) errors.push('Premium strategic weight must be from 0 to 100.');
  return { valid: !errors.length, errors, warnings, allocationTotal: round(allocationTotal) };
}

function lookupPriceTests(priceEur, tests) {
  return CHANNELS.map((channel) => tests.find((row) => row.price_eur === Number(priceEur) && row.channel === channel));
}

function lookupCity(city, cityMetrics) {
  return cityMetrics.find((entry) => entry.city === city);
}

function weightedChannelMetric(rows, allocation, key) {
  return rows.reduce((total, row) => total + row[key] * (allocation[row.channel] / 100), 0);
}

function scenarioScores({ scenario, weighted, city, seasonality, comparableWeeklyUnits }) {
  const pricePremium = (scenario.priceEur - 1.79) / (2.59 - 1.79);
  const marginScore = clamp((weighted.contributionMarginPct - 39) / (72 - 39));
  const cityPremiumFit = ['Berlin', 'Munich'].includes(city.city) ? 1 : 0.55;
  const premium = clamp(0.4 * pricePremium + 0.4 * marginScore + 0.2 * cityPremiumFit) * 100;

  const contributionScore = clamp(weighted.unitContributionEur / 1.54);
  const acceptanceScore = clamp(weighted.acceptancePct / 61.7);
  const demandScore = clamp(comparableWeeklyUnits / 3_700);
  const seasonalityScore = clamp(seasonality.seasonality_index_100_avg / 138);
  const cfo = clamp(0.38 * contributionScore + 0.32 * acceptanceScore + 0.15 * demandScore + 0.15 * seasonalityScore) * 100;
  const premiumWeight = scenario.premiumWeight / 100;
  return {
    premium: round(premium, 1),
    payback: round(cfo, 1),
    overall: round(premium * premiumWeight + cfo * (1 - premiumWeight), 1),
  };
}

export function deliberatelyNotOptimisingFor(premiumWeight) {
  if (premiumWeight >= 67) return 'maximum early volume and the fastest possible payback';
  if (premiumWeight <= 33) return 'the strongest possible premium-brand signal and highest shelf price';
  return 'either stakeholder extreme: maximum early volume or the strongest possible premium signal';
}

export function calculateScenario(input, preparedData, assumptions = DEFAULT_ASSUMPTIONS) {
  const scenario = { ...DEFAULT_SCENARIO, ...input, channelAllocation: { ...DEFAULT_SCENARIO.channelAllocation, ...input.channelAllocation } };
  const validation = validateScenario(scenario, preparedData.summaries ?? preparedData, assumptions);
  if (!validation.valid) return { valid: false, validation, caveat: FORECAST_CAVEAT, assumptions };

  const summaries = preparedData.summaries ?? preparedData;
  const raw = preparedData.data ?? preparedData;
  const priceTests = raw.priceTests;
  const seasonality = raw.seasonality.find((row) => row.month === Number(scenario.launchMonth));
  const city = lookupCity(scenario.city, summaries.cityMetrics);
  const priceRows = lookupPriceTests(scenario.priceEur, priceTests);
  if (priceRows.some((row) => !row) || !seasonality || !city) {
    return { valid: false, validation: { ...validation, errors: [...validation.errors, 'The selected scenario cannot be matched to the available source data.'] }, caveat: FORECAST_CAVEAT, assumptions };
  }
  const weighted = {
    acceptancePct: weightedChannelMetric(priceRows, scenario.channelAllocation, 'estimated_acceptance_pct_of_survey'),
    netPriceEur: weightedChannelMetric(priceRows, scenario.channelAllocation, 'net_price_to_lumen_eur'),
    unitContributionEur: weightedChannelMetric(priceRows, scenario.channelAllocation, 'unit_contribution_eur'),
    contributionMarginPct: weightedChannelMetric(priceRows, scenario.channelAllocation, 'contribution_margin_pct'),
  };
  const comparableWeeklyUnits = weightedChannelMetric(
    CHANNELS.map((channel) => ({ channel, averageWeeklyUnits: summaries.comparableSalesByChannel.find((entry) => entry.channel === channel)?.averageWeeklyUnits ?? 0 })),
    scenario.channelAllocation,
    'averageWeeklyUnits',
  );
  const funnel = summaries.funnelByChannel;
  const averageCac = average(funnel.map(({ averageCac }) => averageCac));
  const averageLtv = average(funnel.map(({ averageLtv }) => averageLtv));
  const acquiredCustomers = scenario.marketingBudgetEur > 0 ? scenario.marketingBudgetEur / averageCac : null;
  const seasonalFactor = seasonality.seasonality_index_100_avg / 100;
  const cityFactor = city.marketShare / 0.12;
  const acquisitionUnits = acquiredCustomers === null ? 0 : acquiredCustomers * assumptions.unitsPerAcquiredCustomer * (weighted.acceptancePct / 100);
  const comparableReferenceUnits = comparableWeeklyUnits * 4.33 * assumptions.comparableMarketWeight * cityFactor * seasonalFactor;
  const expectedUnits = acquisitionUnits * seasonalFactor + comparableReferenceUnits;
  const contributionEur = expectedUnits * weighted.unitContributionEur;
  const scores = scenarioScores({ scenario, weighted, city, seasonality, comparableWeeklyUnits });
  const ltvCac = scenario.marketingBudgetEur > 0 ? averageLtv / averageCac : null;
  const paybackRatio = scenario.marketingBudgetEur > 0 ? contributionEur / scenario.marketingBudgetEur : null;

  return {
    valid: true,
    scenario,
    caveat: FORECAST_CAVEAT,
    validation,
    assumptions: { ...assumptions, cityFactorRule: 'City factor compares the selected city’s market share with the five-city average (12%).' },
    metrics: {
      weighted: Object.fromEntries(Object.entries(weighted).map(([key, value]) => [key, round(value)])),
      averageCacEur: round(averageCac), averageLtvEur: round(averageLtv),
      acquiredCustomers: acquiredCustomers === null ? null : round(acquiredCustomers),
      comparableWeeklyUnits: round(comparableWeeklyUnits),
      expectedLaunchPeriodUnits: round(expectedUnits), expectedContributionEur: round(contributionEur),
      expectedNetRevenueEur: round(expectedUnits * weighted.netPriceEur), ltvCac: ltvCac === null ? null : round(ltvCac),
      contributionPaybackRatio: paybackRatio === null ? null : round(paybackRatio),
      breakEvenUnits: round(scenario.marketingBudgetEur / weighted.unitContributionEur),
      cityFactor: round(cityFactor), seasonalFactor: round(seasonalFactor),
    },
    evidence: { priceTestRows: priceRows, city, seasonality, comparableMarket: 'NL, DK and SE historical sales only', marketingFunnelChannels: funnel.map(({ channel }) => channel) },
    scores,
    deliberatelyNotOptimisingFor: deliberatelyNotOptimisingFor(scenario.premiumWeight),
  };
}

/** Fixed, dependency-free tests for browser-console or future test-runner validation. */
export function runScenarioFixedTests() {
  const fixture = {
    priceTests: CHANNELS.flatMap((channel) => CANDIDATE_PRICES.map((price, index) => ({ price_eur: price, channel, estimated_acceptance_pct_of_survey: [61.7, 51.7, 26.7][index], net_price_to_lumen_eur: 1.4 + index * 0.35, unit_contribution_eur: 0.7 + index * 0.35, contribution_margin_pct: 50 + index * 10 }))),
    seasonality: [{ month: 5, seasonality_index_100_avg: 118 }],
    summaries: { cityMetrics: [{ city: 'Berlin', marketShare: 0.18, cagr: 0.09 }], comparableSalesByChannel: CHANNELS.map((channel) => ({ channel, averageWeeklyUnits: 2_000 })), funnelByChannel: [{ channel: 'Paid Social', averageCac: 40, averageLtv: 120 }] },
  };
  const valid = calculateScenario(DEFAULT_SCENARIO, fixture);
  if (!valid.valid || valid.metrics.expectedLaunchPeriodUnits <= 0) throw new Error('Fixed scenario should calculate positive forecast units.');
  const invalid = calculateScenario({ ...DEFAULT_SCENARIO, channelAllocation: { 'DTC Online': 20, 'Retail/Grocery': 20, 'Gym & Office': 20 } }, fixture);
  if (invalid.valid || !invalid.validation.errors.some((message) => message.includes('total 100%'))) throw new Error('Allocation validation did not reject incomplete allocation.');
  const zeroBudget = calculateScenario({ ...DEFAULT_SCENARIO, marketingBudgetEur: 0 }, fixture);
  if (!zeroBudget.valid || zeroBudget.metrics.ltvCac !== null || !zeroBudget.validation.warnings.length) throw new Error('Zero-budget scenario was not handled as expected.');
  return true;
}
