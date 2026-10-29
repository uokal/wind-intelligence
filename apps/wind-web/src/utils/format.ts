export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumberCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercentage(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function formatDateTime(dateString: string | null | undefined, timezone = 'Europe/London'): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: timezone,
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatTime(dateString: string | null | undefined, timezone = 'Europe/London'): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeStyle: 'medium',
      timeZone: timezone,
    }).format(date);
  } catch {
    return '—';
  }
}

export function getSelectionStatusLabel(status: string): string {
  switch (status) {
    case 'selected':
      return 'Selected';
    case 'no_eligible_forecast':
      return 'No eligible forecast (after cutoff)';
    case 'no_forecast_at_all':
      return 'No forecast available';
    default:
      return status;
  }
}

export function getSelectionStatusColor(status: string): string {
  switch (status) {
    case 'selected':
      return 'text-green-700 bg-green-50 border-green-200';
    case 'no_eligible_forecast':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    case 'no_forecast_at_all':
      return 'text-red-700 bg-red-50 border-red-200';
    default:
      return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}

export function getAlignmentStatusLabel(status: string): string {
  switch (status) {
    case 'matched':
      return 'Matched';
    case 'missing_forecast':
      return 'Missing forecast';
    case 'missing_actual':
      return 'Missing actual';
    default:
      return status;
  }
}

export function getAlignmentStatusColor(status: string): string {
  switch (status) {
    case 'matched':
      return 'text-green-700 bg-green-50 border-green-200';
    case 'missing_forecast':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    case 'missing_actual':
      return 'text-blue-700 bg-blue-50 border-blue-200';
    default:
      return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}

export function getErrorColor(error: number | null): string {
  if (error === null || error === undefined) return 'text-gray-500';
  if (error > 0) return 'text-red-600'; // Overestimation
  if (error < 0) return 'text-blue-600'; // Underestimation
  return 'text-gray-700';
}

export function getBiasLabel(bias: number): { label: string; color: string } {
  if (bias > 10) return { label: 'Overestimation bias', color: 'text-red-600' };
  if (bias < -10) return { label: 'Underestimation bias', color: 'text-blue-600' };
  return { label: 'Neutral', color: 'text-green-600' };
}