import http from 'node:http';

const request = http.get(
  {
    host: '127.0.0.1',
    port: Number(process.env.PORT || 8080),
    path: '/healthz',
    timeout: 3000,
  },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on('timeout', () =>
  request.destroy(new Error('Health check timed out')),
);
request.on('error', () => {
  process.exitCode = 1;
});
