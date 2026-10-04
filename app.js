/* Offline UI. No fetch, analytics, localStorage, cookies, or external assets. */
(function () {
  'use strict';
  const M = window.ProfitModel;
  const $ = (id) => document.getElementById(id);
  const fields = [
    ['price', '实际成交售价', 'base', '元', '买家支付的订单总额，含向买家收取的运费'],
    ['product', '商品采购 / 生产成本', 'base', '元', '整笔订单全部商品成本'],
    ['packaging', '初次包装成本', 'base', '元', '纸箱、填充、胶带等'],
    ['shipping', '初次发货运费', 'base', '元', '商家实际承担的出库运费'],
    ['commissionRate', '平台佣金费率', 'fee', '%', '按原始成交售价计提'],
    ['paymentRate', '支付费率', 'fee', '%', '按原始成交售价计提'],
    ['fixedFee', '每单固定手续费', 'fee', '元', '不随售价变化；退款时不退回'],
    ['advertising', '每单广告 / 获客成本', 'fee', '元', '按原始成交订单摊分，退款订单也计入'],
    ['other', '其他每单成本', 'fee', '元', '例如按单计费的操作费，避免与上面重复'],
    ['breakageRate', '原始订单破损率', 'damage', '%', '破损订单数 ÷ 原始成交订单数'],
    ['reshipShare', '破损订单中补寄占比', 'damage', '%', '剩余破损订单全部按全额退款处理'],
    ['reshipProduct', '每次补寄商品成本', 'aftercare', '元', '只补单件时，填实际补寄部分的成本'],
    ['reshipPackaging', '每次补寄包装成本', 'aftercare', '元', '新增包装，不含第一次的包装'],
    ['reshipShipping', '每次补寄运费', 'aftercare', '元', '仅新增补寄运费'],
    ['reshipOther', '每次补寄其他成本', 'aftercare', '元', '例如补寄操作费'],
    ['refundExtra', '每笔退款额外处理成本', 'aftercare', '元', '如退回运费；不要填写已退商品价款'],
    ['refundFeeRecovery', '退款订单比例手续费退回', 'aftercare', '%', '同时作用于佣金和支付费；0% 为完全不退'],
    ['targetMargin', '目标贡献利润率', 'target', '%', '以预计保留收入为分母'],
    ['monthlyOrders', '每月原始成交订单数', 'target', '单', '仅做线性估算，不含淡旺季或概率波动']
  ];
  const percentFields = new Set(fields.filter((f) => f[3] === '%').map((f) => f[0]));
  const scenarios = [];
  let current = null;
  let scenarioId = 0;
  const currency = new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2});
  const money = (n) => n === null || !Number.isFinite(n) ? '不可达' : currency.format(Math.abs(n) < 0.00000001 ? 0 : n);
  const pct = (n) => n === null || !Number.isFinite(n) ? '不适用' : `${(n * 100).toFixed(2)}%`;
  // Do not underquote a break-even or target price by rounding down to cents.
  const ceilCent = (n) => n === null ? null : Math.ceil(n * 100) / 100;

  function make(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  fields.forEach(([id, label, group, unit, description]) => {
    const wrapper = make('div', 'field');
    const labelEl = make('label', '', label); labelEl.htmlFor = id;
    const wrap = make('div', 'input-wrap');
    const input = make('input'); Object.assign(input, {id, name: id, type: 'number', min: '0', max: percentFields.has(id) ? '100' : '100000000', step: id === 'monthlyOrders' ? '1' : 'any', value: M.defaults[id]});
    input.required = true;
    input.inputMode = id === 'monthlyOrders' ? 'numeric' : 'decimal';
    input.setAttribute('aria-describedby', `${id}-description ${id}-error`);
    wrap.append(input, make('span', 'unit', unit));
    const desc = make('p', 'field-description', description); desc.id = `${id}-description`;
    const error = make('span', 'field-error'); error.id = `${id}-error`;
    wrapper.append(labelEl, wrap, desc, error);
    $(`${group}-fields`).append(wrapper);
  });

  function readInput() {
    return Object.fromEntries(fields.map(([id]) => [id, $(id).value === '' ? NaN : Number($(id).value)]));
  }
  function recompute() {
    const input = readInput();
    const errors = M.validate(input);
    fields.forEach(([id]) => {
      $(id).setAttribute('aria-invalid', errors[id] ? 'true' : 'false');
      $(`${id}-error`).textContent = errors[id] || '';
    });
    const invalid = Object.keys(errors).length > 0;
    $('error-summary').hidden = !invalid;
    $('result-content').hidden = invalid;
    $('save').disabled = invalid || scenarios.length >= 4;
    $('export').disabled = invalid;
    if (invalid) {
      current = null;
      $('error-summary').textContent = `请先修正 ${Object.keys(errors).length} 项输入。结果暂停显示，避免误用旧数字。`;
      $('outcome-help').textContent = '请补全有效参数后查看订单售后分布。';
      $('breakdown').replaceChildren(make('p', 'muted', '修正输入后显示成本明细。'));
      $('sensitivity').querySelector('thead').replaceChildren();
      $('sensitivity').querySelector('tbody').replaceChildren();
      renderComparison();
      return;
    }
    current = M.calculate(input);
    const c = current;
    $('profit').textContent = money(c.profit);
    $('profit').classList.toggle('negative', c.profit < -1e-8);
    $('profit-status').textContent = c.profit > 1e-8 ? '可用于覆盖固定经营成本与税费' : c.profit < -1e-8 ? '按当前假设，每多卖一单仍有贡献亏损' : '刚好覆盖已录入的每单成本';
    $('margin').textContent = pct(c.margin);
    $('break-even').textContent = money(ceilCent(c.breakEvenPrice));
    $('target-label').textContent = `目标贡献利润率 ${input.targetMargin}%`;
    $('target-price').textContent = c.targetPriceIsInfimum ? '¥0.01 起' : money(ceilCent(c.targetPrice));
    $('damage-total').textContent = money(c.breakageCost);
    $('max-ad').textContent = c.maxAdvertising === null ? '零广告费仍亏损' : money(Math.floor(c.maxAdvertising * 100) / 100);
    $('monthly-label').textContent = `${input.monthlyOrders.toLocaleString('zh-CN')} 单预计贡献利润`;
    $('monthly-profit').textContent = money(c.monthlyProfit);
    const warnings = [];
    if (c.margin === null) warnings.push('预计保留收入为零，贡献利润率无定义。');
    if (c.breakEvenPrice === null) warnings.push('当前费率与退款假设下，提高售价也不能达到贡献保本。');
    if (c.targetPrice === null && !c.targetPriceIsInfimum) warnings.push('当前成本、费率与退款假设下，目标利润率不可达。');
    if (c.breakageCost < -1e-8) warnings.push('当前高费率与退费组合使退款降低了更多手续费；请核实这一非常规假设。');
    if (c.breakEvenPrice === 0 && c.priceCoefficient < 0) warnings.push('保本点仅为售价 0；提高售价反而产生贡献亏损。');
    $('result-warning').hidden = !warnings.length;
    $('result-warning').textContent = warnings.join(' ');
    $('outcome-help').textContent = `每 100 笔原始订单，预计 ${(c.pReship * 100).toFixed(2)} 笔补寄、${(c.pRefund * 100).toFixed(2)} 笔全额退款，其余 ${(100 - input.breakageRate).toFixed(2)} 笔正常交付。`;
    renderBreakdown(c);
    renderComparison();
    renderSensitivity(input);
  }
  function renderBreakdown(c) {
    const i = c.input;
    const rows = [
      ['原始成交金额', i.price, false],
      ['全额退款的预计收入损失', -c.lostRevenue, false],
      ['初次商品 / 包装 / 发货', -(i.product + i.packaging + i.shipping), false],
      ['预计比例手续费（扣除退费）', -c.percentageFees, false],
      ['固定手续费 / 广告 / 其他', -(i.fixedFee + i.advertising + i.other), false],
      ['补寄与退款额外成本', -(c.reshipCost + c.refundCost), false],
      ['贡献利润', c.profit, true]
    ];
    $('breakdown').replaceChildren(...rows.map(([label, value, total]) => {
      const row = make('div', `breakdown-row${total ? ' total' : ''}`);
      row.append(make('span', '', label), make('span', '', money(value))); return row;
    }));
  }
  function renderComparison() {
    const body = $('comparison').querySelector('tbody');
    body.replaceChildren();
    const rows = current ? [{name: '当前试算', result: current, current: true}, ...scenarios] : scenarios;
    if (!rows.length) {
      const tr = make('tr'); const td = make('td', 'muted', '输入有效参数后，当前试算会显示在这里。'); td.colSpan = 7; tr.append(td); body.append(tr); return;
    }
    rows.forEach((s) => {
      const c = s.result;
      const row = make('tr', s.current ? 'current' : '');
      const name = make('th', '', s.name); name.scope = 'row'; name.title = s.name;
      row.append(name, make('td', '', money(c.input.price)), make('td', '', `${c.input.breakageRate}%`), make('td', c.profit < 0 ? 'negative' : 'positive', money(c.profit)), make('td', '', pct(c.margin)), make('td', '', money(ceilCent(c.breakEvenPrice))));
      const action = make('td');
      if (s.current) action.textContent = '实时更新';
      else {
        const button = make('button', 'delete-button', '移除'); button.type = 'button'; button.setAttribute('aria-label', `移除方案 ${s.name}`);
        button.addEventListener('click', () => { const index = scenarios.findIndex((v) => v.id === s.id); if (index !== -1) scenarios.splice(index, 1); $('scenario-status').textContent = `已移除「${s.name}」。已保存 ${scenarios.length} / 4 个方案。`; recompute(); });
        action.append(button);
      }
      row.append(action); body.append(row);
    });
  }
  function renderSensitivity(input) {
    const rates = [...new Set([0, input.breakageRate, Math.min(100, input.breakageRate + 3), Math.min(100, input.breakageRate + 6)])];
    const prices = [...new Set([Math.max(0, Math.round(input.price * 0.9 * 100) / 100), input.price, Math.min(100000000, Math.round(input.price * 1.1 * 100) / 100)])];
    const head = make('tr'); const first = make('th', '', '售价 / 破损率'); first.scope = 'col'; head.append(first);
    rates.forEach((r) => { const th = make('th', '', `${r}%`); th.scope = 'col'; head.append(th); });
    $('sensitivity').querySelector('thead').replaceChildren(head);
    const body = $('sensitivity').querySelector('tbody'); body.replaceChildren();
    prices.forEach((price) => {
      const row = make('tr'); const th = make('th', '', `${money(price)}${price === input.price ? ' · 当前' : ''}`); th.scope = 'row'; row.append(th);
      rates.forEach((rate) => {
        const result = M.calculate({...input, price, breakageRate: rate});
        const cls = `${result.profit < 0 ? 'negative' : 'positive'}${price === input.price && rate === input.breakageRate ? ' current-cell' : ''}`;
        row.append(make('td', cls, money(result.profit)));
      });
      body.append(row);
    });
  }
  // All string cells are quoted and spreadsheet formula prefixes neutralized.
  function csvCell(value) {
    let str = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(str)) str = `'${str}`;
    return `"${str.replaceAll('"', '""')}"`;
  }
  function downloadCsv() {
    if (!current) return;
    const results = [{name: '当前试算', result: current}, ...scenarios];
    const outputKeys = ['expectedRevenue', 'percentageFees', 'baseCost', 'reshipCost', 'refundCost', 'lostRevenue', 'recoveredFees', 'breakageCost', 'profit', 'margin', 'breakEvenPrice', 'targetPrice', 'maxAdvertising', 'monthlyProfit'];
    const outputLabels = ['预计保留收入(元)', '预计比例手续费(元)', '初始成本(元)', '预计补寄额外成本(元)', '预计退款额外成本(元)', '预计退款收入损失(元)', '预计比例手续费退回(元)', '破损预计损失(元)', '贡献利润(元)', '贡献利润率(小数)', '保本售价(原始数学值/元)', '目标售价(原始数学值/元)', '可承受广告费(原始数学值/元)', '月贡献利润(元)'];
    const thresholdNotes = {
      nonpositive_price_coefficient: '提高售价仍无法保本',
      all_prices_break_even: '当前成本为零，任意售价均保本',
      zero_price_only: '仅售价为零时持平，提高售价将亏损',
      no_retained_revenue: '全额退款后无留存收入，利润率无定义',
      unreachable_target: '当前费用结构无法达到目标',
      positive_price_required: '任意正售价均可达标，零仅为下确界；按分定价从0.01元起',
      any_positive_price: '任意正售价均可达标，无最小正售价；按分定价从0.01元起',
      numeric_overflow: '计算结果超出范围'
    };
    const rows = [['方案', ...fields.map(([id, label, , unit]) => `${label}(${unit})`), ...outputLabels, '保本条件说明', '目标条件说明', '目标售价是否仅为下确界', '口径说明'], ...results.map((s) => [
      s.name,
      ...fields.map(([id]) => s.result.input[id]),
      ...outputKeys.map((key) => s.result[key] === null ? '不适用或不可达' : s.result[key]),
      thresholdNotes[s.result.breakEvenReason] || '有限保本售价',
      thresholdNotes[s.result.targetReason] || '有限目标售价',
      s.result.targetPriceIsInfimum ? '是' : '否',
      '贡献利润非净利润；每笔原始订单最多一次补寄或全额退款；金额为数学期望；不含未录入固定成本与税费'
    ])];
    const blob = new Blob(['\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `器物有数-方案对比-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('scenario-status').textContent = `已导出当前试算及 ${scenarios.length} 个保存方案，包含全部输入和计算口径。`;
  }
  $('inputs').addEventListener('input', recompute);
  $('inputs').addEventListener('submit', (e) => e.preventDefault());
  $('reset').addEventListener('click', () => { fields.forEach(([id]) => { $(id).value = M.defaults[id]; }); recompute(); $('scenario-status').textContent = '输入已恢复为假设示例。已保存的方案保持不变。'; });
  $('save').addEventListener('click', () => {
    if (!current || scenarios.length >= 4) return;
    scenarioId += 1;
    const name = $('scenario-name').value.trim() || `方案 ${scenarioId}`;
    scenarios.push({id: scenarioId, name, result: M.calculate({...current.input})});
    $('scenario-name').value = '';
    $('scenario-status').textContent = `已保存「${name}」。${scenarios.length} / 4 个方案；刷新会清空，请导出留档。`;
    recompute();
  });
  $('export').addEventListener('click', downloadCsv);
  recompute();
}());
