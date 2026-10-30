import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const output = path.join(root, 'demo/output');
const work = path.join(output, 'work');
const front = process.env.DEMO_FRONTEND_URL || 'http://127.0.0.1:5173';
const back = process.env.DEMO_BACKEND_URL || 'http://127.0.0.1:8000';
const total = 580;
fs.mkdirSync(work, { recursive: true });
const scenes = JSON.parse(
  fs.readFileSync(path.join(root, 'demo/scripts/scenes.json')),
);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20e6,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error || result.stderr || result.stdout}`,
    );
  return result.stdout;
};
const probe = (file) =>
  JSON.parse(
    run('ffprobe', [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      file,
    ]),
  );
const seconds = (file) => Number(probe(file).format.duration);
const clean = (text) =>
  stripVTControlCharacters(text).replaceAll(root, '[repository]');
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const save = (name, data) =>
  fs.writeFileSync(path.join(work, name), JSON.stringify(data, null, 2));

async function loaded(page) {
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="Refresh data"]')?.disabled,
    null,
    { timeout: 180000 },
  );
  if (await page.getByRole('alert').count())
    throw new Error(await page.getByRole('alert').innerText());
  await page.locator('.recharts-line-curve').first().waitFor();
}

async function preflight() {
  run('ffmpeg', ['-version']);
  run('ffprobe', ['-version']);
  run('tesseract', ['--version']);
  if (!run('say', ['-v', '?']).includes('Daniel'))
    throw new Error('Installed English TTS voice Daniel is required');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    const errors = [];
    const requests = {};
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('response', async (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) {
        requests[new URL(r.url()).pathname] = {
          status: r.status(),
          body: await r.json(),
        };
      }
    });
    await page.goto(front);
    await loaded(page);
    const kpis = await page.locator('.kpi-value').allTextContents();
    await page.goto(`${back}/docs`);
    await page.locator('.swagger-ui .opblock').first().waitFor();
    const health = await page.request.get(`${back}/api/v1/health`);
    const schema = await page.request.get(`${back}/api/v1/openapi.json`);
    if (
      errors.length ||
      health.status() !== 200 ||
      schema.status() !== 200 ||
      requests['/api/analytics/timeseries']?.body.records.length !== 1488 ||
      Object.values(requests).some((r) => r.status !== 200)
    ) {
      throw new Error(
        'Real-data preflight failed. Stop; do not substitute mock data.',
      );
    }
    const result = {
      recordedAt: new Date().toISOString(),
      kpis,
      errors,
      health: health.status(),
      swagger: schema.status(),
      requests,
    };
    save('preflight.json', result);
    console.log(
      'PREFLIGHT: real January data, populated charts, successful APIs and Swagger; no console errors.',
    );
    return result;
  } finally {
    await browser.close();
  }
}

function checks() {
  const commands = [
    [
      'pytest',
      path.join(root, 'apps/wind-api/.venv/bin/python'),
      ['-m', 'pytest', '-q'],
      { PYTHONPATH: 'apps/wind-api' },
    ],
    ['vitest', 'pnpm', ['test:web']],
    [
      'typescript',
      'pnpm',
      [
        'exec',
        'tsc',
        '-p',
        'apps/wind-web/tsconfig.app.json',
        '--noEmit',
        '--strict',
      ],
    ],
    ['eslint', 'pnpm', ['exec', 'eslint', '.', '--max-warnings', '0']],
    [
      'ruff',
      path.join(root, 'apps/wind-api/.venv/bin/ruff'),
      ['check', 'apps/wind-api'],
    ],
    ['build', 'pnpm', ['build:web']],
  ];
  const results = {};
  for (const [name, command, args, env] of commands) {
    console.log(`CHECK: ${name}`);
    const result = spawnSync(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 20e6,
    });
    const log = clean((result.stdout || '') + (result.stderr || ''));
    if (result.status !== 0) throw new Error(`${name} failed: ${log}`);
    results[name] = {
      command: `${path.relative(root, command).startsWith('apps/') ? path.relative(root, command) : command} ${args.join(' ')}`,
      exitCode: result.status,
      log,
    };
    fs.writeFileSync(path.join(work, `${name}.log`), log);
  }
  save('checks.json', results);
  return results;
}

function makeViewer(results) {
  const files = [
    'package.json',
    'apps/wind-web/src/app/app.tsx',
    'apps/wind-web/src/services/api.ts',
    'apps/wind-web/vite.config.mts',
    'apps/wind-api/app/main.py',
    'apps/wind-api/app/clients/elexon.py',
    'apps/wind-api/app/services/wind_data.py',
    'apps/wind-api/app/services/forecast_selection.py',
    'apps/wind-api/app/services/analytics.py',
    'apps/wind-api/Dockerfile',
    'apps/wind-web/vercel.json',
    'apps/wind-api/vercel.json',
  ];
  const source = Object.fromEntries(
    files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]),
  );
  const index = run('git', ['ls-files', 'apps', 'libs'])
    .split('\n')
    .filter((f) => /\.(tsx?|py|json)$/.test(f) && !f.includes('nx-welcome'))
    .join('\n');
  // Only this explicit file allowlist and actual command results enter the viewer.
  const payload = JSON.stringify({ source, index, results }).replaceAll(
    '<',
    '\\u003c',
  );
  fs.writeFileSync(
    path.join(work, 'viewer.html'),
    `<!doctype html><meta charset="utf-8"><title>Wind Intelligence | Repository walkthrough</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#d8e3f0;font:22px/1.55 ui-monospace,monospace}header{position:fixed;top:0;left:0;right:0;z-index:3;height:100px;padding:22px 40px;background:#111e32;border-bottom:1px solid #29405c}header strong{font:600 25px system-ui;color:#5eead4}header small{float:right;font:18px system-ui;color:#94a3b8}aside{position:fixed;top:100px;bottom:0;width:330px;padding:25px 20px;background:#101b2c;overflow:auto}aside button{display:block;color:#b9cadc;background:none;border:0;text-align:left;padding:12px 8px;font:16px system-ui;width:100%;cursor:pointer}aside button:hover{color:#5eead4}main{margin-left:330px;padding:124px 36px 180px}h1{font:600 28px system-ui;color:white;margin:0 0 12px}p{font:19px system-ui;color:#9db1c9}.line{display:flex;min-height:35px;white-space:pre-wrap;overflow-wrap:anywhere}.num{flex:0 0 65px;color:#526b89;user-select:none;font-size:17px}.code{flex:1}.kw{color:#c4a2ff}.str{color:#9ce3bd}.comment{color:#819bb8}.focus{background:#173443;border-left:3px solid #2dd4bf}pre{white-space:pre-wrap;font:20px/1.5 ui-monospace,monospace;background:#101e30;padding:20px;border-radius:12px}h2{font:600 24px system-ui;color:#5eead4}section{margin-bottom:28px} .pass{color:#86efac}</style>
