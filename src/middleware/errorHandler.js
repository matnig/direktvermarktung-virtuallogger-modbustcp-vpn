function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({
    error: 'internal_server_error',
    message: 'An unexpected error occurred',
  });
}

module.exports = errorHandler;
