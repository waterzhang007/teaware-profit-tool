'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const model = require('../model.js');
const input = (overrides = {}) => ({ ...model.defaults, ...overrides });
const run = (overrides = {}) => model.calculate(input(overrides));
const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual), `${actual} must be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} ≈ ${expected}`);
};
const zeroCosts = {
  product: 0, packaging: 0, shipping: 0, fixedFee: 0, advertising: 0, other: 0,
  reshipProduct: 0, reshipPackaging: 0, reshipShipping: 0, reshipOther: 0, refundExtra: 0
};

test('CommonJS API and all defaults are immutable and self-validating', () => {
  assert.deepEqual(Object.keys(model).sort(), ['calculate', 'defaults', 'fields', 'validate']);
  assert.equal(model.fields.length, 19);
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.defaults) && Object.isFrozen(model.fields));
  assert.deepEqual(model.validate(model.defaults), {});
});

test('standalone script exposes browser global with no module loader', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../model.js'), 'utf8'), context);
  assert.equal(typeof context.ProfitModel.calculate, 'function');
  close(context.ProfitModel.calculate(context.ProfitModel.defaults).profit, 34.782);
});

test('known default arithmetic, all accounting components and thresholds', () => {
  const r = run();
  close(r.pReship, .024);
  close(r.pRefund, .006);
  close(r.expectedRevenue, 98.406);
  close(r.percentageFees, 5.544);
  close(r.commissionFees, 4.95);
  close(r.paymentFees, .594);
  close(r.baseCost, 57);
  close(r.reshipUnitCost, 45);
  close(r.reshipCost, 1.08);
  close(r.refundCost, 0);
  close(r.constantCost, 58.08);
  close(r.extraCost, 1.08);
  close(r.priceCoefficient, .938);
  close(r.profit, 34.782);
  close(r.margin, 34.782 / 98.406);
  close(r.breakEvenPrice, 58.08 / .938);
  close(r.targetPrice, 58.08 / .7392);
  close(r.maxAdvertising, 46.782);
  close(r.maxAdvertisingAtTarget, 27.1008);
  close(r.breakageCost, 1.674);
  close(r.monthlyProfit, 34782);
  close(r.monthlyRevenue, 98406);
  assert.equal(r.breakEvenReason, null);
  assert.equal(r.targetReason, null);
});

for (const field of model.fields) {
  test(`${field}: required numeric, finite, and nonnegative`, () => {
    const missing = input();
    delete missing[field];
    assert.ok(model.validate(missing)[field]);
    for (const bad of [undefined, null, '', ' ', '0', '99', false, true, NaN, Infinity, -Infinity, -1, {}, []]) {
      assert.ok(model.validate(input({ [field]: bad }))[field], `${field}: ${String(bad)} must fail`);
    }
    assert.equal(model.validate(input({ [field]: 0 }))[field], undefined);
  });
}

test('invalid input throws a validation Error with keyed errors, without coercing', () => {
  assert.throws(() => run({ price: '', product: -1 }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ValidationError');
    assert.deepEqual(Object.keys(error.errors).sort(), ['price', 'product']);
    return true;
  });
  for (const bad of [undefined, null, {}, [], 1, '', false]) {
    assert.equal(Object.keys(model.validate(bad)).length, model.fields.length);
    assert.throws(() => model.calculate(bad));
  }
});

test('percentage bounds apply individually; combined fees may exceed 100%', () => {
  for (const field of ['commissionRate', 'paymentRate', 'breakageRate', 'reshipShare', 'refundFeeRecovery', 'targetMargin']) {
    assert.equal(model.validate(input({ [field]: 100 }))[field], undefined);
    assert.equal(model.validate(input({ [field]: .12345 }))[field], undefined);
    assert.ok(model.validate(input({ [field]: 100.00001 }))[field]);
  }
  assert.deepEqual(model.validate(input({ commissionRate: 100, paymentRate: 100 })), {});
});

test('cost and order limits; fractional orders rejected but fractional costs accepted', () => {
  const costFields = Object.keys(zeroCosts);
  for (const field of costFields) {
    assert.equal(model.validate(input({ [field]: 100000000 }))[field], undefined);
    assert.equal(model.validate(input({ [field]: .001 }))[field], undefined);
    assert.ok(model.validate(input({ [field]: 100000000.01 }))[field]);
  }
  assert.equal(model.validate(input({ monthlyOrders: 100000000 })).monthlyOrders, undefined);
  assert.ok(model.validate(input({ monthlyOrders: 100000001 })).monthlyOrders);
  assert.ok(model.validate(input({ monthlyOrders: 1.5 })).monthlyOrders);
  assert.equal(model.validate(input({ price: 100000000 })).price, undefined);
  assert.ok(model.validate(input({ price: 100000001 })).price);
});