<header><strong>Wind Forecast Intelligence / Engineering</strong><small>Actual repository source · read only · no environment files</small></header><aside id="nav"></aside><main id="main"></main>
<script>const data=${payload};const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function highlight(s){return s.split(/("[^"\\n]*"|'[^'\\n]*'|#.*$|\\/\\/.*$|\\b(?:from|import|def|async|await|return|if|else|for|in|class|const|export|function|try|except|with|None|True|False)\\b)/gm).map(t=>/^#|^\\/\\//.test(t)?'<span class="comment">'+esc(t)+'</span>':/^['"]/.test(t)?'<span class="str">'+esc(t)+'</span>':/^(from|import|def|async|await|return|if|else|for|in|class|const|export|function|try|except|with|None|True|False)$/.test(t)?'<span class="kw">'+esc(t)+'</span>':esc(t)).join('')}
window.showFile=(name,match='')=>{const lines=data.source[name].split('\\n');document.querySelector('main').innerHTML='<h1>'+esc(name)+'</h1><p>Repository source / '+lines.length+' lines</p>'+lines.map((s,i)=>'<div id="L'+(i+1)+'" class="line '+(match&&s.includes(match)?'focus':'')+'"><span class="num">'+(i+1)+'</span><span class="code">'+highlight(s)+'</span></div>').join('');const idx=lines.findIndex(s=>match&&s.includes(match));document.querySelector('header strong').textContent=name;scrollTo(0,idx>=0?Math.max(0,document.getElementById('L'+(idx+1)).offsetTop-150):0)};
window.showIndex=()=>{document.querySelector('main').innerHTML='<h1>Nx monorepo / application and shared library files</h1><p>File inventory from git ls-files; no private configuration included.</p><pre>'+esc(data.index)+'</pre>';scrollTo(0,0)};
window.showTests=()=>{document.querySelector('main').innerHTML='<h1>Fresh validation evidence</h1><p>Unmodified command output except ANSI formatting and repository path redaction.</p>'+Object.entries(data.results).map(([n,r])=>'<section id="test-'+n+'"><h2>'+esc(n)+' <span class="pass">/ exit '+r.exitCode+'</span></h2><p>'+esc(r.command)+'</p><pre>'+esc(r.log||'(No stdout; successful exit code '+r.exitCode+')')+'</pre></section>').join('');scrollTo(0,0)};
const nav=document.querySelector('aside');for(const [label,fn] of [['Repository index',()=>showIndex()],['Validation results',()=>showTests()],...Object.keys(data.source).map(f=>[f,()=>showFile(f)])]){const b=document.createElement('button');b.textContent=label;b.onclick=fn;nav.append(b)}showIndex();</script>`,
  );
}

function chunks(text) {
  const sentences = text.match(/.+?(?:[.!?](?=\s|$)|$)/g) || [text];
  return sentences.flatMap((sentence) => {
    const words = sentence.trim().split(/\s+/);
    const parts = [];
    let part = '';
    for (const word of words) {
      if ((part + ' ' + word).trim().length > 135) {
        parts.push(part);
        part = word;
      } else part += (part ? ' ' : '') + word;
    }
    if (part) parts.push(part);
    return parts;
  });
}

function narration(preflightResult, results) {
  const a = preflightResult.requests['/api/analytics/accuracy'].body;
  const values = {
    mae: a.accuracy_metrics.mae_mw.toLocaleString('en-GB'),
    rmse: a.accuracy_metrics.rmse_mw.toLocaleString('en-GB'),
    bias: a.accuracy_metrics.mean_error_mw.toLocaleString('en-GB'),
    coverage: a.coverage_metrics.evaluation_coverage_pct,
    intervals: a.coverage_metrics.total_evaluated_intervals,
    pytest: results.pytest.log.match(/(\d+) passed/)?.[1],
    vitest: results.vitest.log.match(/Tests\s+(\d+) passed/)?.[1],
  };
  if (Object.values(values).some((v) => v === undefined))
    throw new Error('Missing verified narration value');
  const cues = [];
  const manifest = [];
  const md = [
    '# Wind Forecast Intelligence — verified English narration',
    '',
    'Voice: macOS Daniel (en-GB), 145 words per minute. Values are substituted from live preflight and current test output.',
    '',
  ];
  for (const scene of scenes) {
    const text = scene.narration.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => values[key],
    );
    scene.spokenText = text;
    md.push(
      `## ${Math.floor(scene.start / 60)}:${String(scene.start % 60).padStart(2, '0')} — ${scene.title}`,
      '',
      text,
      '',
    );
    const speech = [];
    for (const part of chunks(text)) {
      const file = path.join(
        work,
        `voice-${createHash('sha256')
          .update('Daniel|145|' + part)
          .digest('hex')
          .slice(0, 20)}.aiff`,
      );
      if (
        !fs.existsSync(file + '.txt') ||
        fs.readFileSync(file + '.txt', 'utf8') !== part
      ) {
        run('say', ['-v', 'Daniel', '-r', '145', '-o', file, part]);
        fs.writeFileSync(file + '.txt', part);
      }
      speech.push({ text: part, file, duration: seconds(file) });
    }
    const length = speech.reduce((n, p) => n + p.duration, 0);
    // Keep each chapter exactly on time; only modest speech-speed correction is allowed.
    const speed = Math.max(
      1,
      (length + speech.length * 0.12) / (scene.duration - 2),
    );
    if (speed > 1.22)
      throw new Error(
        `Narration too long for ${scene.id}: edit script instead of rushing the voice.`,
      );
    let offset = 0.6;
    for (const part of speech) {
      const wav = part.file.replace('.aiff', '.wav');
      run('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-i',
        part.file,
        '-af',
        `atempo=${speed},apad=pad_dur=0.12`,
        '-ar',
        '48000',
        '-ac',
        '1',
        wav,
      ]);
      const d = seconds(wav);
      cues.push({
        start: scene.start + offset,
        end: scene.start + offset + d - 0.12,
        text: part.text,
        scene: scene.id,
      });
      manifest.push({ start: scene.start + offset, file: wav, duration: d });
      offset += d;
    }
    console.log(
      `VOICE: ${scene.id}: ${length.toFixed(1)}s speech, speed ${speed.toFixed(3)}, budget ${scene.duration}s`,
    );
  }
  fs.writeFileSync(path.join(root, 'demo/scripts/narration.md'), md.join('\n'));
  save('cues.json', cues);
  save('audio-manifest.json', manifest);
  // Build a single PCM narration track with exact silent gaps between measured cues.
  const pcm = Buffer.alloc(total * 48000 * 2);
  for (const item of manifest) {
    const raw = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        item.file,
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-',
      ],
      { maxBuffer: 20e6 },
    );
    if (raw.status !== 0) throw new Error('PCM conversion failed');
    raw.stdout.copy(pcm, Math.round(item.start * 48000) * 2);
  }
  fs.writeFileSync(path.join(work, 'narration.pcm'), pcm);
  run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-i',
    path.join(work, 'narration.pcm'),
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    path.join(work, 'narration.wav'),
  ]);
  const timestamp = (n) => {
    const ms = Math.round(n * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  const wrap = (text) => {
    if (text.length < 80) return text;
    const words = text.split(' ');
    let a = '';
    while (words.length && a.length < text.length / 2)
      a += (a ? ' ' : '') + words.shift();
    return a + '\n' + words.join(' ');
  };
  fs.writeFileSync(
    path.join(output, 'wind-intelligence-demo.srt'),
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${wrap(c.text)}\n`,
      )
      .join('\n'),
  );
  return cues;
}

async function record(cues, closingOnly = false) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    timezoneId: 'Europe/London',
    recordVideo: {
      dir: path.join(work, 'raw'),
      size: { width: 1920, height: 1080 },
    },
  });
  const page = await context.newPage();
  const video = page.video();
  const errors = [];
  const apiEvents = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/'))
      apiEvents.push({ time: Date.now(), url: r.url(), status: r.status() });
  });
  const overlay = ({ cues, origin, scene }) => {
    document.querySelector('#demo-production-overlay')?.remove();
    const shell = document.createElement('div');
    shell.id = 'demo-production-overlay';
    shell.innerHTML =
      '<div id="demo-chapter"></div><div id="demo-caption"></div>';
    shell.style.cssText =
      'pointer-events:none;position:fixed;inset:0;z-index:2147483647';
    document.documentElement.append(shell);
    const chapter = shell.children[0];
    const caption = shell.children[1];
    chapter.style.cssText =
      'position:absolute;right:28px;top:80px;padding:10px 18px;border-radius:8px;color:white;background:rgba(15,23,42,.92);font:600 15px/1.4 system-ui;letter-spacing:.04em;box-shadow:0 2px 12px #0002';
    caption.style.cssText =
      'position:absolute;bottom:56px;left:50%;transform:translateX(-50%);max-width:1480px;width:max-content;text-align:center;padding:12px 24px;border-radius:9px;background:rgba(8,15,27,.88);color:#fff;font:500 29px/1.4 system-ui;box-shadow:0 2px 16px #0004';
    chapter.textContent = scene;
    const update = () => {
      const now = (Date.now() - origin) / 1000;
      const c = cues.find((c) => now >= c.start && now < c.end);
      caption.textContent = c?.text || '';
      caption.style.display = c ? 'block' : 'none';
    };
    update();
    window.clearInterval(window.__demoCaptionTimer);
    window.__demoCaptionTimer = setInterval(update, 40);
  };
  await page.goto(front);
  await loaded(page);
  await page.evaluate(() => scrollTo(0, 0));
  const expectedKpis = JSON.parse(
    fs.readFileSync(path.join(work, 'preflight.json')),
  ).kpis;
  if (
    JSON.stringify(await page.locator('.kpi-value').allTextContents()) !==
    JSON.stringify(expectedKpis)
  )
    throw new Error('Recording KPIs differ from verified narration');
  const started = Date.now() - (closingOnly ? 560000 : 0);
  const at = async (time, fn) => {
    await sleep(started + time * 1000 - Date.now());
    if (fn) await fn();
  };
  const chapter = async (scene) =>
    page.evaluate(overlay, {
      cues,
      origin: started,
      scene: `${scene.chapter}  /  ${scene.title}`,
    });
  const focus = async (id) => {
    const el = page.locator(`#${id}`);
    await el.scrollIntoViewIfNeeded();
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      scrollTo({
        top: el.getBoundingClientRect().top + scrollY - 135,
        behavior: 'smooth',
      });
    }, id);
  };
  const viewer = async (file, match = '') => {
    await page.goto(pathToFileURL(path.join(work, 'viewer.html')).href);
    await page.evaluate(
      ({ file, match }) =>
        file === 'index'
          ? window.showIndex()
          : file === 'tests'
            ? window.showTests()
            : window.showFile(file, match),
      { file, match },
    );
    await chapter(
      scenes.find(
        (s) => (Date.now() - started) / 1000 < s.start + s.duration,
      ) || scenes.at(-1),
    );
  };
  const filter = async ({ from, to, hour, minute = '0', zone }) => {
    await page.getByLabel('Start date', { exact: true }).fill(from);
    await page.getByLabel('End date', { exact: true }).fill(to);
    await page.getByLabel('Cutoff hour (0-23)', { exact: true }).fill(hour);
    await page.getByLabel('Cutoff minute (0-59)', { exact: true }).fill(minute);
    await page.getByLabel('Timezone', { exact: true }).selectOption(zone);
    const response = page.waitForResponse(
      (r) =>
        r.url().includes('/api/analytics/accuracy?') &&
        r.url().includes(`from=${from}`) &&
        r.url().includes(`to=${to}`) &&
        r.url().includes(`cutoff_hour=${hour}`) &&
        r.url().includes(`cutoff_minute=${minute}`),
    );
    await loaded(page);
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click();
    const r = await response;
    if (r.status() !== 200) throw new Error('Live filter request failed');
    const body = await r.json();
    if (body.date_from !== from || body.date_to !== to)
      throw new Error('Filter dates not honored');
    await loaded(page);
  };
  const heartbeat = setInterval(
    () =>
      console.log(`RECORDING ${((Date.now() - started) / 1000) | 0}/${total}s`),
    30000,
  );
  try {
    if (closingOnly) {
      await chapter(scenes[10]);
      await at(total);
    } else {
      await chapter(scenes[0]);
      await at(40, async () => {
        await chapter(scenes[1]);
        await focus('kpi-heading');
      });
      await at(70, async () => {
        await page.evaluate(() => {
          document.body.style.zoom = '1.08';
        });
        await focus('kpi-heading');
        await page.locator('.kpi-value').nth(2).hover();
      });
      await at(100, async () => {
        await page.evaluate(() => {
          document.body.style.zoom = '1';
        });
        await chapter(scenes[2]);
        await focus('main-chart-heading');
      });
      await at(115, async () => {
        await page.getByLabel('View day:').selectOption('2026-01-01');
      });
      await at(128, async () => {
        await page
          .locator('.recharts-wrapper')
          .first()
          .hover({ position: { x: 900, y: 160 } });
      });
      await at(137, async () => {
        await page.getByLabel('View day:').selectOption('');
        await focus('error-chart-heading');
      });
      await at(160, async () => {
        await chapter(scenes[3]);
        await focus('filters-heading');
      });
      await at(170, async () => {
        await filter({
          from: '2026-01-05',
          to: '2026-01-07',
          hour: '10',
          minute: '30',
          zone: 'UTC',
        });
      });
      await at(192, async () => {
        await page
          .getByRole('button', { name: 'Refresh data', exact: true })
          .click();
        await loaded(page);
      });
      await at(202, async () => {
        await filter({
          from: '2026-01-01',
          to: '2026-01-31',
          hour: '12',
          zone: 'Europe/London',
        });
      });
      await at(220, async () => {
        await chapter(scenes[4]);
        await focus('accuracy-heading');
      });
      await at(246, async () => {
        await focus('data-quality-heading');
      });
      await at(265, async () => {
        await page
          .getByRole('button', { name: 'Methodology & Assumptions' })
          .click();
        await focus('methodology-heading');
      });
      await at(283, async () => {
        await focus('transparency-heading');
      });
      await at(300, async () => {
        await viewer('index');
      });
      await at(318, async () => {
        await viewer('apps/wind-web/src/app/app.tsx');
      });
      await at(333, async () => {
        await viewer('apps/wind-api/app/main.py');
      });
      await at(350, async () => {
        await viewer(
          'apps/wind-api/app/clients/elexon.py',
          'async def get_fuelhh',
        );
      });
      await at(370, async () => {
        await viewer(
          'apps/wind-api/app/clients/elexon.py',
          'async def get_windfor',
        );
      });
      await at(394, async () => {
        await viewer(
          'apps/wind-api/app/services/wind_data.py',
          'def normalize_actuals',
        );
      });
      await at(410, async () => {
        await viewer(
          'apps/wind-api/app/services/forecast_selection.py',
          'def get_cutoff_utc',
        );
      });
      await at(428, async () => {
        await viewer(
          'apps/wind-api/app/services/forecast_selection.py',
          'def _select_latest_eligible_forecast',
        );
      });
      await at(442, async () => {
        await viewer(
          'apps/wind-api/app/services/forecast_selection.py',
          'Create two half-hour entries',
        );
      });
      await at(455, async () => {
        await viewer(
          'apps/wind-api/app/services/forecast_selection.py',
          'def align_actuals_and_forecasts',
        );
      });
      await at(470, async () => {
        await page.goto(`${back}/docs`);
        await page.locator('.swagger-ui .opblock').first().waitFor();
        await chapter(scenes[8]);
      });
      const swagger = async (route) => {
        const block = page.locator('.opblock').filter({
          has: page.locator(`.opblock-summary-path[data-path="${route}"]`),
        });
        await block.locator('.opblock-summary').click();
        await block.scrollIntoViewIfNeeded();
        await block.getByRole('button', { name: 'Try it out' }).click();
        const start = block.locator('input[placeholder="from"]');
        const end = block.locator('input[placeholder="to"]');
        if (await start.count()) {
          await start.fill('2026-01-02');
          await end.fill('2026-01-02');
        }
        const result = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === route &&
            r.request().method() === 'GET',
        );
        await block
          .getByRole('button', { name: 'Execute', exact: true })
          .click();
        const response = await result;
        if (response.status() !== 200)
          throw new Error(`Swagger ${route} failed`);
        await block.locator('.responses-wrapper').scrollIntoViewIfNeeded();
        await sleep(800);
      };
      await at(474, async () => swagger('/api/v1/health'));
      await at(482, async () => swagger('/api/v1/analytics/accuracy'));
      await at(495, async () => swagger('/api/v1/analytics/timeseries'));
      await at(508, async () => swagger('/api/v1/wind/coverage'));
      await at(520, async () => {
        await viewer('tests');
      });
      await at(532, async () => {
        await page.locator('#test-vitest').scrollIntoViewIfNeeded();
      });
      await at(540, async () => {
        await page.locator('#test-typescript').scrollIntoViewIfNeeded();
      });
      await at(546, async () => {
        await viewer('apps/wind-api/Dockerfile');
      });
      await at(553, async () => {
        await viewer('apps/wind-web/vercel.json');
      });
      await at(560, async () => {
        await page.goto(front);
        await loaded(page);
        await chapter(scenes[10]);
        await page.evaluate(() => scrollTo(0, 0));
      });
      await at(total);
    }
    if (Date.now() - started > (total + 2) * 1000)
      throw new Error('Recording overran scene timing');
    if (errors.length || apiEvents.some((r) => r.status >= 400))
      throw new Error(`Recording errors: ${errors.join('; ')}`);
    await page.screenshot({ path: path.join(work, 'closing-frame.png') });
  } finally {
    clearInterval(heartbeat);
    await context.close();
    await browser.close();
  }
  const raw = await video.path();
  const metadata = {
    raw,
    duration: seconds(raw),
    timelineDuration: (Date.now() - started) / 1000,
    errors,
    apiEvents,
  };
  // Match the end of the browser recording to the end of the timed presentation.
  metadata.leadIn = Math.max(0, metadata.duration - (closingOnly ? 20 : total));
  if (closingOnly) metadata.timelineDuration -= 560;
  save(closingOnly ? 'closing-recording.json' : 'recording.json', metadata);
  return calibrate(metadata, closingOnly);
}

