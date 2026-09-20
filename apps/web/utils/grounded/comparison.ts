import {
  comparisonInterpretationSchema,
  groundedResponseSchema,
  type ComparisonInterpretation,
  type GroundedReason,
  type GroundedRequest,
  type GroundedResponse,
} from '@adc/contracts';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const messages = {
  en: {
    ambiguous_scope:
      'Please specify one region and two monthly periods clearly, then edit and resubmit your question.',
    missing_periods:
      'Please name two distinct months to compare, then edit and resubmit your question.',
    unsupported_metric:
      'VSual currently compares completed-order counts for one region and two months. Revenue and other metrics are not supported.',
    unsupported_operation:
      'VSual can compare completed-order counts. It cannot explain causes, forecast results or perform website actions.',
    region_mismatch:
      'The requested region does not match this captured table. Change the dashboard yourself or edit your question, then capture it again.',
    year_mismatch:
      'The requested year does not match this captured table. Change the dashboard yourself or edit your question, then capture it again.',
    same_period:
      'Please choose two different months, then edit and resubmit your question.',
    missing_data:
      'This captured table does not contain both requested months. No comparison was calculated.',
    ambiguous_data:
      'The captured rows are ambiguous. Refresh the supported table and capture it again; no comparison was calculated.',
  },
  vi: {
    ambiguous_scope:
      'Vui lòng nêu rõ một khu vực và hai tháng, rồi sửa và gửi lại câu hỏi.',
    missing_periods:
      'Vui lòng nêu hai tháng khác nhau cần so sánh, rồi sửa và gửi lại câu hỏi.',
    unsupported_metric:
      'VSual hiện chỉ so sánh số đơn hoàn thành của một khu vực trong hai tháng. Chưa hỗ trợ doanh thu hoặc chỉ số khác.',
    unsupported_operation:
      'VSual có thể so sánh số đơn hoàn thành. Chưa hỗ trợ giải thích nguyên nhân, dự báo hoặc thao tác trên trang web.',
    region_mismatch:
      'Khu vực được hỏi không khớp với bảng đã chụp. Hãy tự đổi khu vực trên trang hoặc sửa câu hỏi, rồi đọc lại bảng.',
    year_mismatch:
      'Năm được hỏi không khớp với bảng đã chụp. Hãy tự đổi năm trên trang hoặc sửa câu hỏi, rồi đọc lại bảng.',
    same_period:
      'Vui lòng chọn hai tháng khác nhau, rồi sửa và gửi lại câu hỏi.',
    missing_data:
      'Bảng đã chụp không có đủ hai tháng được hỏi. Chưa thực hiện phép so sánh.',
    ambiguous_data:
      'Các dòng đã chụp không xác định được duy nhất. Hãy làm mới và đọc lại bảng; chưa thực hiện phép so sánh.',
  },
} satisfies Record<'en' | 'vi', Record<GroundedReason, string>>;

/** Keep the rational calculation exact until final display rounding (half away from zero). */
function percentage(difference: bigint, baseline: bigint): string | null {
  if (baseline === 0n) return null;
  const magnitude = difference < 0n ? -difference : difference;
  const numerator = magnitude * 10_000n;
  const rounded =
    numerator / baseline + ((numerator % baseline) * 2n >= baseline ? 1n : 0n);
  const integer = rounded / 100n;
  const fraction = (rounded % 100n)
    .toString()
    .padStart(2, '0')
    .replace(/0+$/, '');
  const sign = difference < 0n && rounded !== 0n ? '-' : '';
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}