test('all-zero inputs: zero profit, undefined margin, zero break-even, positive-price target infimum', () => {
  const r = model.calculate(Object.fromEntries(model.fields.map(field => [field, 0])));
  close(r.profit, 0);
  close(r.breakEvenPrice, 0);
  close(r.targetPrice, 0);
  assert.equal(r.margin, null);
  assert.equal(r.targetReason, 'positive_price_required');
  assert.equal(r.targetPriceIsInfimum, true);
});

test('zero price with nonzero costs has a loss and undefined margin', () => {
  const r = run({ price: 0 });
  close(r.profit, -r.constantCost);
  close(r.expectedRevenue, 0);
  close(r.percentageFees, 0);
  assert.equal(r.margin, null);
  assert.equal(r.diagnostics.zeroPrice, true);
  assert.equal(r.maxAdvertisingAtTarget, null);
});

test('no breakage incurs only original order costs and fees', () => {
  const r = run({ breakageRate: 0 });
  close(r.profit, 99 - 57 - 5.544);
  close(r.breakageCost, 0);
  close(r.reshipCost, 0);
  close(r.refundCost, 0);
  close(r.lostRevenue, 0);
  close(r.expectedRevenue, 99);
});

test('100% reshipments retain revenue and add one full reship cost', () => {
  const r = run({ breakageRate: 100, reshipShare: 100 });
  close(r.pReship, 1);
  close(r.pRefund, 0);
  close(r.expectedRevenue, 99);
  close(r.reshipCost, 45);
  close(r.profit, 99 - 5.544 - 57 - 45);
  close(r.breakageCost, 45);
});

test('100% refunds without fee recovery lose revenue and keep original costs and fees', () => {
  const r = run({ breakageRate: 100, reshipShare: 0, refundExtra: 7 });
  close(r.pRefund, 1);
  close(r.pReship, 0);
  close(r.expectedRevenue, 0);
  close(r.reshipCost, 0);
  close(r.refundCost, 7);
  close(r.profit, -57 - 5.544 - 7);
  assert.equal(r.margin, null);
  assert.equal(r.breakEvenPrice, null);
  assert.equal(r.targetPrice, null);
  assert.equal(r.targetReason, 'no_retained_revenue');
  assert.equal(r.maxAdvertisingAtTarget, null);
});

test('100% refunds with fee recovery retain no revenue or percentage fees; fixed fees stay', () => {
  const r = run({ breakageRate: 100, reshipShare: 0, refundFeeRecovery: 100, fixedFee: 2, refundExtra: 7 });
  close(r.expectedRevenue, 0);
  close(r.percentageFees, 0);
  close(r.recoveredFees, 5.544);
  close(r.priceCoefficient, 0);
  close(r.profit, -59 - 7);
  assert.equal(r.breakEvenPrice, null);
  assert.equal(r.breakEvenReason, 'nonpositive_price_coefficient');
});

test('partial refunds recover only the specified percentage fees', () => {
  const r = run({ price: 200, commissionRate: 10, paymentRate: 2, breakageRate: 40, reshipShare: 25, refundFeeRecovery: 50, fixedFee: 3, refundExtra: 10 });
  close(r.pReship, .1);
  close(r.pRefund, .3);
  close(r.expectedRevenue, 140);
  close(r.percentageFees, 20.4);
  close(r.recoveredFees, 3.6);
  close(r.baseCost, 60);
  close(r.constantCost, 67.5);
  close(r.profit, 52.1);
  close(r.breakageCost, 63.9);
});

test('exactly 100% combined fees with original costs has no break-even or target', () => {
  const r = run({ breakageRate: 0, commissionRate: 95, paymentRate: 5 });
  close(r.priceCoefficient, 0);
  close(r.profit, -57);
  assert.equal(r.breakEvenPrice, null);
  assert.equal(r.targetPrice, null);
  assert.equal(r.diagnostics.combinedFeesAtLeast100Percent, true);
});

test('greater than 100% combined fees worsens contribution as price rises', () => {
  const a = run({ breakageRate: 0, commissionRate: 100, paymentRate: 20 });
  const b = run({ breakageRate: 0, commissionRate: 100, paymentRate: 20, price: 199 });
  close(b.profit - a.profit, -20);
  assert.equal(a.breakEvenPrice, null);
  assert.equal(a.targetReason, 'unreachable_target');
});

test('no constant costs at 100% fees breaks even at every price', () => {
  const r = run({ ...zeroCosts, breakageRate: 0, commissionRate: 95, paymentRate: 5, targetMargin: 0 });
  close(r.profit, 0);
  close(r.breakEvenPrice, 0);
  assert.equal(r.breakEvenReason, 'all_prices_break_even');
  assert.equal(r.targetPrice, null);
  assert.equal(r.targetReason, 'any_positive_price');
});