function calibrate(recording, closingOnly = false) {
  // Verify the encoded screencast clock against text that is actually visible.
  // Playwright's capture startup has a small offset from the wall clock.
  const cues = JSON.parse(fs.readFileSync(path.join(work, 'cues.json')));
  const prefixes = closingOnly
    ? ['React and FastAPI']
    : ['Root mean squared', 'Data quality separates', 'The tests cover'];
  const samples = [];
  const picture = path.join(work, 'sync-probe.png');
  for (const prefix of prefixes) {
    const cue = cues.find((c) => c.text.startsWith(prefix));
    const relative = cue.start - (closingOnly ? 560 : 0);
    const target = cue.text
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(0, 26);
    const visible = (time) => {
      run('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-ss',
        String(time),
        '-i',
        recording.raw,
        '-vf',
        'crop=1680:150:120:915',
        '-frames:v',
        '1',
        picture,
      ]);
      return run('tesseract', [picture, 'stdout', '--psm', '6'])
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .includes(target);
    };
    const center = recording.leadIn + relative;
    let lo = center - 3;
    let hi = center + 0.05;
    if (visible(lo) || !visible(hi))
      throw new Error(
        'Caption clock calibration could not bracket the expected cue',
      );
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (visible(mid)) hi = mid;
      else lo = mid;
    }
    samples.push({
      text: cue.text,
      expected: relative,
      observedRaw: hi,
      leadIn: hi - relative,
    });
  }
  const leads = samples.map((s) => s.leadIn).sort((a, b) => a - b);
  if (leads.at(-1) - leads[0] > 0.35)
    throw new Error('Screencast clock drift exceeds subtitle tolerance');
  recording.uncalibratedLeadIn = recording.leadIn;
  recording.leadIn = leads[Math.floor(leads.length / 2)];
  recording.captionCalibration = samples;
  save(closingOnly ? 'closing-recording.json' : 'recording.json', recording);
  console.log(
    `SYNC: ${closingOnly ? 'closing' : 'main'} caption clock aligned; lead-in ${recording.leadIn.toFixed(3)}s, drift spread ${(leads.at(-1) - leads[0]).toFixed(3)}s`,
  );
  return recording;
}

