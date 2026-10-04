/* Teaware merchant contribution model. No dependencies; usable via <script> or require(). */
(function (root, factory) {
  'use strict';
  var model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ProfitModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var defaults = Object.freeze({
    price: 99,
    product: 32,
    packaging: 5,
    shipping: 8,
    commissionRate: 5,
    paymentRate: 0.6,
    fixedFee: 0,
    advertising: 12,
    other: 0,
    breakageRate: 3,
    reshipShare: 80,
    reshipProduct: 32,
    reshipPackaging: 5,
    reshipShipping: 8,
    reshipOther: 0,
    refundExtra: 0,
    refundFeeRecovery: 0,
    targetMargin: 20,
    monthlyOrders: 1000
  });
  var fields = Object.freeze(Object.keys(defaults));
  var percentages = Object.freeze([
    'commissionRate', 'paymentRate', 'breakageRate', 'reshipShare',
    'refundFeeRecovery', 'targetMargin'
  ]);
  var MAX_VALUE = 100000000;

  /** No silent defaults or coercion: all fields must be supplied as finite numbers. */
  function validate(input) {
    var errors = {};
    var source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    fields.forEach(function (key) {
      var value = source[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors[key] = '请输入有效数字';
      } else if (percentages.indexOf(key) !== -1) {
        if (value < 0 || value > 100) errors[key] = '请输入 0 至 100 之间的百分比';
      } else if (key === 'monthlyOrders') {
        if (!Number.isInteger(value) || value < 0 || value > MAX_VALUE) {
          errors[key] = '请输入 0 至 100,000,000 之间的整数';
        }
      } else if (key === 'price') {
        if (value < 0 || value > MAX_VALUE) errors[key] = '请输入 0 至 100,000,000 之间的售价';
      } else if (value < 0 || value > MAX_VALUE) {
        errors[key] = '请输入 0 至 100,000,000 之间的金额';
      }
    });
    return errors;
  }

  // Avoid a spurious enormous threshold when cancellation leaves a rounding residual.
  // This tolerance is at machine precision, not a business-level rounding tolerance.
  function cancellationZero(value, scale) {
    return Math.abs(value) <= Number.EPSILON * 4 * Math.max(1, scale) ? 0 : value;
  }
  function nonnegativeLimit(value) {
    return value >= 0 && Number.isFinite(value) ? value : null;
  }

  /**
   * All money is in the same user-selected currency (the UI uses CNY).
   * Rates in input are percentage points; returned probabilities/margin are fractions.
   * The unit is ONE ORIGINAL PAID ORDER, including its expected after-sales outcome.
   * Damage outcomes are mutually exclusive: one reshipment OR one full refund.
   * A reshipment is assumed to succeed; repeated damage is outside this model.
   * Percentage fees are charged on the original sale; q is their refunded share.
   * Fixed transaction fees and all original order costs are never recovered.
   * No costs or intermediate amounts are rounded. Format money only in the UI.
   */
  function calculate(input) {
    var errors = validate(input);
    if (Object.keys(errors).length) {
      var invalid = new Error('输入数据无效');
      invalid.name = 'ValidationError';
      invalid.errors = errors;
      throw invalid;
    }
    var x = {};
    fields.forEach(function (key) { x[key] = input[key]; });
    var b = x.breakageRate / 100;
    var s = x.reshipShare / 100;
    var pReship = b * s;
    var pRefund = b * (1 - s);
    var retainedRevenueCoefficient = 1 - pRefund;
    var feeRate = (x.commissionRate + x.paymentRate) / 100;
    var q = x.refundFeeRecovery / 100;
    var feeRetentionCoefficient = 1 - pRefund * q;
    var baseCost = x.product + x.packaging + x.shipping + x.fixedFee + x.advertising + x.other;
    var reshipUnitCost = x.reshipProduct + x.reshipPackaging + x.reshipShipping + x.reshipOther;
    var reshipCost = pReship * reshipUnitCost;
    var refundCost = pRefund * x.refundExtra;
    var constantCost = baseCost + reshipCost + refundCost;
    var expectedRevenue = x.price * retainedRevenueCoefficient;
    var percentageFees = x.price * feeRate * feeRetentionCoefficient;
    var commissionFees = x.price * (x.commissionRate / 100) * feeRetentionCoefficient;
    var paymentFees = x.price * (x.paymentRate / 100) * feeRetentionCoefficient;
    var recoveredFees = x.price * feeRate * pRefund * q;
    var lostRevenue = x.price * pRefund;
    var breakageCost = reshipCost + refundCost + lostRevenue - recoveredFees;
    var priceCoefficient = cancellationZero(
      retainedRevenueCoefficient - feeRate * feeRetentionCoefficient,
      retainedRevenueCoefficient + feeRate * feeRetentionCoefficient
    );
    var profit = priceCoefficient * x.price - constantCost;
    var margin = expectedRevenue > 0 ? profit / expectedRevenue : null;
    var totalCost = constantCost + percentageFees;
    var breakEvenPrice = null;
    var breakEvenReason = null;
    if (priceCoefficient > 0) {
      breakEvenPrice = constantCost / priceCoefficient;
      if (!Number.isFinite(breakEvenPrice)) {
        breakEvenPrice = null;
        breakEvenReason = 'numeric_overflow';
      }
    } else if (constantCost === 0) {
      breakEvenPrice = 0;
      breakEvenReason = priceCoefficient === 0 ? 'all_prices_break_even' : 'zero_price_only';
    } else {
      breakEvenReason = 'nonpositive_price_coefficient';
    }

    var targetRatio = x.targetMargin / 100;
    var targetDenominator = cancellationZero(
      priceCoefficient - targetRatio * retainedRevenueCoefficient,
      Math.abs(priceCoefficient) + targetRatio * retainedRevenueCoefficient
    );
    var targetPrice = null;
    var targetReason = null;
    var targetPriceIsInfimum = false;
    if (retainedRevenueCoefficient === 0) {
      targetReason = 'no_retained_revenue';
    } else if (targetDenominator > 0) {
      targetPrice = constantCost / targetDenominator;
      if (!Number.isFinite(targetPrice)) {
        targetPrice = null;
        targetReason = 'numeric_overflow';
      } else if (targetPrice === 0) {
        // Any positive price meets the target, but margin at price zero is undefined.
        targetPriceIsInfimum = true;
        targetReason = 'positive_price_required';
      }
    } else if (targetDenominator === 0 && constantCost === 0) {
      // Every positive price meets the target exactly; no smallest positive price exists.
      targetReason = 'any_positive_price';
      targetPriceIsInfimum = true;
    } else {
      targetReason = 'unreachable_target';
    }

    var advertisingHeadroom = cancellationZero(profit + x.advertising, Math.abs(profit) + x.advertising);
    var advertisingHeadroomAtTarget = cancellationZero(
      advertisingHeadroom - targetRatio * expectedRevenue,
      Math.abs(advertisingHeadroom) + targetRatio * expectedRevenue
    );
    var costBreakdown = [
      { key: 'product', label: '货品成本', value: x.product },
      { key: 'packaging', label: '包装成本', value: x.packaging },
      { key: 'shipping', label: '首发运费', value: x.shipping },
      { key: 'commissionFees', label: '平台佣金', value: commissionFees },
      { key: 'paymentFees', label: '支付手续费', value: paymentFees },
      { key: 'fixedFee', label: '每单固定费用', value: x.fixedFee },
      { key: 'advertising', label: '每单获客成本', value: x.advertising },
      { key: 'other', label: '其他每单成本', value: x.other },
      { key: 'reshipCost', label: '期望补寄成本', value: reshipCost },
      { key: 'refundCost', label: '期望退款额外成本', value: refundCost }
    ];

    return {
      input: x,
      pReship: pReship,
      pRefund: pRefund,
      retainedRevenueCoefficient: retainedRevenueCoefficient,
      feeRate: feeRate,
      expectedRevenue: expectedRevenue,
      percentageFees: percentageFees,
      commissionFees: commissionFees,
      paymentFees: paymentFees,
      recoveredFees: recoveredFees,
      lostRevenue: lostRevenue,
      baseCost: baseCost,
      reshipUnitCost: reshipUnitCost,
      reshipCost: reshipCost,
      refundCost: refundCost,
      // Net expected reduction from the no-breakage profit, not an extra chart expense.
      breakageCost: breakageCost,
      extraCost: reshipCost + refundCost,
      constantCost: constantCost,
      totalCost: totalCost,
      priceCoefficient: priceCoefficient,
      profit: profit,
      margin: margin,
      noBreakageProfit: x.price * (1 - feeRate) - baseCost,
      breakEvenPrice: breakEvenPrice,
      breakEvenReason: breakEvenReason,
      targetDenominator: targetDenominator,
      targetPrice: targetPrice,
      targetReason: targetReason,
      targetPriceIsInfimum: targetPriceIsInfimum,
      advertisingHeadroom: advertisingHeadroom,
      maxAdvertising: nonnegativeLimit(advertisingHeadroom),
      advertisingHeadroomAtTarget: advertisingHeadroomAtTarget,
      maxAdvertisingAtTarget: expectedRevenue > 0 ? nonnegativeLimit(advertisingHeadroomAtTarget) : null,
      monthlyProfit: profit * x.monthlyOrders,
      monthlyRevenue: expectedRevenue * x.monthlyOrders,
      costBreakdown: costBreakdown,
      diagnostics: {
        noRetainedRevenue: retainedRevenueCoefficient === 0,
        nonpositivePriceCoefficient: priceCoefficient <= 0,
        combinedFeesAtLeast100Percent: feeRate >= 1,
        negativeProfit: profit < 0,
        zeroPrice: x.price === 0
      }
    };
  }

  return Object.freeze({ defaults: defaults, fields: fields, validate: validate, calculate: calculate });
}));
