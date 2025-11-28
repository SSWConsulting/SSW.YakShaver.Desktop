export async function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const msg = label ? `Timeout waiting for ${label}` : "Operation timed out";
      console.warn(`[withTimeout] ${msg} after ${ms}ms`);
      reject(new Error(msg));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
