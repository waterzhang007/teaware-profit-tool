'use strict';
/* Dependency-free DOM stub: tests UI logic only, NOT layout, browser security, or rendering. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../model.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

class Element {
  constructor(tag, document) {
    this.tagName = tag.toLowerCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
    this.className = '';
    this._text = '';
    this._value = '';
    this.hidden = false;
    this.disabled = false;
    this.classList = {
      toggle: (name, force) => {
        const items = new Set(this.className.split(/\s+/).filter(Boolean));
        const enable = force === undefined ? !items.has(name) : force;
        if (enable) items.add(name); else items.delete(name);
        this.className = [...items].join(' ');
        return enable;
      },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  set id(value) { this._id = String(value); this.ownerDocument.ids.set(this._id, this); }
  get id() { return this._id || ''; }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = String(value);
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'value') this.value = value;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) {
    for (const child of children) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) { this.textContent = ''; this.append(...children); }
  remove() {
    if (this.parentNode) {
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentNode = null;
    }
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    for (const handler of this.listeners[event.type] || []) handler(event);
    if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'a' && this.download) this.ownerDocument.downloads.push({ href: this.href, download: this.download });
    this.dispatchEvent({ type: 'click', bubbles: true });
  }
  querySelector(tag) {
    for (const child of this.children) {
      if (child.tagName === tag) return child;
      const nested = child.querySelector(tag);
      if (nested) return nested;
    }
    return null;
  }
}
function buildDocument() {
  const document = {
    ids: new Map(), downloads: [],
    createElement(tag) { return new Element(tag, this); },
    getElementById(id) { return this.ids.get(id) || null; }
  };
  const root = document.createElement('document');
  const stack = [root];
  const voids = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'path']);
  const tokens = /<\/?([a-zA-Z][\w:-]*)([^>]*?)>|([^<]+)/g;
  for (const match of html.matchAll(tokens)) {
    if (match[3] !== undefined) {
      // Static text is enough for readable assertions; dynamic nodes use normal textContent.
      stack[stack.length - 1]._text += match[3];
      continue;
    }
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
      continue;
    }
    const element = document.createElement(tag);
    for (const attribute of match[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g)) {
      element.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    stack[stack.length - 1].append(element);
    if (tag === 'body') document.body = element;
    if (!voids.has(tag) && !match[0].endsWith('/>')) stack.push(element);
  }
  assert.ok(document.body, 'fixture must use actual HTML body');
  return document;
}
function boot() {
  const document = buildDocument();
  const blobs = new Map();
  const timers = [];
  const revoked = [];
  const context = vm.createContext({
    window: { ProfitModel: model }, document, Blob, Intl,
    URL: {
      createObjectURL(blob) { const url = `blob:test-${blobs.size + 1}`; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setTimeout(fn) { timers.push(fn); }
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  const $ = id => {
    const node = document.getElementById(id);
    assert.ok(node, `#${id} must exist in actual HTML or generated inputs`);
    return node;
  };
  const edit = values => {
    Object.entries(values).forEach(([id, value]) => { $(id).value = value; });
    $('inputs').dispatchEvent({ type: 'input', bubbles: true });
  };
  const save = name => { if (name !== undefined) $('scenario-name').value = name; $('save').click(); };
  const rows = () => $('comparison').querySelector('tbody').children;
  const exportCsv = async () => {
    const before = document.downloads.length;
    $('export').click();
    assert.equal(document.downloads.length, before + 1);
    const download = document.downloads.at(-1);
    assert.match(download.download, /^器物有数-方案对比-\d{4}-\d{2}-\d{2}\.csv$/);
    const blob = blobs.get(download.href);
    assert.equal(blob.type, 'text/csv;charset=utf-8');
    return { text: await blob.text(), download };
  };
  return { $, document, edit, save, rows, exportCsv, timers, revoked, blobs };
}
function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\r' && text[i + 1] === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  assert.equal(quoted, false, 'CSV quotes must balance');
  row.push(cell); rows.push(row);
  return rows;
}
const costZero = { product: 0, packaging: 0, shipping: 0, fixedFee: 0, advertising: 0, other: 0, reshipProduct: 0, reshipPackaging: 0, reshipShipping: 0, reshipOther: 0, refundExtra: 0 };

test('actual HTML references local scripts in model-before-app deferred order', () => {
  const scripts = [...html.matchAll(/<script\s+([^>]+)>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2);
  assert.match(scripts[0], /src="model\.js"/);
  assert.match(scripts[1], /src="app\.js"/);
  assert.ok(scripts.every(attributes => /\bdefer\b/.test(attributes)));
  assert.match(html, /connect-src 'none'/);
});

test('UI initializes all 19 inputs, expected metrics, comparison, and sensitivity', () => {
  const ui = boot();
  for (const field of model.fields) assert.equal(ui.$(field).value, String(model.defaults[field]));
  assert.equal(ui.$('result-content').hidden, false);
  assert.equal(ui.$('error-summary').hidden, true);
  assert.match(ui.$('profit').textContent, /34\.78/);
  assert.match(ui.$('margin').textContent, /35\.35%/);
  assert.match(ui.$('break-even').textContent, /61\.92/);
  assert.match(ui.$('target-price').textContent, /78\.58/);
  assert.equal(ui.rows().length, 1);
  assert.equal(ui.rows()[0].children.length, 7);
  assert.equal(ui.$('sensitivity').querySelector('tbody').children.length, 3);
  assert.equal(ui.$('sensitivity').querySelector('thead').children[0].children.length, 5);
});

test('invalid edits suppress stale results and the current comparison, preserving snapshots', () => {
  const ui = boot();
  ui.save('稳定方案');
  const savedProfit = ui.rows()[1].children[3].textContent;
  ui.edit({ price: '', product: -1 });
  assert.equal(ui.$('result-content').hidden, true);
  assert.equal(ui.$('error-summary').hidden, false);
  assert.match(ui.$('error-summary').textContent, /2 项/);
  assert.equal(ui.$('price').getAttribute('aria-invalid'), 'true');
  assert.ok(ui.$('price-error').textContent);
  assert.equal(ui.$('save').disabled, true);
  assert.equal(ui.$('export').disabled, true);
  assert.match(ui.$('breakdown').textContent, /修正输入/);
  assert.equal(ui.$('sensitivity').querySelector('tbody').children.length, 0);
  assert.equal(ui.$('sensitivity').querySelector('thead').children.length, 0);
  assert.equal(ui.rows().length, 1);
  assert.equal(ui.rows()[0].children[0].textContent, '稳定方案');
  assert.equal(ui.rows()[0].children[3].textContent, savedProfit);
  ui.edit({ price: 120, product: 32 });
  assert.equal(ui.$('result-content').hidden, false);
  assert.equal(ui.$('price').getAttribute('aria-invalid'), 'false');
  assert.equal(ui.$('price-error').textContent, '');
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.rows()[1].children[3].textContent, savedProfit);
  assert.notEqual(ui.rows()[0].children[3].textContent, savedProfit);
});

test('invalid actions cannot export or save even when an event is directly dispatched', () => {
  const ui = boot();
  ui.edit({ price: '' });
  ui.$('save').dispatchEvent({ type: 'click' });
  ui.$('export').dispatchEvent({ type: 'click' });
  assert.equal(ui.document.downloads.length, 0);
  assert.match(ui.rows()[0].textContent, /输入有效参数/);
});

test('all UI numeric boundaries are enforced and clear on correction', () => {
  const ui = boot();
  for (const values of [{ monthlyOrders: 1.5 }, { commissionRate: 101 }, { price: 100000001 }, { refundFeeRecovery: -1 }]) {
    ui.edit(values);
    assert.equal(ui.$('result-content').hidden, true);
    ui.$('reset').click();
    assert.equal(ui.$('result-content').hidden, false);
  }
});

test('scenario snapshots are immutable across multiple edits and reset', () => {
  const ui = boot();
  ui.edit({ price: 130, breakageRate: 15, advertising: 20 });
  ui.save('加厚包装');
  const snapshot = ui.rows()[1].children.map(node => node.textContent);
  ui.edit({ price: 50, breakageRate: 60, advertising: 60 });
  assert.deepEqual(ui.rows()[1].children.map(node => node.textContent), snapshot);
  ui.$('reset').click();
  for (const field of model.fields) assert.equal(ui.$(field).value, String(model.defaults[field]));
  assert.deepEqual(ui.rows()[1].children.map(node => node.textContent), snapshot);
  assert.match(ui.$('scenario-status').textContent, /保持不变/);
});

test('four-scenario limit survives extra clicks; deleting frees one slot and IDs are not reused', () => {
  const ui = boot();
  for (let i = 0; i < 4; i++) ui.save();
  assert.equal(ui.rows().length, 5);
  assert.equal(ui.$('save').disabled, true);
  ui.$('save').dispatchEvent({ type: 'click' });
  assert.equal(ui.rows().length, 5);
  ui.rows()[1].children[6].children[0].click();
  assert.equal(ui.rows().length, 4);
  assert.equal(ui.$('save').disabled, false);
  assert.match(ui.$('scenario-status').textContent, /已移除/);
  ui.save();
  assert.equal(ui.rows().length, 5);
  assert.equal(ui.rows()[4].children[0].textContent, '方案 5');
});

test('zero-cost target-price infimum renders a positive cent for both supported cases', () => {
  const ui = boot();
  ui.edit({ ...costZero, commissionRate: 0, paymentRate: 0, breakageRate: 0, targetMargin: 20 });
  assert.equal(ui.$('target-price').textContent, '¥0.01 起');
  ui.edit({ targetMargin: 100 });
  assert.equal(ui.$('target-price').textContent, '¥0.01 起');
  ui.edit({ breakageRate: 100, reshipShare: 0 });
  assert.equal(ui.$('target-price').textContent, '不可达');
  assert.equal(ui.$('margin').textContent, '不适用');
});

test('arbitrarily small positive required prices are never rounded down to zero', () => {
  const ui = boot();
  ui.edit({ ...costZero, product: 1e-12, commissionRate: 0, paymentRate: 0, breakageRate: 0, targetMargin: 20 });
  assert.match(ui.$('break-even').textContent, /0\.01/);
  assert.match(ui.$('target-price').textContent, /0\.01/);
});

test('conservative cent rounding never underquotes a price or overquotes advertising allowance', () => {
  const ui = boot();
  const x = { ...model.defaults, ...costZero, price: 1, product: .010000000001, commissionRate: 0, paymentRate: 0, breakageRate: 0, targetMargin: 0 };
  ui.edit(x);
  const r = model.calculate(x);
  const amount = id => Number(ui.$(id).textContent.replace(/[^\d.\-]/g, ''));
  assert.ok(amount('break-even') >= r.breakEvenPrice);
  assert.ok(amount('target-price') >= r.targetPrice);
  assert.ok(amount('max-ad') <= r.maxAdvertising);
});

test('extreme valid inputs do not crash sensitivity or produce nonnumeric cells', () => {
  const ui = boot();
  ui.edit({ price: 100000000, breakageRate: 100, commissionRate: 100, paymentRate: 100 });
  assert.equal(ui.$('result-content').hidden, false);
  const rows = ui.$('sensitivity').querySelector('tbody').children;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.children.length === 3));
  assert.ok(rows.every(row => !/NaN|Infinity|undefined/.test(row.textContent)));
  ui.edit({ price: 0 });
  assert.equal(ui.$('sensitivity').querySelector('tbody').children.length, 1);
});

test('CSV quoting, formula sanitization, row shape, numeric negatives, and snapshot data', async () => {
  const ui = boot();
  const names = ['=SUM(1,2)\n"quoted"', '+SUM(1,2)', '-2+3', '@SUM(A1)'];
  names.forEach((name, index) => { ui.edit({ price: 110 + index }); ui.save(name); });
  ui.edit({ price: 1 });
  const { text, download } = await ui.exportCsv();
  const rows = parseCsv(text);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].length, 38);
  assert.ok(rows.every(row => row.length === rows[0].length));
  names.forEach((name, index) => assert.equal(rows[index + 2][0], `'${name}`));
  const priceColumn = rows[0].indexOf('实际成交售价(元)');
  const profitColumn = rows[0].indexOf('贡献利润(元)');
  assert.equal(rows[1][priceColumn], '1');
  assert.equal(rows[2][priceColumn], '110');
  assert.equal(rows[1][profitColumn].startsWith("'"), false);
  assert.ok(Number(rows[1][profitColumn]) < 0);
  assert.match(text, /""quoted""/);
  ui.timers.forEach(fn => fn());
  assert.deepEqual(ui.revoked, [download.href]);
  assert.equal(ui.document.body.children.some(node => node.tagName === 'a' && node.download), false);
});

test('CSV keeps raw tiny values and explicit positive-price target conditions', async () => {
  const ui = boot();
  ui.edit({ ...costZero, commissionRate: 0, paymentRate: 0, breakageRate: 0, targetMargin: 100 });
  ui.save('零成本边界');
  ui.edit({ product: 1e-12, targetMargin: 20 });
  const { text } = await ui.exportCsv();
  const rows = parseCsv(text);
  const targetColumn = rows[0].indexOf('目标售价(原始数学值/元)');
  const conditionColumn = rows[0].indexOf('目标条件说明');
  const infimumColumn = rows[0].indexOf('目标售价是否仅为下确界');
  assert.equal(Number(rows[1][targetColumn]), 1e-12 / .8);
  assert.equal(rows[2][targetColumn], '不适用或不可达');
  assert.match(rows[2][conditionColumn], /任意正售价均可达标.*0\.01元/);
  assert.equal(rows[2][infimumColumn], '是');
});

test('scenario name markup remains literal text and form submission is prevented', () => {
  const ui = boot();
  const name = '<img src=x onerror=alert(1)>';
  ui.save(name);
  assert.equal(ui.rows()[1].children[0].textContent, name);
  assert.equal(ui.rows()[1].children[0].children.length, 0);
  const event = { type: 'submit' };
  ui.$('inputs').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});
