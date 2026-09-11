import { calculateScenario, CANDIDATE_PRICES, CHANNELS, DEFAULT_SCENARIO } from './scenario.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const euro = (value, digits = 0) => value === null ? '—' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: digits }).format(value);
const number = (value, digits = 0) => value === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const percent = (value, digits = 1) => value === null ? '—' : `${number(value, digits)}%`;

function recommendedChannel(allocation) {
  return Object.entries(allocation).sort(([, left], [, right]) => right - left)[0][0];
}

function metric(label, value, detail) {
  return `<article class="metric-card"><p>${label}</p><strong>${value}</strong><span>${detail}</span></article>`;
}

function channelControls(allocation) {
  return CHANNELS.map((channel) => `<label class="channel-control"><span>${channel}</span><output>${allocation[channel]}%</output><input type="range" min="0" max="100" step="5" name="${channel}" value="${allocation[channel]}"></label>`).join('');
}

function channelMixSummary(allocation) {
  return CHANNELS.filter((channel) => allocation[channel] > 0)
    .map((channel) => `${channel} ${allocation[channel]}%`).join(' · ');
}

function memoRisks(result, scenario) {
  const risks = ['Germany has no observed LUMEN sales; this remains a comparable-market forecast.'];
  if (result.metrics.weighted.acceptancePct < 40) risks.push('Acceptance is relatively low at the selected price.');
  if (scenario.channelAllocation['Retail/Grocery'] >= 50) risks.push('A retail-heavy mix retains less contribution per unit.');
  if (scenario.marketingBudgetEur === 0) risks.push('No paid acquisition is modelled with a €0 marketing budget.');
  return risks.slice(0, 3);
}

function competitorSummary(records) {
  const competitors = [...new Set(records.map(({ competitor }) => competitor))];
  return competitors.map((competitor) => {
    const rows = records.filter((row) => row.competitor === competitor);
    return { competitor, positioning: rows[0].positioning, averagePrice: rows.reduce((sum, row) => sum + row.price_eur, 0) / rows.length };
  }).sort((left, right) => left.averagePrice - right.averagePrice);
}

function cityRanking(cityMetrics) {
  return cityMetrics.filter(({ city }) => city !== 'Other Germany').map((city) => ({
    ...city,
    score: (city.marketShare / 0.18) * 70 + (city.cagr / 0.09) * 30,
  })).sort((left, right) => right.score - left.score);
}

