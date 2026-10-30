import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { TimeSeriesResponse } from '../../types/api';
import {
  formatNumber,
  formatTime,
  formatDateTime,
  formatDate,
} from '../../utils/format';
const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #E2E8F0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
};

const AXIS_STYLE = {
  tick: { fontSize: 12, fill: '#64748B' },
  axisLine: { stroke: '#E2E8F0' },
  tickLine: { stroke: '#E2E8F0' },
};

export function GenerationChart({
  chartData,
}: {
  chartData: TimeSeriesResponse['records'];
}) {
  return (
    <div className="h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis
            dataKey="delivery_start_utc"
            type="category"
            tickFormatter={(value) =>
              chartData[0]?.settlement_date !==
              chartData[chartData.length - 1]?.settlement_date
                ? formatDate(value)
                : formatTime(value)
            }
            minTickGap={32}
            {...AXIS_STYLE}
          />
          <YAxis
            tickFormatter={(value) => formatNumber(value, 0)}
            {...AXIS_STYLE}
          />
          <Tooltip
            formatter={(value, name) => [
              typeof value === 'number' ? formatNumber(value) : '—',
              name,
            ]}
            labelFormatter={(value) =>
              value ? formatDateTime(String(value)) : ''
            }
            contentStyle={TOOLTIP_STYLE}
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
          <Line
            type="monotone"
            dataKey="forecast_generation_mw"
            name="Forecast (MW)"
            stroke="var(--color-forecast)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-forecast)' }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="actual_generation_mw"
            name="Actual (MW)"
            stroke="var(--color-actual)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-actual)' }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ErrorChart({
  chartData,
}: {
  chartData: TimeSeriesResponse['records'];
}) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis
            dataKey="delivery_start_utc"
            type="category"
            tickFormatter={(value) =>
              chartData[0]?.settlement_date !==
              chartData[chartData.length - 1]?.settlement_date
                ? formatDate(value)
                : formatTime(value)
            }
            minTickGap={32}
            {...AXIS_STYLE}
          />
          <YAxis
            tickFormatter={(value) => formatNumber(value, 0)}
            {...AXIS_STYLE}
          />
          <Tooltip
            formatter={(value, name) => [
              typeof value === 'number' ? formatNumber(value) : '—',
              name,
            ]}
            labelFormatter={(value) =>
              value ? formatDateTime(String(value)) : ''
            }
            contentStyle={TOOLTIP_STYLE}
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
          <ReferenceLine
            y={0}
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <Bar
            dataKey="error_mw"
            name="Error (MW)"
            isAnimationActive={false}
            radius={[4, 4, 0, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={index}
                fill={
                  entry.error_mw === null
                    ? '#94A3B8'
                    : entry.error_mw > 0
                      ? 'var(--color-overestimation)'
                      : 'var(--color-underestimation)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
