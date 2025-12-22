/**
 * Error Handler Middleware
 */

export function errorHandler(err, req, res, _next) {
  console.error('❌ Error:', err.message);
  console.error(err.stack);

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
  });
}
