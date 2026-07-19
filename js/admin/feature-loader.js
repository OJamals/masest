function normalizeFeatureGroup(name, group) {
  if (!group || typeof group.render !== 'function') {
    throw new TypeError(`Admin feature group "${name}" must provide render().`);
  }
  const wire = typeof group.wire === 'function' ? group.wire : () => {};
  let wirePromise = null;
  return Object.freeze({
    render: (...args) => group.render(...args),
    wire: () => {
      if (!wirePromise) {
        const attempt = Promise.resolve().then(() => wire());
        wirePromise = attempt.catch((error) => {
          wirePromise = null;
          throw error;
        });
      }
      return wirePromise;
    },
  });
}

export function createFeatureLoader(groups) {
  const cache = new Map();
  return {
    load(name) {
      const build = groups[name];
      if (typeof build !== 'function') {
        return Promise.reject(new TypeError(`Unknown admin feature group "${name}".`));
      }
      if (!cache.has(name)) {
        const promise = Promise.resolve()
          .then(() => build())
          .then((group) => normalizeFeatureGroup(name, group));
        cache.set(name, promise);
        void promise.catch(() => {
          if (cache.get(name) === promise) cache.delete(name);
        });
      }
      return cache.get(name);
    },
  };
}