function assemble(recording) {
  const file = path.join(output, 'wind-intelligence-demo.mp4');
  console.log(
    'ASSEMBLE: H.264 1080p30, AAC narration, timed burned-in browser captions plus SRT.',
  );
  // Captions were rendered over the actual browser capture from measured TTS cues.
  // A brief dip at scene boundaries gives a clean transition without retiming speech.
  const closing = JSON.parse(
    fs.readFileSync(path.join(work, 'closing-recording.json')),
  );
  const split = scenes
    .slice(0, -1)
    .map((_, i) => `[v${i}]`)
    .join('');
  const transitions = scenes
    .map(
      (s, i) =>
        `[${i === scenes.length - 1 ? '3:v' : 'v' + i}]trim=start=${i === scenes.length - 1 ? 0 : s.start}:end=${i === scenes.length - 1 ? 20 : s.start + s.duration},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.18,fade=t=out:st=${s.duration - 0.18}:d=0.18[c${i}]`,
    )
    .join(';');
  const filter = `[0:v]split=${scenes.length - 1}${split};${transitions};${scenes.map((_, i) => `[c${i}]`).join('')}concat=n=${scenes.length}:v=1:a=0,fps=30[video]`;
  run(
    'ffmpeg',
    [
      '-y',
      '-v',
      'warning',
      '-ss',
      String(recording.leadIn),
      '-i',
      recording.raw,
      '-i',
      path.join(work, 'narration.wav'),
      '-i',
      path.join(output, 'wind-intelligence-demo.srt'),
      '-ss',
      String(closing.leadIn),
      '-i',
      closing.raw,
      '-t',
      String(total),
      '-filter_complex',
      filter,
      '-map',
      '[video]',
      '-map',
      '1:a:0',
      '-map',
      '2:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      '48000',
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata',
      'title=Wind Forecast Intelligence — Product and Technical Demo',
      '-movflags',
      '+faststart',
      file,
    ],
    { maxBuffer: 20e6 },
  );
  return file;
}

