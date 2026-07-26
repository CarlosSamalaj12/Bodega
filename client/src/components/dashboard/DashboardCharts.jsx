import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import './DashboardCharts.scss';

// --- Colores pastel apagados consistentes con el tema
const DONUT_COLORS = ['#6b8e7f', '#d4a373', '#c08585'];
const BAR_COLORS = { entradas: '#6b8e7f', salidas: '#8a9bb4' };

// --- Tooltip personalizado para el donut
function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="dchart__tooltip">
      <strong>{d.name}</strong>
      <span>{d.value} producto{d.value === 1 ? '' : 's'}</span>
      {d.payload.percent != null && (
        <span className="dchart__tooltip-pct">{d.payload.percent}%</span>
      )}
    </div>
  );
}

// --- Tooltip personalizado para la barra
function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dchart__tooltip">
      <strong>{label}</strong>
      {payload.map((p) => (
        <span key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value} u.
        </span>
      ))}
    </div>
  );
}

// --- Donut: Composición del inventario
function DonutChartCard({ data, loading }) {
  const total = useMemo(
    () => data.reduce((acc, d) => acc + d.value, 0),
    [data]
  );

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        percent:
          total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0',
      })),
    [data, total]
  );

  return (
    <Card
      title="Composición del inventario"
      subtitle={`${total} producto${total === 1 ? '' : 's'} en total`}
      compact
    >
      {loading ? (
        <div className="dchart__loading">
          <Spinner size={18} />
        </div>
      ) : total === 0 ? (
        <p className="dchart__empty">Sin datos</p>
      ) : (
        <div className="dchart__donut-wrapper">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={88}
                paddingAngle={3}
                dataKey="value"
                cornerRadius={4}
              >
                {chartData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="dchart__donut-legend">
            {chartData.map((d, i) => (
              <div key={d.name} className="dchart__legend-item">
                <span
                  className="dchart__legend-dot"
                  style={{
                    background: DONUT_COLORS[i % DONUT_COLORS.length],
                  }}
                />
                <span className="dchart__legend-label">{d.name}</span>
                <span className="dchart__legend-value">
                  {d.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Barras agrupadas: Entradas vs Salidas por día
function BarChartCard({ data, loading, days = 7 }) {
  const hasData = useMemo(
    () => data.some((d) => d.entradas > 0 || d.salidas > 0),
    [data]
  );

  return (
    <Card
      title="Movimientos diarios"
      subtitle={`Últimos ${days} días · entradas vs salidas`}
      compact
    >
      {loading ? (
        <div className="dchart__loading">
          <Spinner size={18} />
        </div>
      ) : !hasData ? (
        <p className="dchart__empty">Sin movimientos recientes</p>
      ) : (
        <div className="dchart__bar-wrapper">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={data}
              barGap={4}
              barCategoryGap="20%"
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                dy={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              <Bar
                dataKey="entradas"
                name="Entradas"
                fill={BAR_COLORS.entradas}
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="salidas"
                name="Salidas"
                fill={BAR_COLORS.salidas}
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// --- Componente principal
export default function DashboardCharts({ resumen, trendData, trendLoading, days = 7 }) {
  const donutData = useMemo(() => {
    const r = resumen?.resumen;
    if (!r) return [];
    return [
      { name: 'Vigentes', value: Number(r.productos_vigentes || 0) },
      { name: 'Próximos a vencer', value: Number(r.productos_proximos || 0) },
      { name: 'Vencidos', value: Number(r.productos_vencidos || 0) },
    ];
  }, [resumen]);

  return (
    <div className="dchart__grid">
      <DonutChartCard data={donutData} loading={!resumen} />
      <BarChartCard data={trendData || []} loading={trendLoading} days={days} />
    </div>
  );
}
