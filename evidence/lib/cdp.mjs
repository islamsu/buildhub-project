/**
 * A MINIMAL CHROME DEVTOOLS PROTOCOL DRIVER, WITH NO NEW DEPENDENCY.
 *
 * BuildHub has never had a rendered-browser check: every previous report has
 * classified browser QA as pending, and the reason was tooling - Playwright is
 * not a dependency of this project and adding one to run a probe is a change to
 * the product's dependency tree for the sake of the test suite.
 *
 * It turns out not to be necessary. Chromium is present in this environment,
 * and Node 22 ships a global WebSocket client, so the DevTools protocol can be
 * driven directly. That is a real browser rendering the real bundle - not a
 * simulated DOM, and not a source-text assertion about what the screen probably
 * shows.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export async function launchBrowser({ port = 9222 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'zg-chrome-'));
  const child = spawn(CHROMIUM, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  // Wait for the debugging endpoint rather than for a fixed delay: a sleep that
  // is too short reports a broken browser and a sleep that is too long wastes
  // every run.
  let version = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { version = await res.json(); break; }
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!version) {
    child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`Chromium did not expose a debugging endpoint.\n${stderr.slice(0, 800)}`);
  }

  return {
    version,
    close: () => {
      child.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true });
    },
    newPage: () => connectPage(port),
  };
}

async function connectPage(port) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${message.error.message} (${JSON.stringify(message.params ?? {})})`));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  return {
    send,
    setCookies: async (cookies) => { await send('Network.setCookies', { cookies }); },
    /**
     * Navigate and WAIT FOR THE APP, not for the document.
     *
     * This is a single-page app: load fires while the root div is still empty,
     * so asserting straight after navigation reliably finds nothing and reports
     * a working page as broken.
     */
    goto: async (url, { waitFor, timeoutMs = 20000 } = {}) => {
      await send('Page.navigate', { url });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { result } = await send('Runtime.evaluate', {
          expression: waitFor
            ? `!!document.querySelector(${JSON.stringify(waitFor)})`
            : 'document.readyState === "complete" && document.body.innerText.trim().length > 0',
          returnByValue: true,
        });
        if (result.value === true) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return false;
    },
    evaluate: async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(() => { ${expression} })()`,
        returnByValue: true, awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate threw');
      return result.value;
    },
    close: () => socket.close(),
  };
}
