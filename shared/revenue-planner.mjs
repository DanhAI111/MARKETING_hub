const WEIGHT_TOLERANCE = 0.001;

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const clone = (value) => structuredClone(value);

export const DEFAULT_WEIGHTS = deepFreeze({
  tier1: {
    core: 0.8,
    brand: 0.2
  },
  tier2: {
    core: 0.7,
    newStrategy: 0.2,
    experiment: 0.1
  },
  tier3: {
    digital: 0.7,
    traditional: 0.3
  },
  tier4: {
    seoSocial: 0.2,
    digitalAds: 0.15,
    emailAuto: 0.1,
    martech: 0.1,
    fair: 0.05,
    printing: 0.05,
    pressOOH: 0.05,
    abm: 0.07,
    influencer: 0.07,
    roadshow: 0.06,
    chatbot: 0.03,
    podcast: 0.03,
    gift: 0.04
  },
  channels: {
    metaAds: 0.2,
    tiktok: 0.1,
    facebookOrganic: 0.05,
    googleAds: 0.25,
    linkedin: 0.15,
    zalo: 0.1,
    partners: 0.15
  },
  content: {
    customerService: 0.4,
    promo: 0.3,
    educational: 0.2,
    brandStory: 0.1
  },
  monthlyMoM: 0.05
});

const REQUIRED_WEIGHT_GROUPS = Object.freeze([
  'tier1',
  'tier2',
  'tier3',
  'tier4',
  'channels',
  'content'
]);

const TIER4_GROUPS = Object.freeze({
  seoSocial: ['core', 'digital'],
  digitalAds: ['core', 'digital'],
  emailAuto: ['core', 'digital'],
  martech: ['core', 'digital'],
  fair: ['core', 'traditional'],
  printing: ['core', 'traditional'],
  pressOOH: ['core', 'traditional'],
  abm: ['newStrategy', 'digital'],
  influencer: ['newStrategy', 'digital'],
  roadshow: ['newStrategy', 'traditional'],
  chatbot: ['experiment', 'digital'],
  podcast: ['experiment', 'digital'],
  gift: ['experiment', 'traditional']
});

export const PERIOD_MONTHS = Object.freeze({ month: 1, quarter: 3, year: 12 });

const resolvePeriodMonths = (period) => PERIOD_MONTHS[period] ?? PERIOD_MONTHS.year;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const hasPositiveNumber = (value) => isFiniteNumber(value) && value > 0;

const resolveTargetRevenue = (inputs) => (
  hasPositiveNumber(inputs?.targetRevenue)
    ? inputs.targetRevenue
    : inputs?.prevRevenue * inputs?.growth
);

const validationError = (errors) => {
  const error = new Error(errors.join(' '));
  error.name = 'RevenuePlannerValidationError';
  error.status = 400;
  error.errors = [...errors];
  return error;
};

const assertValidInputs = (inputs) => {
  const validation = validateInputs(inputs);
  if (!validation.valid) throw validationError(validation.errors);
};

