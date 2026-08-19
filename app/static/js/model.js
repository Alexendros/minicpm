/* @module model — identidad de los modelos desde la configuración del servidor */
import { api } from './api.js';

let cached = null;
let inflight = null;

export async function modelLabels() {
  if (cached) return cached;
  if (!inflight) {
    inflight = api.services
      .meta()
      .then((meta) => {
        cached = meta?.services || {};
        return cached;
      })
      .catch(() => ({}));
  }
  return inflight;
}

export function modelLabel(name, labels) {
  return labels?.[name]?.model || name;
}