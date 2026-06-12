// Retry wrapper for flaky external API calls (network errors, 429, 5xx)
function isRetryableError(error) {
  if (!error.response) return true; // network error / timeout
  const status = error.response.status;
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Retries an async function with exponential backoff + jitter.
 * @param {Function} fn - async function to run
 * @param {Object} [opts]
 * @param {number} [opts.retries=2] - number of retries after the first attempt
 * @param {number} [opts.baseDelayMs=300] - base delay, doubled each retry
 */
async function withRetry(fn, { retries = 2, baseDelayMs = 300 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableError(error)) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = { withRetry };