export const validateInputs = (inputs = {}) => {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return deepFreeze({ valid: false, errors: ['Đầu vào kế hoạch phải là một object.'] });
  }
  const errors = [];
  const hasDirectTarget = hasPositiveNumber(inputs.targetRevenue);
  const hasDerivedTarget = hasPositiveNumber(inputs.prevRevenue)
    && hasPositiveNumber(inputs.growth);

  if (!hasDirectTarget && !hasDerivedTarget) {
    errors.push('Cần doanh thu mục tiêu dương hoặc doanh thu năm trước và hệ số tăng trưởng dương.');
  }
  if (inputs.targetRevenue !== undefined && !hasPositiveNumber(inputs.targetRevenue)) {
    errors.push('Doanh thu mục tiêu phải là số lớn hơn 0.');
  }
  if (inputs.prevRevenue !== undefined && !hasPositiveNumber(inputs.prevRevenue)) {
    errors.push('Doanh thu năm trước phải là số lớn hơn 0.');
  }
  if (inputs.growth !== undefined && !hasPositiveNumber(inputs.growth)) {
    errors.push('Hệ số tăng trưởng phải là số lớn hơn 0.');
  }
  if (!hasPositiveNumber(inputs.aov)) {
    errors.push('AOV phải là số lớn hơn 0.');
  }
  if (!isFiniteNumber(inputs.mktRatio) || inputs.mktRatio <= 0 || inputs.mktRatio >= 1) {
    errors.push('Tỷ lệ chi phí marketing phải lớn hơn 0 và nhỏ hơn 1.');
  }
  if (!isFiniteNumber(inputs.sqlPerLead) || inputs.sqlPerLead <= 0 || inputs.sqlPerLead > 1) {
    errors.push('Tỷ lệ SQL/Lead phải nằm trong khoảng (0, 1].');
  }
  if (!isFiniteNumber(inputs.orderPerSql) || inputs.orderPerSql <= 0 || inputs.orderPerSql > 1) {
    errors.push('Tỷ lệ Đơn hàng/SQL phải nằm trong khoảng (0, 1].');
  }
  if (inputs.monthlyMoM !== undefined
    && (!isFiniteNumber(inputs.monthlyMoM) || inputs.monthlyMoM <= -1 || inputs.monthlyMoM > 1)) {
    errors.push('Tăng trưởng theo tháng phải nằm trong khoảng (-1, 1].');
  }
  if (inputs.months !== undefined
    && (!Number.isInteger(inputs.months) || inputs.months < 1 || inputs.months > 60)) {
    errors.push('Số tháng phải là số nguyên từ 1 đến 60.');
  }
  if (inputs.grossMargin !== undefined
    && (!isFiniteNumber(inputs.grossMargin) || inputs.grossMargin <= 0 || inputs.grossMargin > 1)) {
    errors.push('Biên lợi nhuận gộp phải nằm trong khoảng (0, 1].');
  }
  if (inputs.purchaseFrequency !== undefined
    && (!isFiniteNumber(inputs.purchaseFrequency) || inputs.purchaseFrequency <= 0)) {
    errors.push('Số đơn/khách phải là số lớn hơn 0.');
  }
  if (inputs.period !== undefined && PERIOD_MONTHS[inputs.period] === undefined) {
    errors.push('Kỳ tính phải là "month", "quarter" hoặc "year".');
  }
  for (const [field, label] of [
    ['marketShare', 'Thị phần mục tiêu'],
    ['retentionRate', 'Tỷ lệ giữ chân khách hàng']
  ]) {
    if (inputs[field] !== undefined
      && (!isFiniteNumber(inputs[field]) || inputs[field] < 0 || inputs[field] > 1)) {
      errors.push(`${label} phải nằm trong khoảng [0, 1].`);
    }
  }

  return deepFreeze({ valid: errors.length === 0, errors });
};

export const mergeWeightsWithDefaults = (overrides = {}) => {
  const merged = {};
  for (const group of REQUIRED_WEIGHT_GROUPS) {
    merged[group] = { ...DEFAULT_WEIGHTS[group] };
    const candidate = overrides?.[group];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    for (const key of Object.keys(DEFAULT_WEIGHTS[group])) {
      if (isFiniteNumber(candidate[key])) merged[group][key] = candidate[key];
    }
  }
  merged.monthlyMoM = isFiniteNumber(overrides?.monthlyMoM)
    ? overrides.monthlyMoM
    : DEFAULT_WEIGHTS.monthlyMoM;
  return deepFreeze(merged);
};

export const validateWeights = (weights = DEFAULT_WEIGHTS) => {
  const warnings = [];

  for (const group of REQUIRED_WEIGHT_GROUPS) {
    const values = weights?.[group];
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      warnings.push({
        code: 'WEIGHT_SCHEMA',
        field: group,
        message: `Thiếu nhóm tỷ trọng ${group}.`
      });
      continue;
    }
    const invalidEntries = Object.entries(values)
      .filter(([, value]) => !isFiniteNumber(value) || value < 0 || value > 1);
    if (invalidEntries.length > 0) {
      warnings.push({
        code: 'WEIGHT_VALUE',
        field: group,
        message: `Nhóm ${group} có tỷ trọng ngoài khoảng 0–100%.`
      });
    }
    const total = Object.values(values)
      .filter(isFiniteNumber)
      .reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) {
      warnings.push({
        code: 'WEIGHT_TOTAL',
        field: group,
        total,
        message: `Tổng tỷ trọng ${group} là ${(total * 100).toFixed(1)}%, cần bằng 100%.`
      });
    }
  }

  return deepFreeze(warnings);
};

const allocationNode = (ratio, amountBase, extra = {}) => deepFreeze({
  ratio,
  amount: amountBase * ratio,
  ...extra
});

const allocateGroup = (budget, weights, metadata = {}) => deepFreeze(
  Object.fromEntries(Object.entries(weights).map(([key, ratio]) => [
    key,
    allocationNode(ratio, budget, metadata[key] || {})
  ]))
);

