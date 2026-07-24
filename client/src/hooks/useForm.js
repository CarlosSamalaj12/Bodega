import { useCallback, useEffect, useState } from 'react';

/**
 * Hook genérico para formularios. Maneja values, errors, submit, reset.
 *
 * @param {object} config
 * @param {object} config.initial - valores iniciales
 * @param {Function} [config.onSubmit] - async (values) => void
 * @param {Function} [config.validate] - (values) => errors object
 * @param {object} [config.external] - valores externos para sincronizar (ej. al editar)
 */
export function useForm({ initial, onSubmit, validate, external }) {
  const [values, setValues] = useState(initial || {});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Sincroniza con valores externos (ej. al abrir modal de edición)
  useEffect(() => {
    if (external !== undefined) {
      setValues(external || initial || {});
      setErrors({});
      setSubmitError(null);
    }
  }, [external, initial]);

  const set = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const setMany = useCallback((obj) => {
    setValues((prev) => ({ ...prev, ...obj }));
  }, []);

  const reset = useCallback((next) => {
    setValues(next || initial || {});
    setErrors({});
    setSubmitError(null);
  }, [initial]);

  const handleSubmit = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setSubmitError(null);

    if (validate) {
      const errs = validate(values) || {};
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }

    if (!onSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setSubmitError(e?.response?.data?.error || e?.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }, [values, validate, onSubmit]);

  return {
    values, set, setMany, reset,
    errors, setErrors,
    submitting, setSubmitting,
    submitError, setSubmitError,
    handleSubmit,
  };
}
