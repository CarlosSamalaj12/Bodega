import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/components/ui/Toast';

import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import api from '@/services/api';
import './AuditoriaSensiblesPage.scss';

const ACTION_KEY_LABELS = {
  delete_movimiento: 'Eliminar movimiento',
  deactivate_producto: 'Desactivar producto',
  edit_sensitive: 'Editar campo sensible',
  manage_permissions: 'Administrar permisos',
  dispatch_justify: 'Justificar despacho',
};

function getActionBadge(actionKey) {
  const map = {
    delete_movimiento: 'danger',
    deactivate_producto: 'warning',
    edit_sensitive: 'info',
    manage_permissions: 'info',
    dispatch_justify: 'warning',
  };
  return map[actionKey] || 'default';
}

export default function AuditoriaSensiblesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Filtros — leer desde URL params al montar
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || hace30);
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || hoy);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [committedSearch, setCommittedSearch] = useState(() => searchParams.get('q') || '');
  const [actionKey, setActionKey] = useState(() => searchParams.get('action_key') || '');

  // Datos
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Detail modal
  const [detailRow, setDetailRow] = useState(null);

  // Export
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  const handleSearch = () => {
    setCommittedSearch(search);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Ref con filtros actuales para evitar recrear fetchData
  const filtersRef = useRef({});
  filtersRef.current = { dateFrom, dateTo, committedSearch, actionKey };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = { limit: 2000 };
      if (f.dateFrom) params.from = f.dateFrom;
      if (f.dateTo) params.to = f.dateTo;
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.actionKey) params.action_key = f.actionKey;

      const { data } = await api.get('/api/reportes/auditoria-sensibles', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('Error al cargar la auditoría');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []); // Sin dependencias — los filtros se leen del ref

  // Re-fetch cuando cambian los filtros (leídos del ref)
  useEffect(() => { fetchData(); }, [
    dateFrom,
    dateTo,
    committedSearch,
    actionKey,
  ]);

  const hasActiveFilters = dateFrom || dateTo || committedSearch || actionKey;

  // Sincronizar filtros → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom && dateFrom !== hace30) params.set('from', dateFrom);
    if (dateTo && dateTo !== hoy) params.set('to', dateTo);
    if (committedSearch) params.set('q', committedSearch);
    if (actionKey) params.set('action_key', actionKey);
    setSearchParams(params, { replace: true });
  }, [dateFrom, dateTo, committedSearch, actionKey, hace30, hoy, setSearchParams]);

  const handleClearFilters = () => {
    setDateFrom(hace30);
    setDateTo(hoy);
    setSearch('');
    setCommittedSearch('');
    setActionKey('');
  };

  const actionKeyOptions = useMemo(() =>
    Object.entries(ACTION_KEY_LABELS).map(([key, label]) => ({ key, label })),
  []);

  // Columnas exportación
  const allExportColumns = [
    { key: 'id_auditoria', label: 'ID' },
    { key: 'creado_en', label: 'Fecha' },
    { key: 'action_key', label: 'Acción' },
    { key: 'action_label', label: 'Descripción' },
    { key: 'actor_nombre', label: 'Actor' },
    { key: 'supervisor_nombre', label: 'Supervisor' },
    { key: 'approval_method', label: 'Método' },
    { key: 'reference_type', label: 'Tipo ref.' },
    { key: 'reference_id', label: 'ID ref.' },
    { key: 'endpoint', label: 'Endpoint' },
    { key: 'http_method', label: 'Método HTTP' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(rows, {
      filename: `auditoria_sensibles_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'creado_en') return String(row.creado_en || '').slice(0, 19).replace('T', ' ');
        if (col.key === 'action_key') return ACTION_KEY_LABELS[row.action_key] || row.action_key;
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  // Parsear detail_json
  const parsedDetail = useMemo(() => {
    if (!detailRow?.detail_json) return null;
    try {
      return typeof detailRow.detail_json === 'string'
        ? JSON.parse(detailRow.detail_json)
        : detailRow.detail_json;
    } catch {
      return { raw: detailRow.detail_json };
    }
  }, [detailRow]);

  return (
    <>
      <Header
        title="Auditoría de Acciones Sensibles"
        subtitle={`${rows.length} registro${rows.length === 1 ? '' : 's'}`}
        actions={
          rows.length > 0 && !loading ? (
            <div className="auditoria-sensibles__header-actions">
              {!isMobile && (
                <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                  Exportar
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                Refrescar
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="auditoria-sensibles">
        <Card>
          <div className="auditoria-sensibles__filters">
            <div className="auditoria-sensibles__fecha-group">
              <input type="date" className="input" value={dateFrom} max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)} />
              <span className="auditoria-sensibles__fecha-sep">→</span>
              <input type="date" className="input" value={dateTo} min={dateFrom} max={hoy}
                onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <SearchInput value={search} onChange={setSearch} onKeyDown={handleKeyDown} onSearch={handleSearch} activeLabel={committedSearch || undefined} placeholder="Buscar actor, supervisor o acción…" />

            <select className="select" value={actionKey} onChange={(e) => setActionKey(e.target.value)}>
              <option value="">Todas las acciones</option>
              {actionKeyOptions.map((o) => (
                <option key={`aud-${o.key}`} value={o.key}>{o.label}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </Card>

        {loading ? (
          <div className="auditoria-sensibles__state"><Spinner size={20} label="Cargando auditoría…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="◉" title="Sin registros" message="No hay acciones sensibles en el período seleccionado." />
        ) : (
          <div className="auditoria-sensibles__table-wrapper">
            <table className="table table--sm">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>#</th>
                  <th>Fecha / Hora</th>
                  <th>Acción</th>
                  <th>Actor</th>
                  {!isMobile && <th>Supervisor</th>}
                  {!isMobile && <th>Método</th>}
                  {!isMobile && <th>Ref.</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`aud-${r.id_auditoria}`} className="auditoria-sensibles__row"
                    onClick={() => setDetailRow(r)} style={{ cursor: 'pointer' }}>
                    <td><code>#{r.id_auditoria}</code></td>
                    <td className="auditoria-sensibles__date">
                      <span>{formatDate(r.creado_en)}</span>
                      {!isMobile && <span className="auditoria-sensibles__time">
                        {String(r.creado_en || '').slice(11, 16)}
                      </span>}
                    </td>
                    <td>
                      <Badge variant={getActionBadge(r.action_key)}>
                        {ACTION_KEY_LABELS[r.action_key] || r.action_key}
                      </Badge>
                    </td>
                    <td className="auditoria-sensibles__actor">{r.actor_nombre || '—'}</td>
                    {!isMobile && <td>{r.supervisor_nombre || <span className="auditoria-sensibles__muted">—</span>}</td>}
                    {!isMobile && <td>{r.approval_method || <span className="auditoria-sensibles__muted">—</span>}</td>}
                    {!isMobile && (
                      <td>
                        {r.reference_type && r.reference_id
                          ? <code className="auditoria-sensibles__ref">{r.reference_type}#{r.reference_id}</code>
                          : <span className="auditoria-sensibles__muted">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* === Selector de columnas === */}
      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-auditoria-sensibles"
        onConfirm={handleExportWithColumns}
      />

      {/* === Modal de detalle === */}
      <Modal
        open={detailRow != null}
        onClose={() => setDetailRow(null)}
        title={detailRow ? `${ACTION_KEY_LABELS[detailRow.action_key] || 'Acción'} #${detailRow.id_auditoria}` : ''}
        size="md"
      >
        {detailRow && (
          <div className="auditoria-sensibles__detail">
            <div className="auditoria-sensibles__detail-grid">
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Acción</span>
                <Badge variant={getActionBadge(detailRow.action_key)}>
                  {ACTION_KEY_LABELS[detailRow.action_key] || detailRow.action_key}
                </Badge>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Descripción</span>
                <span className="auditoria-sensibles__detail-value">{detailRow.action_label || '—'}</span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Fecha / Hora</span>
                <span className="auditoria-sensibles__detail-value">
                  {detailRow.creado_en
                    ? `${formatDate(detailRow.creado_en)} ${String(detailRow.creado_en).slice(11, 16)}`
                    : '—'}
                </span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Actor</span>
                <span className="auditoria-sensibles__detail-value">{detailRow.actor_nombre || '—'}</span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Supervisor</span>
                <span className="auditoria-sensibles__detail-value">{detailRow.supervisor_nombre || '—'}</span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Método aprobación</span>
                <span className="auditoria-sensibles__detail-value">{detailRow.approval_method || '—'}</span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Referencia</span>
                <span className="auditoria-sensibles__detail-value">
                  {detailRow.reference_type && detailRow.reference_id
                    ? `${detailRow.reference_type} #${detailRow.reference_id}`
                    : '—'}
                </span>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Endpoint</span>
                <code className="auditoria-sensibles__detail-code">{detailRow.endpoint || '—'}</code>
              </div>
              <div className="auditoria-sensibles__detail-field">
                <span className="auditoria-sensibles__detail-label">Método HTTP</span>
                <span className="auditoria-sensibles__detail-value">{detailRow.http_method || '—'}</span>
              </div>
              {detailRow.supervisor_usuario && (
                <div className="auditoria-sensibles__detail-field">
                  <span className="auditoria-sensibles__detail-label">Supervisor usuario</span>
                  <span className="auditoria-sensibles__detail-value">{detailRow.supervisor_usuario}</span>
                </div>
              )}
            </div>

            {parsedDetail && Object.keys(parsedDetail).length > 0 && (
              <div className="auditoria-sensibles__detail-section">
                <h4 className="auditoria-sensibles__detail-section-title">Detalle JSON</h4>
                <pre className="auditoria-sensibles__detail-json">
                  {JSON.stringify(parsedDetail, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
