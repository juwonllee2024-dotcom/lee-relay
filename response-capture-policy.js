(() => {
  function confirmationQuietMs(adapter = {}, transaction = {}) {
    const normal = Math.max(500, Number(adapter.responseQuietMs) || 2000);
    if (transaction.generationSeen) return normal;
    return Math.max(normal, Number(adapter.initialResponseQuietMs) || normal);
  }

  globalThis.__LEE_RELAY_RESPONSE_POLICY__ = Object.freeze({ confirmationQuietMs });
})();