function validate(file) {
  const m = probe(file);
  const v = m.streams.find((s) => s.codec_type === 'video');
  const a = m.streams.find((s) => s.codec_type === 'audio');
  if (
    v.width !== 1920 ||
    v.height !== 1080 ||
    v.codec_name !== 'h264' ||
    v.avg_frame_rate !== '30/1' ||
    a?.codec_name !== 'aac' ||
    Math.abs(Number(m.format.duration) - total) > 1
  )
    throw new Error('Output metadata failed QA');
  run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v',
    '-map',
    '0:a',
    '-f',
    'null',
    '-',
  ]);
  save('ffprobe.json', m);
  const volume = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      file,
      '-af',
      'volumedetect',
      '-vn',
      '-sn',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  fs.writeFileSync(path.join(work, 'audio-qa.log'), volume.stderr);
  if (
    !/mean_volume: -\d/.test(volume.stderr) ||
    /mean_volume: -inf/.test(volume.stderr)
  )
    throw new Error('Silent narration');
  const live = JSON.parse(fs.readFileSync(path.join(work, 'preflight.json')));
  const recorded = JSON.parse(
    fs.readFileSync(path.join(work, 'recording.json')),
  );
  const baseline = run('git', ['rev-parse', '--short', 'HEAD']).trim();
  const report = [
    '# Task 12 recording report',
    '',
    `Generated: ${new Date().toISOString()}. Source revision: ${baseline}.`,
    '',
    `Final file: demo/output/wind-intelligence-demo.mp4`,
    `Duration: ${m.format.duration} seconds (target 580). Resolution: ${v.width} × ${v.height}. Frame rate: ${v.avg_frame_rate}.`,
    `Video: ${v.codec_name}, ${v.pix_fmt}. Audio: ${a.codec_name}, ${a.sample_rate} Hz. File bytes: ${m.format.size}.`,
    '',
    'Narration: installed macOS Daniel English voice, base rate 145 WPM; measured chapter speech with modest tempo adjustments. No cloned voice, paid service, music, or upload.',
    'Captions: measured TTS cues; white text, dark translucent background, safe bottom margin, maximum two lines. Burned into browser footage, embedded English track, and separate wind-intelligence-demo.srt.',
    '',
    '## Scene timeline',
    '',
    ...scenes.map(
      (s) =>
        `- ${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, '0')} — ${s.title} (${s.duration}s)`,
    ),
    '',
    '## Preflight evidence',
    '',
    `Live January dashboard KPIs: ${live.kpis.join(' / ')}. No mock data or intercepted responses.`,
    `Health HTTP ${live.health}; Swagger schema HTTP ${live.swagger}; preflight browser errors: ${live.errors.length}.`,
    `Time-series intervals: ${live.requests['/api/analytics/timeseries'].body.records.length}.`,
    `During recording: ${recorded.apiEvents.length} API responses; ${recorded.apiEvents.filter((r) => r.status >= 400).length} HTTP failures; ${recorded.errors.length} page errors.`,
    'Actual validation command output is retained in work/checks.json and *.log; pytest, Vitest, strict TypeScript, ESLint, Ruff and production build completed successfully.',
    '',
    '## Automated video QA',
    '',
    'ffprobe metadata assertions passed: H.264, AAC, 1080p, 30 FPS, under ten minutes. Full video/audio decode completed without errors. Audio volumedetect confirms non-silent narration; see work/audio-qa.log.',
    'Timing: product demonstration 0:00–5:00, technical walkthrough 5:00–9:20, conclusion 9:20–9:40. Captions and narration share the measured cue timeline. Browser capture lead-in is removed during assembly.',
    'Privacy: only the application, local Swagger, allowlisted source files and real test results are captured. No environment files, credentials, API keys, Git tokens, personal browser tabs or user profile UI were included.',
    '',
    '## Limits and delivery',
    '',
    'Docker and Vercel configuration are shown, but no Docker build or deployed Vercel integration is claimed as verified. Historical publication discovery is limited to fixed snapshots. Elexon availability and rate limits may affect future reruns.',
    'The Unlisted YouTube upload is intentionally left for the user. No automatic upload, push, or deployment was attempted. Generated media and evidence are ignored by Git.',
  ];
  fs.writeFileSync(
    path.join(output, 'recording-report.md'),
    report.join('\n') + '\n',
  );
  console.log(
    `QA: ${m.format.duration}s, ${v.width}x${v.height}, ${v.avg_frame_rate}, H.264/AAC; full decode passed.`,
  );
  return m;
}