test('no constant costs above 100% fees only break even at zero price', () => {
  const r = run({ ...zeroCosts, breakageRate: 0, commissionRate: 100, paymentRate: 20 });
  close(r.breakEvenPrice, 0);
  assert.equal(r.breakEvenReason, 'zero_price_only');
  assert.equal(r.targetPrice, null);
});

test('target at asymptotic maximum is unreachable with positive fixed costs', () => {
  const r = run({ breakageRate: 0, commissionRate: 10, paymentRate: 0, targetMargin: 90 });
  close(r.targetDenominator, 0);
  assert.equal(r.targetPrice, null);
  assert.equal(r.targetReason, 'unreachable_target');
});

test('100% target margin is reachable only with zero fees and zero costs at positive price', () => {
  const impossible = run({ breakageRate: 0, commissionRate: 0, paymentRate: 0, targetMargin: 100 });
  assert.equal(impossible.targetPrice, null);
  const free = run({ ...zeroCosts, breakageRate: 0, commissionRate: 0, paymentRate: 0, targetMargin: 100 });
  close(free.margin, 1);
  assert.equal(free.targetPrice, null);
  assert.equal(free.targetReason, 'any_positive_price');
});

test('break-even and target raw prices reproduce their intended contributions', () => {
  const a = run({ refundFeeRecovery: 30, refundExtra: 12, breakageRate: 17, reshipShare: 40 });
  const b = run({ ...a.input, price: a.breakEvenPrice });
  close(b.profit, 0);
  const c = run({ ...a.input, price: a.targetPrice });
  close(c.margin, a.input.targetMargin / 100);
  const roundedUp = Math.ceil(a.targetPrice * 100) / 100;
  assert.ok(run({ ...a.input, price: roundedUp }).margin >= a.input.targetMargin / 100 - 1e-12);
});

test('negative contribution and impossible advertising allowance stay explicit', () => {
  const r = run({ price: 1 });
  assert.ok(r.profit < 0 && r.margin < 0);
  assert.equal(r.maxAdvertising, null);
  assert.equal(r.maxAdvertisingAtTarget, null);
  assert.ok(r.advertisingHeadroom < 0);
  assert.equal(r.diagnostics.negativeProfit, true);
});

test('advertising ceilings reproduce break-even and target margin at current price', () => {
  const r = run();
  close(run({ advertising: r.maxAdvertising }).profit, 0);
  close(run({ advertising: r.maxAdvertisingAtTarget }).margin, .2);
  close(run({ advertising: r.maxAdvertising + 1 }).profit, -1);
});

test('refund losses are subtracted once through retained revenue, not again as expenses', () => {
  const r = run({ price: 100, breakageRate: 50, reshipShare: 0, commissionRate: 0, paymentRate: 0 });
  close(r.expectedRevenue, 50);
  close(r.profit, 50 - 57);
  close(r.breakageCost, 50);
  close(r.costBreakdown.reduce((sum, item) => sum + item.value, 0), 57);
  close(r.expectedRevenue - r.totalCost, r.profit);
});

test('monthly projection scales by original paid order count and changes no unit economics', () => {
  const a = run({ monthlyOrders: 0 });
  const b = run({ monthlyOrders: 1234 });
  close(a.monthlyProfit, 0);
  close(a.monthlyRevenue, 0);
  close(b.monthlyProfit, b.profit * 1234);
  close(b.monthlyRevenue, b.expectedRevenue * 1234);
  for (const field of ['profit', 'margin', 'breakageCost', 'breakEvenPrice', 'targetPrice']) close(a[field], b[field]);
});

test('after-sales parameters do not affect orders with no breakage', () => {
  const a = run({ breakageRate: 0 });
  const b = run({ breakageRate: 0, reshipShare: 0, reshipProduct: 999, reshipPackaging: 999, reshipShipping: 999, reshipOther: 999, refundExtra: 999, refundFeeRecovery: 100 });
  for (const field of ['profit', 'margin', 'breakEvenPrice', 'targetPrice']) close(a[field], b[field]);
});

test('refund parameters do not affect reship-only damage, reship costs do not affect refund-only damage', () => {
  const reshipA = run({ reshipShare: 100 });
  const reshipB = run({ reshipShare: 100, refundExtra: 1000, refundFeeRecovery: 100 });
  close(reshipA.profit, reshipB.profit);
  const refundA = run({ reshipShare: 0 });
  const refundB = run({ reshipShare: 0, reshipProduct: 1000, reshipPackaging: 1000, reshipShipping: 1000, reshipOther: 1000 });
  close(refundA.profit, refundB.profit);
});

test('changing target margin never changes underlying economics', () => {
  const a = run({ targetMargin: 0 });
  const b = run({ targetMargin: 99 });
  for (const field of ['profit', 'margin', 'breakEvenPrice', 'maxAdvertising', 'monthlyProfit']) close(a[field], b[field]);
  close(a.targetPrice, a.breakEvenPrice);
  assert.equal(b.targetPrice, null);
});