function dashboardMarkup(data, scenario, result) {
  const cities = data.summaries.cityMetrics.filter(({ city }) => city !== 'Other Germany');
  const topChannel = recommendedChannel(scenario.channelAllocation);
  const valid = result.valid;
  const metrics = result.metrics ?? {};
  const warnings = [...(data.quality.warnings ?? []), ...(result.validation.warnings ?? [])];
  const risks = valid ? memoRisks(result, scenario) : [];
  const competitors = competitorSummary(data.data.competitorPrices);
  const citiesByOpportunity = cityRanking(data.summaries.cityMetrics);
  const quotes = data.data.customerQuotes.filter(({ sentiment }) => sentiment !== 'negative').slice(0, 2);
  return `
    <header class="masthead">
      <div><p class="eyebrow">LUMEN / Strategy & analytics</p><h1>Germany Launch<br><em>Decision Cockpit</em></h1></div>
      <svg class="studio-scribble" viewBox="0 0 180 72" aria-hidden="true"><path fill="none" stroke="#c84f32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M10 37C28 4 55 65 77 20S115 65 135 22 161 52 171 33M16 55C45 14 62 74 91 29S133 59 169 14M7 21C39 55 45 4 77 54S122 8 152 50"/></svg>
      <div class="forecast-badge"><span>Decision model</span><strong>Comparable-market forecast</strong><small>NL · DK · SE analogues</small></div>
    </header>
    <p class="caveat">Forecast using comparable markets; no German sales data.</p>

    <section class="recommendation panel">
      <div class="section-heading"><div><p class="eyebrow">A / Executive recommendation</p><h2>Recommended launch configuration</h2></div><span class="score">Decision score <strong>${valid ? result.scores.overall : '—'}</strong>/100</span></div>
      <div class="recommendation-grid">
        <article><span>Recommended price</span><strong>${euro(scenario.priceEur, 2)}</strong><small>${valid ? `${percent(metrics.weighted.acceptancePct)} estimated acceptance` : 'Resolve scenario inputs'}</small></article>
        <article><span>Recommended channel</span><strong>${topChannel}</strong><small>${scenario.channelAllocation[topChannel]}% of planned mix</small></article>
        <article><span>Recommended city</span><strong>${scenario.city}</strong><small>${valid ? `${percent(result.evidence.city.cagr * 100)} regional growth` : 'Market context source'}</small></article>
        <article><span>Recommended launch</span><strong>${MONTHS[scenario.launchMonth - 1]}</strong><small>${valid ? `${number(result.evidence.seasonality.seasonality_index_100_avg)} seasonal demand index` : 'Seasonality source'}</small></article>
      </div>
      <div class="tradeoff"><span>Key trade-off</span><p>${valid ? `This mix balances a ${number(result.scores.premium, 0)}/100 premium-positioning score with a ${number(result.scores.payback, 0)}/100 fast-payback score. Deliberately not optimising for <strong>${result.deliberatelyNotOptimisingFor}</strong>.` : 'Correct the controls below to generate a defensible trade-off statement.'}</p></div>
      <div class="memo-grid">
        <article><span>Configuration</span><p>${euro(scenario.priceEur, 2)} via ${channelMixSummary(scenario.channelAllocation)} in ${scenario.city}, launching in ${MONTHS[scenario.launchMonth - 1]}.</p></article>
        <article><span>Upside</span><p>${valid ? `${number(metrics.expectedLaunchPeriodUnits)} forecast units and ${euro(metrics.expectedContributionEur)} contribution in the modelled launch period.` : 'Available once the allocation totals 100%.'}</p></article>
        <article><span>Major risks</span><ul>${valid ? risks.map((risk) => `<li>${risk}</li>`).join('') : '<li>Resolve input validation before evaluating risk.</li>'}</ul></article>
        <article><span>Evidence source</span><p>${valid ? `${result.evidence.comparableMarket}; price tests, channel economics, historic CAC/LTV, city market context, and seasonality.` : 'Scenario engine inputs.'}</p></article>
      </div>
    </section>

    <section class="workspace">
      <form class="controls panel" id="scenario-controls">
        <div class="section-heading"><div><p class="eyebrow">B / Scenario controls</p><h2>Stress-test the decision</h2></div><span class="live-dot">Live model</span></div>
        <label>Price<select name="priceEur">${CANDIDATE_PRICES.map((price) => `<option value="${price}" ${price === scenario.priceEur ? 'selected' : ''}>${euro(price, 2)}</option>`).join('')}</select></label>
        <fieldset><legend>Channel mix <span class="allocation-total">Total allocated: ${result.validation.allocationTotal}%</span></legend><button class="normalise" type="button" data-normalise>Normalise to 100%</button>${channelControls(scenario.channelAllocation)}</fieldset>
        <label>Marketing budget <div class="currency-input"><span>€</span><input name="marketingBudgetEur" type="number" min="0" max="1000000" step="5000" value="${scenario.marketingBudgetEur}"></div></label>
        <label>Launch city<select name="city">${cities.map(({ city }) => `<option value="${city}" ${city === scenario.city ? 'selected' : ''}>${city}</option>`).join('')}</select></label>
        <label>Launch month<select name="launchMonth">${MONTHS.map((month, index) => `<option value="${index + 1}" ${index + 1 === scenario.launchMonth ? 'selected' : ''}>${month}</option>`).join('')}</select></label>
        <label class="strategy-control">Strategic weight <span><b>Fast Payback (CFO) <i>${100 - scenario.premiumWeight}%</i></b><b>Premium Brand (CMO) <i>${scenario.premiumWeight}%</i></b></span><input name="premiumWeight" type="range" min="0" max="100" step="5" value="${scenario.premiumWeight}"></label>
        ${result.validation.errors.length ? `<div class="validation error"><strong>Scenario needs attention</strong><ul>${result.validation.errors.map((message) => `<li>${message}</li>`).join('')}</ul></div>` : ''}
      </form>

      <section class="economics panel">
        <div class="section-heading"><div><p class="eyebrow">C / Economics</p><h2>Launch-case economics</h2></div><span class="data-label">Directional</span></div>
        <div class="economics-grid">
          ${metric('Acceptance rate', valid ? percent(metrics.weighted.acceptancePct) : '—', 'Price-test evidence')}
          ${metric('Forecast units', valid ? number(metrics.expectedLaunchPeriodUnits) : '—', 'Launch-period forecast')}
          ${metric('Expected net revenue', valid ? euro(metrics.expectedNetRevenueEur) : '—', `${valid ? number(metrics.expectedLaunchPeriodUnits) : '—'} forecast units`)}
          ${metric('Contribution margin', valid ? percent(metrics.weighted.contributionMarginPct) : '—', valid ? `${euro(metrics.weighted.unitContributionEur, 2)} / unit` : 'Channel economics')}
          ${metric('LTV : CAC', valid ? `${number(metrics.ltvCac, 1)} : 1` : '—', 'Historic marketing average')}
          ${metric('Payback proxy', valid ? percent(metrics.contributionPaybackRatio * 100, 0) : '—', 'Contribution ÷ launch budget')}
        </div>
        ${valid ? `<div class="economics-note"><span>Evidence</span><p>Weighted across your selected channels. ${number(metrics.comparableWeeklyUnits)} average weekly units from comparable markets anchors the directional demand reference; it is not German sales evidence.</p></div>` : ''}
      </section>
    </section>
    <section class="insights-grid">
      <section class="positioning panel">
        <div class="section-heading"><div><p class="eyebrow">D / Customer & positioning</p><h2>Who the launch is for</h2></div><span class="data-label">Germany survey</span></div>
        <div class="segment-table" role="table" aria-label="Customer segments">
          <div class="segment-row segment-header" role="row"><span>Segment</span><span>Intent</span><span>Price sensitivity</span><span>Monthly spend</span></div>
          ${data.summaries.surveyBySegment.map((segment) => `<div class="segment-row" role="row"><strong>${segment.segment}</strong><span>${number(segment.averageIntent, 1)} / 10</span><span>${number(segment.averagePriceSensitivity, 1)} / 10</span><span>${euro(segment.averageMonthlySpend, 0)}</span></div>`).join('')}
        </div>
        <div class="positioning-map"><div class="map-heading"><span>Competitor price ladder</span><b>LUMEN ${euro(scenario.priceEur, 2)}</b></div>${competitors.map((item) => `<div class="competitor"><span class="position-dot"></span><strong>${item.competitor}</strong><small>${item.positioning}</small><b>${euro(item.averagePrice, 2)}</b></div>`).join('')}</div>
        <div class="quote-strip">${quotes.map((quote) => `<blockquote>“${quote.quote}”<cite>${quote.segment}</cite></blockquote>`).join('')}</div>
      </section>
      <section class="market-entry panel">
        <div class="section-heading"><div><p class="eyebrow">E / Market entry</p><h2>Where and when to lead</h2></div><span class="data-label">Directional</span></div>
        <div class="city-list">${citiesByOpportunity.map((city, index) => `<div class="city-row ${city.city === scenario.city ? 'selected-city' : ''}"><span>${index + 1}</span><strong>${city.city}</strong><div><i style="width:${Math.round(city.score)}%"></i></div><b>${number(city.score, 1)}</b><small>${percent(city.marketShare * 100, 0)} market share · ${percent(city.cagr * 100, 0)} growth</small></div>`).join('')}</div>
        <div class="market-note"><span>Launch window</span><p>${valid ? `${MONTHS[scenario.launchMonth - 1]} carries a ${number(result.evidence.seasonality.seasonality_index_100_avg)} demand index at ${number(result.evidence.seasonality.avg_temp_germany_celsius)}°C.` : 'Resolve the scenario to display the selected launch window.'}</p></div>
        <div class="comparable-baseline"><span>Comparable-market demand baseline</span>${data.summaries.comparableSalesByChannel.map((channel) => `<p><b>${channel.channel}</b><strong>${number(channel.averageWeeklyUnits)} avg. weekly units</strong></p>`).join('')}</div>
      </section>
    </section>
    <section class="risk-panel panel">
      <div class="section-heading"><div><p class="eyebrow">F / Risk, assumptions & evidence</p><h2>Decision transparency</h2></div><span class="data-label">Explainable model</span></div>
      <div class="risk-columns">
        <article><span>Material risks</span><ul>${(valid ? risks : ['Scenario validation must be resolved before evaluating risks.']).map((risk) => `<li>${risk}</li>`).join('')}</ul></article>
        <article><span>Scenario caveat</span><p>${valid ? `The city factor is ${number(metrics.cityFactor, 2)}× and the seasonal factor is ${number(metrics.seasonalFactor, 2)}×. These are directional modifiers, not observed German demand.` : 'Economics remain intentionally unavailable until allocations total 100%.'}</p></article>
        <article><span>Deliberate choice</span><p>Not optimising for <strong>${valid ? result.deliberatelyNotOptimisingFor : 'a score until the scenario is valid'}</strong>.</p></article>
      </div>
      <details class="evidence-drawer"><summary>Open assumptions and evidence drawer</summary><div><h3>Model assumptions</h3><p>${valid ? result.assumptions.note : 'The scenario engine exposes assumptions after validation passes.'}</p><h3>Evidence used</h3><ul><li>Price acceptance and contribution: <code>price_test_results.csv</code></li><li>Channel economics: <code>channel_economics.csv</code></li><li>Historic CAC/LTV: <code>marketing_funnel_monthly.csv</code></li><li>City opportunity: <code>market_context.csv</code></li><li>Seasonality: <code>seasonality_and_weather.csv</code></li><li>Comparable-market baseline: NL, DK and SE historical sales only</li></ul><h3>Data quality</h3><ul>${data.quality.warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul></div></details>
    </section>
    ${warnings.length ? `<aside class="warnings"><strong>Data & model notes</strong><ul>${warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul></aside>` : ''}
  `;
}

export function renderDashboard(root, data) {
  let scenario = { ...DEFAULT_SCENARIO, channelAllocation: { ...DEFAULT_SCENARIO.channelAllocation } };
  const redraw = () => {
    const result = calculateScenario(scenario, data);
    root.innerHTML = dashboardMarkup(data, scenario, result);
    const form = root.querySelector('#scenario-controls');
    const updateScenario = (event) => {
      const { name, value } = event.target;
      if (CHANNELS.includes(name)) scenario.channelAllocation[name] = Number(value);
      else if (name === 'marketingBudgetEur') scenario[name] = Math.max(0, Number(value) || 0);
      else if (['priceEur', 'launchMonth', 'premiumWeight'].includes(name)) scenario[name] = Number(value);
      else scenario[name] = value;
      redraw();
    };
    form.addEventListener('input', updateScenario);
    form.addEventListener('change', updateScenario);
    form.querySelector('[data-normalise]').addEventListener('click', () => {
      const total = CHANNELS.reduce((sum, channel) => sum + Number(scenario.channelAllocation[channel] || 0), 0);
      if (total <= 0) return;
      const scaled = CHANNELS.map((channel) => Math.round((scenario.channelAllocation[channel] / total) * 100));
      scaled[scaled.length - 1] += 100 - scaled.reduce((sum, value) => sum + value, 0);
      CHANNELS.forEach((channel, index) => { scenario.channelAllocation[channel] = scaled[index]; });
      redraw();
    });
  };
  redraw();
}