export const computeFunnel = (inputs, weights = DEFAULT_WEIGHTS) => {
  assertValidInputs(inputs);
  const resolvedWeights = mergeWeightsWithDefaults(weights);
  const targetRevenue = resolveTargetRevenue(inputs);
  const mktBudget = targetRevenue * inputs.mktRatio;
  const customers = targetRevenue / inputs.aov;
  const sql = customers / inputs.orderPerSql;
  const leads = sql / inputs.sqlPerLead;
  const customerBudget = mktBudget * resolvedWeights.tier1.core;
  const cac = customerBudget / customers;

  // Unit economics (chuẩn ngành). Optional inputs → default an toàn, không phá plan cũ.
  const grossMargin = hasPositiveNumber(inputs.grossMargin) ? inputs.grossMargin : 1;
  const purchaseFrequency = hasPositiveNumber(inputs.purchaseFrequency) ? inputs.purchaseFrequency : 1;
  const retentionRate = isFiniteNumber(inputs.retentionRate)
    && inputs.retentionRate >= 0 && inputs.retentionRate < 1
    ? inputs.retentionRate
    : 0;
  const marginPerCustomer = inputs.aov * purchaseFrequency * grossMargin;
  const ltv = marginPerCustomer / (1 - retentionRate);
  const grossProfit = targetRevenue * grossMargin;

  return deepFreeze({
    targetRevenue,
    mktBudget,
    customers,
    sql,
    leads,
    customerBudget,
    cps: cac,
    cac,
    grossMargin,
    grossProfit,
    ltv,
    ltvCacRatio: ltv / cac,
    paybackPeriods: cac / marginPerCustomer
  });
};

export const allocateBudget = (mktBudget, weights = DEFAULT_WEIGHTS) => {
  if (!hasPositiveNumber(mktBudget)) {
    throw validationError(['Ngân sách marketing phải là số lớn hơn 0.']);
  }
  const resolved = mergeWeightsWithDefaults(weights);
  const tier4Metadata = Object.fromEntries(
    Object.entries(TIER4_GROUPS).map(([key, [group, medium]]) => [key, { group, medium }])
  );

  return deepFreeze({
    tier1: allocateGroup(mktBudget, resolved.tier1),
    tier2: allocateGroup(mktBudget, resolved.tier2),
    tier3: allocateGroup(mktBudget, resolved.tier3),
    tier4: allocateGroup(mktBudget, resolved.tier4, tier4Metadata),
    channels: allocateGroup(mktBudget, resolved.channels),
    content: allocateGroup(mktBudget, resolved.content)
  });
};

export const spreadMonthly = (
  mktBudget,
  targetRevenue,
  monthlyMoM = DEFAULT_WEIGHTS.monthlyMoM,
  months = 12
) => {
  if (!hasPositiveNumber(mktBudget) || !hasPositiveNumber(targetRevenue)) {
    throw validationError(['Ngân sách marketing và doanh thu mục tiêu phải lớn hơn 0.']);
  }
  if (!isFiniteNumber(monthlyMoM) || monthlyMoM <= -1 || monthlyMoM > 1) {
    throw validationError(['Tăng trưởng theo tháng phải nằm trong khoảng (-1, 1].']);
  }
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw validationError(['Số tháng phải là số nguyên từ 1 đến 60.']);
  }

  const factors = Array.from({ length: months }, (_, index) => (1 + monthlyMoM) ** index);
  const factorTotal = factors.reduce((sum, value) => sum + value, 0);
  let allocatedBudget = 0;
  let allocatedRevenue = 0;
  const rows = factors.map((factor, index) => {
    const isLast = index === factors.length - 1;
    const budget = isLast ? mktBudget - allocatedBudget : mktBudget * factor / factorTotal;
    const revenueTarget = isLast
      ? targetRevenue - allocatedRevenue
      : targetRevenue * factor / factorTotal;
    allocatedBudget += budget;
    allocatedRevenue += revenueTarget;
    return {
      month: index + 1,
      budget,
      revenueTarget
    };
  });

  return deepFreeze(rows);
};

