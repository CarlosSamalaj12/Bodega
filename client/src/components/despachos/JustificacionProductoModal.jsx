import { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  SlidersHorizontal,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  RotateCcw,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { catalogosService } from '@/services/catalogos.service';
import './JustificacionProductoModal.scss';

const DEFAULT_MOTIVOS = [
  { id_motivo_justificacion: 1, texto: 'Sin stock suficiente en bodega' },
  { id_motivo_justificacion: 2, texto: 'Producto averiado / vencido' },
  { id_motivo_justificacion: 3, texto: 'Despacho diferido para mañana' },
  { id_motivo_justificacion: 4, texto: 'Error en cantidad solicitada' },
  { id_motivo_justificacion: 5, texto: 'Agotado con proveedor' },
];

const STORAGE_KEY = 'bodega_motivos_justificacion';

function getLocalFallback() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Ignore storage parse error
  }
  return DEFAULT_MOTIVOS;
}

function saveLocalFallback(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage write error
  }
}

export function JustificacionProductoModal({
  open,
  onClose,
  line,
  onSave,
}) {
  const [texto, setTexto] = useState('');
  const [motivoActivo, setMotivoActivo] = useState(null);

  // Gestión de motivos / chips
  const [motivos, setMotivos] = useState(getLocalFallback);
  const [gestionando, setGestionando] = useState(false);
  const [nuevoMotivo, setNuevoMotivo] = useState('');
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [editandoTexto, setEditandoTexto] = useState('');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [restableciendo, setRestableciendo] = useState(false);
  const [accionError, setAccionError] = useState(null);

  // Cargar motivos del backend
  const cargarMotivos = useCallback(async () => {
    try {
      const data = await catalogosService.getMotivosJustificacion();
      if (Array.isArray(data) && data.length > 0) {
        setMotivos(data);
        saveLocalFallback(data);
      } else {
        const fallback = getLocalFallback();
        setMotivos(fallback);
      }
    } catch {
      // Si falla la red, usar caché local
      setMotivos(getLocalFallback());
    }
  }, []);

  useEffect(() => {
    if (open) {
      cargarMotivos();
    }
  }, [open, cargarMotivos]);

  useEffect(() => {
    if (open && line) {
      const actual = line.justificacion || line.justificacion_linea || '';
      setTexto(actual);
      const existe = motivos.some((m) => (m.texto || m) === actual);
      setMotivoActivo(existe ? actual : null);
    } else {
      setTexto('');
      setMotivoActivo(null);
      setGestionando(false);
      setEditandoId(null);
      setAccionError(null);
      setNuevoMotivo('');
    }
  }, [open, line, motivos]);

  if (!line) return null;

  const handleChipClick = (textoMotivo) => {
    if (motivoActivo === textoMotivo) {
      setMotivoActivo(null);
      setTexto('');
    } else {
      setMotivoActivo(textoMotivo);
      setTexto(textoMotivo);
    }
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setTexto(val);
    const existe = motivos.some((m) => (m.texto || m) === val);
    setMotivoActivo(existe ? val : null);
  };

  const handleSave = (e) => {
    e.preventDefault();
    onSave?.(texto.trim());
    onClose?.();
  };

  // Crear nuevo chip
  const handleCrearMotivo = async () => {
    const trimmed = nuevoMotivo.trim();
    if (!trimmed) return;
    setGuardandoNuevo(true);
    setAccionError(null);
    try {
      let createdItem;
      try {
        const resp = await catalogosService.crearMotivoJustificacion(trimmed);
        createdItem = {
          id_motivo_justificacion: resp.id_motivo_justificacion || Date.now(),
          texto: trimmed,
        };
      } catch {
        // Fallback local
        createdItem = {
          id_motivo_justificacion: Date.now(),
          texto: trimmed,
        };
      }
      const updated = [...motivos, createdItem];
      setMotivos(updated);
      saveLocalFallback(updated);
      setNuevoMotivo('');
    } catch (err) {
      setAccionError(err?.message || 'Error al guardar el motivo');
    } finally {
      setGuardandoNuevo(false);
    }
  };

  // Iniciar edición
  const handleIniciarEdicion = (m) => {
    setEditandoId(m.id_motivo_justificacion || m.id);
    setEditandoTexto(m.texto || '');
    setAccionError(null);
  };

  // Guardar edición
  const handleGuardarEdicion = async (id) => {
    const trimmed = editandoTexto.trim();
    if (!trimmed) return;
    setGuardandoEdicion(true);
    setAccionError(null);
    try {
      try {
        await catalogosService.actualizarMotivoJustificacion(id, trimmed);
      } catch {
        // Fallback local silencioso si la API no está disponible
      }
      const updated = motivos.map((m) => {
        const currentId = m.id_motivo_justificacion || m.id;
        if (currentId === id) {
          return { ...m, texto: trimmed };
        }
        return m;
      });
      setMotivos(updated);
      saveLocalFallback(updated);

      // Si el texto seleccionado era el anterior, actualizarlo
      if (motivoActivo === motivos.find((m) => (m.id_motivo_justificacion || m.id) === id)?.texto) {
        setMotivoActivo(trimmed);
        setTexto(trimmed);
      }

      setEditandoId(null);
      setEditandoTexto('');
    } catch (err) {
      setAccionError(err?.message || 'Error al actualizar el motivo');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // Eliminar chip
  const handleEliminarMotivo = async (id) => {
    setAccionError(null);
    try {
      try {
        await catalogosService.eliminarMotivoJustificacion(id);
      } catch {
        // Fallback local silencioso
      }
      const itemAEliminar = motivos.find((m) => (m.id_motivo_justificacion || m.id) === id);
      const updated = motivos.filter((m) => (m.id_motivo_justificacion || m.id) !== id);
      setMotivos(updated);
      saveLocalFallback(updated);

      if (motivoActivo === itemAEliminar?.texto) {
        setMotivoActivo(null);
      }
    } catch (err) {
      setAccionError(err?.message || 'Error al eliminar el motivo');
    }
  };

  // Restablecer valores de fábrica
  const handleRestablecerPredeterminados = async () => {
    setRestableciendo(true);
    setAccionError(null);
    try {
      let restored = DEFAULT_MOTIVOS;
      try {
        const resp = await catalogosService.restablecerMotivosJustificacion();
        if (resp?.motivos && Array.isArray(resp.motivos)) {
          restored = resp.motivos;
        }
      } catch {
        // Fallback local
      }
      setMotivos(restored);
      saveLocalFallback(restored);
    } catch (err) {
      setAccionError(err?.message || 'Error al restablecer los motivos');
    } finally {
      setRestableciendo(false);
    }
  };

  const cant = Number(line.cantidad) || 0;
  const sol = Number(line.solicitada) || 0;
  const faltante = sol - cant;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Justificación de producto"
      subtitle={line.nombre_producto}
      size="md"
      className="justificacion-prod-modal"
    >
      <form onSubmit={handleSave} className="justificacion-prod-form">
        <div className="justificacion-prod-form__context">
          <div className="justificacion-prod-form__chip-info">
            <span className="justificacion-prod-form__info-label">Solicitada:</span>
            <strong>{sol} u.</strong>
          </div>
          <div className="justificacion-prod-form__chip-info">
            <span className="justificacion-prod-form__info-label">A surtir:</span>
            <strong>{cant} u.</strong>
          </div>
          {line.anulada ? (
            <div className="justificacion-prod-form__chip-info justificacion-prod-form__chip-info--void">
              <strong>Línea Anulada</strong>
            </div>
          ) : faltante > 0 ? (
            <div className="justificacion-prod-form__chip-info justificacion-prod-form__chip-info--warn">
              <span className="justificacion-prod-form__info-label">Faltante:</span>
              <strong>{faltante} u.</strong>
            </div>
          ) : cant > sol ? (
            <div className="justificacion-prod-form__chip-info justificacion-prod-form__chip-info--info">
              <span className="justificacion-prod-form__info-label">Excedente:</span>
              <strong>+{cant - sol} u.</strong>
            </div>
          ) : null}
        </div>

        {/* Sección de motivos frecuentes / gestión de chips */}
        <div className="justificacion-prod-form__section">
          <div className="justificacion-prod-form__header-row">
            <label className="justificacion-prod-form__label">
              {gestionando ? 'Gestionar motivos frecuentes:' : 'Motivos frecuentes:'}
            </label>
            <button
              type="button"
              className={`justificacion-prod-form__manage-btn ${
                gestionando ? 'justificacion-prod-form__manage-btn--active' : ''
              }`}
              onClick={() => {
                setGestionando((prev) => !prev);
                setEditandoId(null);
                setAccionError(null);
              }}
              title={gestionando ? 'Volver a selección de motivos' : 'Crear, editar o eliminar motivos'}
            >
              {gestionando ? (
                <>
                  <Check size={13} />
                  <span>Listo</span>
                </>
              ) : (
                <>
                  <SlidersHorizontal size={13} />
                  <span>Gestionar motivos</span>
                </>
              )}
            </button>
          </div>

          {!gestionando ? (
            /* Modo normal: Selección de chips */
            <div className="justificacion-prod-form__chips">
              {motivos.map((m) => {
                const textoMotivo = typeof m === 'string' ? m : m.texto;
                const idKey = typeof m === 'object' ? m.id_motivo_justificacion || m.id : m;
                return (
                  <button
                    key={idKey}
                    type="button"
                    className={`justificacion-prod-form__chip ${
                      motivoActivo === textoMotivo ? 'justificacion-prod-form__chip--active' : ''
                    }`}
                    onClick={() => handleChipClick(textoMotivo)}
                  >
                    {textoMotivo}
                  </button>
                );
              })}
              {motivos.length === 0 && (
                <span className="justificacion-prod-form__no-chips">
                  No hay motivos configurados. Haz clic en &quot;Gestionar motivos&quot; para agregar uno.
                </span>
              )}
            </div>
          ) : (
            /* Modo gestión: Crear, editar, eliminar y restablecer chips */
            <div className="justificacion-prod-form__manage-panel">
              {/* Formulario para agregar nuevo chip */}
              <div className="justificacion-prod-form__add-row">
                <input
                  type="text"
                  className="input justificacion-prod-form__add-input"
                  placeholder="Escribe un nuevo motivo frecuente..."
                  value={nuevoMotivo}
                  onChange={(e) => setNuevoMotivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCrearMotivo();
                    }
                  }}
                  maxLength={200}
                  disabled={guardandoNuevo}
                />
                <button
                  type="button"
                  className="btn btn--sm btn--primary justificacion-prod-form__add-btn"
                  onClick={handleCrearMotivo}
                  disabled={!nuevoMotivo.trim() || guardandoNuevo}
                >
                  <Plus size={14} />
                  <span>{guardandoNuevo ? 'Guardando...' : 'Agregar'}</span>
                </button>
              </div>

              {accionError && (
                <div className="justificacion-prod-form__error-alert">
                  {accionError}
                </div>
              )}

              {/* Lista de chips existentes con acciones de editar y eliminar */}
              <div className="justificacion-prod-form__manage-list">
                {motivos.map((m) => {
                  const id = m.id_motivo_justificacion || m.id;
                  const isEditing = editandoId === id;

                  if (isEditing) {
                    return (
                      <div
                        key={id}
                        className="justificacion-prod-form__manage-item justificacion-prod-form__manage-item--editing"
                      >
                        <input
                          type="text"
                          className="input justificacion-prod-form__edit-input"
                          value={editandoTexto}
                          onChange={(e) => setEditandoTexto(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleGuardarEdicion(id);
                            } else if (e.key === 'Escape') {
                              setEditandoId(null);
                            }
                          }}
                          autoFocus
                          maxLength={200}
                          disabled={guardandoEdicion}
                        />
                        <div className="justificacion-prod-form__item-actions">
                          <button
                            type="button"
                            className="justificacion-prod-form__icon-btn justificacion-prod-form__icon-btn--save"
                            onClick={() => handleGuardarEdicion(id)}
                            title="Guardar cambios"
                            disabled={!editandoTexto.trim() || guardandoEdicion}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="justificacion-prod-form__icon-btn justificacion-prod-form__icon-btn--cancel"
                            onClick={() => setEditandoId(null)}
                            title="Cancelar edición"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={id} className="justificacion-prod-form__manage-item">
                      <span className="justificacion-prod-form__item-text">{m.texto}</span>
                      <div className="justificacion-prod-form__item-actions">
                        <button
                          type="button"
                          className="justificacion-prod-form__icon-btn"
                          onClick={() => handleIniciarEdicion(m)}
                          title="Editar motivo"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="justificacion-prod-form__icon-btn justificacion-prod-form__icon-btn--danger"
                          onClick={() => handleEliminarMotivo(id)}
                          title="Eliminar motivo"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {motivos.length === 0 && (
                  <div className="justificacion-prod-form__manage-empty">
                    No hay motivos registrados. Escribe uno arriba para agregarlo.
                  </div>
                )}
              </div>

              {/* Botón de restablecer motivos predeterminados */}
              <div className="justificacion-prod-form__manage-footer">
                <button
                  type="button"
                  className="justificacion-prod-form__reset-btn"
                  onClick={handleRestablecerPredeterminados}
                  disabled={restableciendo}
                  title="Restablece los motivos originales de fábrica"
                >
                  <RotateCcw size={12} />
                  <span>{restableciendo ? 'Restableciendo...' : 'Restablecer predeterminados'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sección de texto detallado */}
        <div className="justificacion-prod-form__section">
          <label htmlFor="justificacion-text" className="justificacion-prod-form__label">
            Motivo u observación específica: <span className="justificacion-prod-form__required">*</span>
          </label>
          <textarea
            id="justificacion-text"
            className="input justificacion-prod-form__textarea"
            rows={3}
            placeholder="Escribe el motivo detallado o selecciona uno de los frecuentes arriba..."
            value={texto}
            onChange={handleTextChange}
            required
            autoFocus
          />
        </div>

        <div className="justificacion-prod-form__footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!texto.trim()}
          >
            Guardar justificación
          </Button>
        </div>
      </form>
    </Modal>
  );
}

JustificacionProductoModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  line: PropTypes.object,
  onSave: PropTypes.func,
};