export function calculateComparison(
  request: GroundedRequest,
  uncheckedInterpretation: ComparisonInterpretation,
): GroundedResponse {
  const interpretation = comparisonInterpretationSchema.parse(
    uncheckedInterpretation,
  );
  const { snapshot, language } = request;
  const linkage = {
    request_id: request.request_id,
    snapshot_id: snapshot.snapshot_id,
    fingerprint: snapshot.fingerprint,
  };
  const explanation = (
    reason: GroundedReason,
    status: 'clarification' | 'unsupported' = 'clarification',
  ): GroundedResponse => ({
    ...linkage,
    status,
    text: messages[language][reason],
    reason,
  });

  if (interpretation.decision !== 'comparison') {
    return explanation(
      interpretation.reason ?? 'ambiguous_scope',
      interpretation.decision,
    );
  }
  const { baseline_period, comparison_period, region } = interpretation;
  if (!baseline_period || !comparison_period || !region) {
    return explanation('ambiguous_scope');
  }
  if (region !== snapshot.region) return explanation('region_mismatch');
  if (
    [baseline_period, comparison_period].some(
      (period) => Number(period.slice(0, 4)) !== snapshot.year,
    )
  ) {
    return explanation('year_mismatch');
  }
  if (baseline_period === comparison_period) return explanation('same_period');

  const baselineRows = snapshot.rows.filter(
    (row) => row.period === baseline_period && row.region === region,
  );
  const comparisonRows = snapshot.rows.filter(
    (row) => row.period === comparison_period && row.region === region,
  );
  if (baselineRows.length > 1 || comparisonRows.length > 1)
    return explanation('ambiguous_data');
  const baselineRow = baselineRows[0];
  const comparisonRow = comparisonRows[0];
  if (!baselineRow || !comparisonRow) return explanation('missing_data');

  const baseline = BigInt(baselineRow.value);
  const comparison = BigInt(comparisonRow.value);
  const difference = comparison - baseline;
  const change = percentage(difference, baseline);
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  const format = (value: bigint) => new Intl.NumberFormat(locale).format(value);
  const magnitude = format(difference < 0n ? -difference : difference);
  const month = (period: string) =>
    language === 'vi'
      ? `tháng ${Number(period.slice(5))}`
      : months[Number(period.slice(5)) - 1];
  const direction =
    language === 'vi'
      ? `từ ${month(baseline_period)} đến ${month(comparison_period)} năm ${snapshot.year}`
      : `from ${month(baseline_period)} to ${month(comparison_period)} ${snapshot.year}`;
  const regionLabel =
    language === 'vi' && region === 'South' ? 'miền Nam' : region;
  const percentMagnitude = change
    ?.replace(/^-/, '')
    .replace('.', language === 'vi' ? ',' : '.');
  let text: string;
  if (difference === 0n) {
    text =
      language === 'vi'
        ? `Số đơn hoàn thành ở ${regionLabel} không đổi, ở mức ${format(baseline)} đơn ${direction}.`
        : `Completed orders in the ${regionLabel} were unchanged at ${format(baseline)} orders ${direction}.`;
  } else if (language === 'vi') {
    text = `Số đơn hoàn thành ở ${regionLabel} ${difference < 0n ? 'giảm' : 'tăng'} ${magnitude} đơn${change !== null ? `, tương đương ${percentMagnitude}%` : ''}, ${direction}.`;
  } else {
    text = `Completed orders in the ${regionLabel} ${difference < 0n ? 'decreased' : 'increased'} by ${magnitude}${change !== null ? `, or ${percentMagnitude}%,` : ' orders'} ${direction}.`;
  }
  const limitation =
    change === null
      ? language === 'vi'
        ? 'Không thể tính phần trăm thay đổi vì giá trị ban đầu bằng 0.'
        : 'Percentage change cannot be calculated from a zero baseline.'
      : null;
  if (limitation) {
    text +=
      language === 'vi'
        ? ` Giá trị ban đầu: ${format(baseline)} đơn; giá trị so sánh: ${format(comparison)} đơn. ${limitation}`
        : ` Baseline: ${format(baseline)} orders; comparison: ${format(comparison)} orders. ${limitation}`;
  }

  const subtraction =
    language === 'vi'
      ? `${format(comparison)} trừ ${format(baseline)} bằng ${format(difference)} đơn.`
      : `${format(comparison)} minus ${format(baseline)} equals ${format(difference)} orders.`;
  const description =
    change === null
      ? `${subtraction} ${limitation}`
      : language === 'vi'
        ? `${subtraction} Lấy chênh lệch chia cho giá trị ban đầu ${format(baseline)}, rồi nhân 100: ${change.replace('.', ',')}% (làm tròn tối đa hai chữ số thập phân).`
        : `${subtraction} Divide the difference by the baseline ${format(baseline)}, then multiply by 100: ${change}% (rounded to at most two decimal places).`;

  return groundedResponseSchema.parse({
    ...linkage,
    status: 'answer',
    text,
    evidence: {
      origin: snapshot.origin,
      pathname: snapshot.pathname,
      captured_at: snapshot.captured_at,
      table_title: snapshot.table_title,
      region: snapshot.region,
      year: snapshot.year,
      metric: snapshot.metric,
      unit: snapshot.unit,
      rows: [baselineRow, comparisonRow],
      baseline_row_id: baselineRow.id,
      comparison_row_id: comparisonRow.id,
      calculation: {
        baseline: baselineRow.value,
        comparison: comparisonRow.value,
        difference: Number(difference),
        percentage_change: change,
        description,
        limitation,
      },
    },
  });
}
