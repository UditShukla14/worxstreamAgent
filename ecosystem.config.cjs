/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: 'mcp-backend',
      script: 'src/index.js',
      cwd: '/opt/worxstream-agent',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
    },
  ],
};