const businessWarnings = (inputs, funnel) => {
  const warnings = [];
  if (inputs.mktRatio >= 0.5) {
    warnings.push({
      code: 'HIGH_MARKETING_RATIO',
      field: 'mktRatio',
      message: 'Tỷ lệ marketing từ 50% doanh thu trở lên; nên kiểm tra lại biên lợi nhuận.'
    });
  }
  if (funnel.cps > inputs.aov) {
    warnings.push({
      code: 'CPS_ABOVE_AOV',
      field: 'cps',
      message: 'Chi phí tạo một khách hàng đang cao hơn AOV.'
    });
  }
  // Unit-economics warnings — chỉ khi user khai biên lợi nhuận (tránh nhiễu plan cũ).
  if (hasPositiveNumber(inputs.grossMargin)) {
    if (funnel.ltvCacRatio < 3) {
      warnings.push({
        code: 'LTV_CAC_LOW',
        field: 'ltvCacRatio',
        message: `Tỷ lệ LTV:CAC là ${funnel.ltvCacRatio.toFixed(1)}, dưới ngưỡng khỏe 3:1.`
      });
    }
    if (inputs.grossMargin < inputs.mktRatio) {
      warnings.push({
        code: 'MARGIN_BELOW_MKT',
        field: 'grossMargin',
        message: 'Biên lợi nhuận gộp thấp hơn tỷ lệ chi marketing; rủi ro lỗ.'
      });
    }
  }
  return warnings;
};

const uniqueWarnings = (warnings) => {
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.field}:${warning.total ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const computePlan = (inputs, weights = DEFAULT_WEIGHTS) => {
  assertValidInputs(inputs);
  const resolvedWeights = mergeWeightsWithDefaults(weights);
  const funnel = computeFunnel(inputs, resolvedWeights);
  const monthlyMoM = inputs.monthlyMoM ?? resolvedWeights.monthlyMoM;
  const period = inputs.period ?? 'year';
  const months = inputs.months ?? resolvePeriodMonths(period);
  const warnings = uniqueWarnings([
    ...(weights === DEFAULT_WEIGHTS ? [] : validateWeights(weights)),
    ...validateWeights(resolvedWeights),
    ...businessWarnings(inputs, funnel)
  ]);

  return deepFreeze({
    period,
    months,
    targetRevenue: funnel.targetRevenue,
    mktBudget: funnel.mktBudget,
    funnel,
    allocation: allocateBudget(funnel.mktBudget, resolvedWeights),
    monthly: spreadMonthly(
      funnel.mktBudget,
      funnel.targetRevenue,
      monthlyMoM,
      months
    ),
    weights: resolvedWeights,
    warnings
  });
};

const nudgeForIndustry = (weights, industry) => {
  const normalizedIndustry = String(industry || '').trim().toLowerCase();
  if (/\b(b2b|saas|phần mềm|doanh nghiệp)\b/u.test(normalizedIndustry)) {
    weights.channels.linkedin += 0.05;
    weights.channels.metaAds -= 0.03;
    weights.channels.tiktok -= 0.02;
    weights.tier4.abm += 0.03;
    weights.tier4.influencer -= 0.02;
    weights.tier4.roadshow -= 0.01;
    return 'Ngành B2B được ưu tiên LinkedIn và ABM để tiếp cận đúng tài khoản mục tiêu.';
  }
  if (/\b(e-?commerce|bán lẻ|retail|thương mại điện tử)\b/u.test(normalizedIndustry)) {
    weights.channels.metaAds += 0.03;
    weights.channels.linkedin -= 0.03;
    weights.tier4.digitalAds += 0.03;
    weights.tier4.martech -= 0.01;
    weights.tier4.seoSocial -= 0.02;
    return 'Ngành bán lẻ được tăng quảng cáo hiệu suất để hỗ trợ chuyển đổi ngắn hạn.';
  }
  return 'Chưa có tín hiệu ngành đủ mạnh nên giữ cơ cấu chuẩn cân bằng tăng trưởng và thương hiệu.';
};

export const suggestWeightsHeuristic = (inputs = {}) => {
  const weights = clone(DEFAULT_WEIGHTS);
  const industryReason = nudgeForIndustry(weights, inputs.industry);
  const normalizedWeights = mergeWeightsWithDefaults(weights);

  return deepFreeze({
    weights: normalizedWeights,
    reasons: [
      industryReason,
      'Duy trì 80% ngân sách tạo khách hàng và 20% xây dựng thương hiệu.',
      'Giữ 10% ngân sách thử nghiệm để học nhanh mà không làm tăng rủi ro toàn kế hoạch.'
    ],
    warnings: validateWeights(normalizedWeights),
    source: 'fallback'
  });
};
