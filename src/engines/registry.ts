/**
 * Registry of {@link AlgorithmBackend} implementations.
 *
 * Backends can be registered eagerly (already constructed) or lazily via a
 * loader; the first `getBackendAsync` resolves and caches the promise and
 * replaces the eager placeholder with the resolved backend.
 */
import type { AlgorithmBackend, BackendRegistry, EffectDescriptor } from './types';

export function createBackendRegistry(): BackendRegistry {
  type BackendLoader = () => Promise<AlgorithmBackend>;
  const backends = new Map<string, AlgorithmBackend>();
  const lazyLoaders = new Map<string, BackendLoader>();
  const asyncCache = new Map<string, Promise<AlgorithmBackend>>();
  const descriptorsById = new Map<string, EffectDescriptor>();
  const descriptorsByBackendKey = new Map<string, EffectDescriptor>();

  const indexDescriptors = (backend: AlgorithmBackend): void => {
    backend.listEffects().forEach((descriptor) => {
      descriptorsById.set(descriptor.id, descriptor);
      descriptorsByBackendKey.set(`${descriptor.backendId}:${descriptor.key}`, descriptor);
    });
  };

  return {
    register(backend, opts) {
      backends.set(backend.backendId, backend);
      // A re-registered backend must be reloaded, not served from the old promise.
      asyncCache.delete(backend.backendId);
      if (opts?.lazy) {
        lazyLoaders.set(backend.backendId, opts.lazy);
      }
      indexDescriptors(backend);
    },

    getBackend(backendId) {
      return backends.get(backendId);
    },

    getBackendAsync(backendId) {
      const cached = asyncCache.get(backendId);
      if (cached) return cached;

      const loader = lazyLoaders.get(backendId);
      if (!loader) {
        const existing = backends.get(backendId);
        if (!existing) {
          return Promise.reject(new Error(`[engines] Backend "${backendId}" is not registered.`));
        }
        return Promise.resolve(existing);
      }

      const pending = loader()
        .then((resolved) => {
          backends.set(backendId, resolved);
          indexDescriptors(resolved);
          return resolved;
        })
        .catch((error: unknown) => {
          // Never memoize a failure: one bad import would poison the cache for good.
          asyncCache.delete(backendId);
          throw error;
        });
      asyncCache.set(backendId, pending);
      return pending;
    },

    listEffects(opts) {
      const includeHidden = opts?.includeHidden ?? false;
      const seen = new Set<string>();
      const result: EffectDescriptor[] = [];
      backends.forEach((backend) => {
        backend.listEffects().forEach((descriptor) => {
          if (!includeHidden && descriptor.hidden) return;
          if (seen.has(descriptor.id)) return;
          seen.add(descriptor.id);
          result.push(descriptor);
        });
      });
      return result;
    },

    getDescriptorById(id) {
      return descriptorsById.get(id);
    },

    /** @experimental Not consumed by the library yet; may change or disappear. */
    getDescriptorByBackendKey(backendId, key) {
      return descriptorsByBackendKey.get(`${backendId}:${key}`);
    },
  };
}
