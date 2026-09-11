import { loadLumenData } from './js/data.js';
import { runScenarioFixedTests } from './js/scenario.js';
import { renderDashboard } from './js/dashboard.js';

const app = document.querySelector('#app');

async function initialise() {
  try {
    const [data] = await Promise.all([loadLumenData(), Promise.resolve(runScenarioFixedTests())]);
    console.info('LUMEN data layer ready', data.quality);
    renderDashboard(app, data);
  } catch (error) {
    console.error(error);
    app.innerHTML = `<section class="load-error"><p class="eyebrow">Data issue</p><h1>Decision model unavailable</h1><p>Check that the dashboard is served from the project folder so its local data files can load.</p></section>`;
  }
}

initialise();