test('result snapshots do not mutate caller input or defaults; unknown fields are ignored', () => {
  const x = input({ extra: 'ignored' });
  const saved = { ...x };
  const r = model.calculate(x);
  assert.deepEqual(x, saved);
  assert.equal(r.input.extra, undefined);
  r.input.price = 1;
  assert.equal(x.price, 99);
  assert.equal(model.defaults.price, 99);
  r.costBreakdown[0].value = 999;
  close(run().costBreakdown[0].value, 32);
});

test('deterministic broad scenarios satisfy probability, profit, cost, and counterfactual invariants', () => {
  let seed = 90210;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 500; i++) {
    const x = input({
      price: rand() * 10000, product: rand() * 1000, packaging: rand() * 100,
      shipping: rand() * 100, fixedFee: rand() * 10, advertising: rand() * 200, other: rand() * 20,
      commissionRate: rand() * 100, paymentRate: rand() * 100,
      breakageRate: rand() * 100, reshipShare: rand() * 100,
      reshipProduct: rand() * 1000, reshipPackaging: rand() * 100,
      reshipShipping: rand() * 100, reshipOther: rand() * 20,
      refundExtra: rand() * 100, refundFeeRecovery: rand() * 100,
      targetMargin: rand() * 100, monthlyOrders: Math.floor(rand() * 100000)
    });
    const r = model.calculate(x);
    close(r.pReship + r.pRefund, x.breakageRate / 100);
    assert.ok(r.pReship >= 0 && r.pRefund >= 0 && r.pReship + r.pRefund <= 1);
    close(r.profit, r.expectedRevenue - r.totalCost);
    close(r.profit, r.noBreakageProfit - r.breakageCost);
    close(r.totalCost, r.costBreakdown.reduce((sum, item) => sum + item.value, 0));
    close(r.percentageFees, r.commissionFees + r.paymentFees);
    if (r.breakEvenPrice !== null && r.priceCoefficient > 0) close(model.calculate({ ...x, price: r.breakEvenPrice }).profit, 0, 1e-8);
    if (r.targetPrice !== null && r.targetPrice > 0) close(model.calculate({ ...x, price: r.targetPrice }).margin, x.targetMargin / 100);
  }
});

test('extreme accepted amounts and order counts produce finite outputs', () => {
  const x = input({ ...Object.fromEntries(Object.keys(zeroCosts).map(key => [key, 100000000])), price: 100000000, monthlyOrders: 100000000, commissionRate: 100, paymentRate: 100 });
  const r = model.calculate(x);
  for (const [key, value] of Object.entries(r)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must remain finite`);
  }
  close(r.monthlyProfit, r.profit * 100000000);
});

test('all refunds with zero cost and full fee recovery break even but never define a margin', () => {
  const r = run({ ...zeroCosts, breakageRate: 100, reshipShare: 0, refundFeeRecovery: 100 });
  close(r.profit, 0);
  close(r.breakEvenPrice, 0);
  assert.equal(r.breakEvenReason, 'all_prices_break_even');
  assert.equal(r.margin, null);
  assert.equal(r.targetPrice, null);
  assert.equal(r.targetReason, 'no_retained_revenue');
});

test('fixed and advertising costs are charged once per original paid order, even on refund', () => {
  const a = run({ breakageRate: 100, reshipShare: 0, refundFeeRecovery: 100 });
  const b = run({ breakageRate: 100, reshipShare: 0, refundFeeRecovery: 100, fixedFee: 7, advertising: 23 });
  close(a.profit - b.profit, 18);
  close(b.baseCost - a.baseCost, 18);
  close(a.recoveredFees, b.recoveredFees);
});

test('changing the split between platform and payment rates preserves total economics', () => {
  const a = run({ commissionRate: 7, paymentRate: 3, refundFeeRecovery: 80 });
  const b = run({ commissionRate: 4, paymentRate: 6, refundFeeRecovery: 80 });
  for (const key of ['profit', 'percentageFees', 'breakEvenPrice', 'targetPrice', 'breakageCost']) close(a[key], b[key]);
  assert.notEqual(a.commissionFees, b.commissionFees);
});

test('profit is affine in original price, including mixed after-sales and fee recovery', () => {
  const x = { breakageRate: 42, reshipShare: 17, refundFeeRecovery: 63, refundExtra: 9 };
  const a = run({ ...x, price: 0 });
  const b = run({ ...x, price: 100 });
  const c = run({ ...x, price: 250 });
  close(c.profit - a.profit, 2.5 * (b.profit - a.profit));
  close(c.profit - b.profit, 150 * c.priceCoefficient);
});