const mode = process.argv[2] || '--all';
if (mode === '--prepare' || mode === '--all') {
  const live = await preflight();
  const results = checks();
  makeViewer(results);
  narration(live, results);
}
if (mode === '--record' || mode === '--all') {
  const expected = JSON.parse(
    fs.readFileSync(path.join(work, 'preflight.json')),
  ).kpis;
  const current = await preflight();
  if (JSON.stringify(current.kpis) !== JSON.stringify(expected))
    throw new Error(
      'Live KPIs changed; regenerate narration before recording.',
    );
  const captured = await record(
    JSON.parse(fs.readFileSync(path.join(work, 'cues.json'))),
  );
  await record(JSON.parse(fs.readFileSync(path.join(work, 'cues.json'))), true);
  const file = assemble(captured);
  validate(file);
}
if (mode === '--assemble') {
  const file = assemble(
    JSON.parse(fs.readFileSync(path.join(work, 'recording.json'))),
  );
  validate(file);
}
if (mode === '--validate')
  validate(path.join(output, 'wind-intelligence-demo.mp4'));

if (mode === '--viewer')
  makeViewer(JSON.parse(fs.readFileSync(path.join(work, 'checks.json'))));

if (mode === '--narration')
  narration(
    JSON.parse(fs.readFileSync(path.join(work, 'preflight.json'))),
    JSON.parse(fs.readFileSync(path.join(work, 'checks.json'))),
  );

if (mode === '--closing') {
  await record(JSON.parse(fs.readFileSync(path.join(work, 'cues.json'))), true);
  const file = assemble(
    JSON.parse(fs.readFileSync(path.join(work, 'recording.json'))),
  );
  validate(file);
}

if (mode === '--sync') {
  const main = calibrate(
    JSON.parse(fs.readFileSync(path.join(work, 'recording.json'))),
  );
  calibrate(
    JSON.parse(fs.readFileSync(path.join(work, 'closing-recording.json'))),
    true,
  );
  validate(assemble(main));
}
