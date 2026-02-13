const fs = require('fs');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadSolarCalculator() {
  const raw = fs.readFileSync('script.js', 'utf8');
  const trimmed = raw.split('\ntry {\n    window.app = new SolarCalculator();')[0];

  const alerts = [];
  const errors = [];
  const context = {
    console: {
      ...console,
      error: (...args) => errors.push(args.map(String).join(' '))
    },
    window: {
      APP_CONSTANTS: { VIEW_MODES: { OVERVIEW: 'overview', BREAKDOWN: 'breakdown' }, DEFAULT_PROJECT_COUNT: 3 },
      SolarConfig: { global: {}, suppliers: [] }
    },
    document: { getElementById: () => ({ value: 'ppt' }) },
    navigator: {},
    alert: (msg) => alerts.push(msg),
    lucide: null,
    Chart: undefined,
    ChartDataLabels: undefined,
    ChartZoom: undefined
  };

  vm.createContext(context);
  vm.runInContext(`${trimmed}\nthis.SolarCalculator = SolarCalculator;`, context);
  return { SolarCalculator: context.SolarCalculator, context, alerts, errors };
}

async function testClipboardNotSupported() {
  const { SolarCalculator, context, alerts } = loadSolarCalculator();
  const app = Object.create(SolarCalculator.prototype);
  app.charts = { lcoe: { canvas: {} } };
  app.buildExportCanvas = () => ({ toBlob: (cb) => cb(Buffer.from('x')) });

  context.navigator = {};
  context.window.ClipboardItem = undefined;

  await app.copyChartToClipboard('lcoe', 'preset');
  assert(alerts.some(a => a.includes('Clipboard API is not supported')), 'should alert clipboard unsupported');
}

async function testClipboardWriteFailure() {
  const { SolarCalculator, context, alerts, errors } = loadSolarCalculator();
  const app = Object.create(SolarCalculator.prototype);
  app.charts = { lcoe: { canvas: {} } };
  app.buildExportCanvas = () => ({ toBlob: (cb) => cb(Buffer.from('x')) });

  context.navigator = { clipboard: { write: async () => { throw new Error('denied'); } } };
  const Clip = function ClipboardItem(data) { this.data = data; };
  context.window.ClipboardItem = Clip;
  context.ClipboardItem = Clip;

  await app.copyChartToClipboard('lcoe', 'preset');
  assert(alerts.some(a => a.includes('Unable to copy chart to clipboard')), 'should alert write failure fallback');
  assert(errors.some(e => e.includes('Copy chart failed:')), 'should log copy failure to console.error');
}

async function testClipboardSuccess() {
  const { SolarCalculator, context, alerts } = loadSolarCalculator();
  const app = Object.create(SolarCalculator.prototype);
  app.charts = { lcoe: { canvas: {} } };
  app.buildExportCanvas = () => ({ toBlob: (cb) => cb(Buffer.from('x')) });

  let wrote = false;
  context.navigator = { clipboard: { write: async (items) => { wrote = Array.isArray(items) && items.length === 1; } } };
  const Clip = function ClipboardItem(data) { this.data = data; };
  context.window.ClipboardItem = Clip;
  context.ClipboardItem = Clip;

  await app.copyChartToClipboard('lcoe', 'preset');
  assert(wrote, 'should write image to clipboard');
  assert(alerts.some(a => a.includes('Chart copied to clipboard')), 'should alert success');
}

(async () => {
  await testClipboardNotSupported();
  await testClipboardWriteFailure();
  await testClipboardSuccess();
  console.log('clipboard-flow.test.js passed');
})();
